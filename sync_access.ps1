<#
.SYNOPSIS
    Syncs the latest "Spare Parts YYYYMMDD.accdb" database into public/data/catalog.json
    and extracts embedded Access Attachment images into public/images/.

.PARAMETER DbPath
    Optional explicit path to an .accdb file. If omitted, picks the newest
    "Spare Parts YYYYMMDD.accdb" in D:\Dropbox\0-Product List\0-Product List,
    falling back to the current workspace directory.
#>
param(
    [string]$DbPath = ""
)

$ErrorActionPreference = "Stop"

# 1. Locate the newest Spare Parts YYYYMMDD.accdb
function Resolve-LatestAccdb {
    param([string]$ExplicitPath)
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) {
        return (Resolve-Path $ExplicitPath).Path
    }

    $searchDirs = @(
        "D:\Dropbox\0-Product List\0-Product List",
        $PSScriptRoot
    )

    foreach ($dir in $searchDirs) {
        if (Test-Path $dir) {
            $candidates = Get-ChildItem -Path $dir -Filter "Spare Parts *.accdb" -File |
                Where-Object { $_.Name -match 'Spare Parts (\d{8})\.accdb$' } |
                Sort-Object {
                    if ($_.Name -match '(\d{8})\.accdb$') { $matches[1] } else { "00000000" }
                } -Descending

            if ($candidates.Count -gt 0) {
                return $candidates[0].FullName
            }
        }
    }
    throw "No 'Spare Parts YYYYMMDD.accdb' file found in Dropbox or workspace."
}

$sourceDb = Resolve-LatestAccdb -ExplicitPath $DbPath
Write-Host "Using database: $sourceDb" -ForegroundColor Cyan

# Output directories
$publicDir = Join-Path $PSScriptRoot "public"
$dataDir   = Join-Path $publicDir "data"
$imagesDir = Join-Path $publicDir "images"
New-Item -ItemType Directory -Force -Path $dataDir, $imagesDir | Out-Null

# Helper: Convert Access rich-text HTML to clean, safe HTML preserving colors & styles
function Sanitize-AccessHtml {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return "" }

    # Remove script/iframe/event handlers just in case
    $clean = $Raw -replace '(?is)<(script|style|iframe|object|embed)[^>]*>.*?</\1>', ''
    $clean = $clean -replace '(?i)\son\w+\s*=\s*("[^"]*"|''[^'']*''|[^\s>]+)', ''

    # Convert <font color=xxx> or <font color="xxx"> to <span style="color:xxx">
    $clean = [regex]::Replace($clean, '(?i)<font\s+([^>]*)>', {
        param($m)
        $attrs = $m.Groups[1].Value
        $styles = @()
        if ($attrs -match '(?i)color\s*=\s*["'']?([#a-zA-Z0-9]+)["'']?') {
            $styles += "color:$($matches[1])"
        }
        if ($attrs -match '(?i)size\s*=\s*["'']?(\d+)["'']?') {
            # Access font size 1-7 rough mapping
            $sz = switch ([int]$matches[1]) {
                1 { "0.75em" }
                2 { "0.875em" }
                3 { "1em" }
                4 { "1.125em" }
                5 { "1.25em" }
                6 { "1.5em" }
                default { "1em" }
            }
            $styles += "font-size:$sz"
        }
        if ($styles.Count -gt 0) {
            return "<span style=`"$($styles -join ';')`">"
        }
        return "<span>"
    })
    $clean = $clean -replace '(?i)</font>', '</span>'

    return $clean.Trim()
}

# Helper: Strip HTML to plain text for searching and model extraction
function Convert-HtmlToPlainText {
    param([string]$Html)
    if ([string]::IsNullOrWhiteSpace($Html)) { return "" }
    $txt = $Html -replace '(?i)<br\s*/?>', "`n"
    $txt = $txt -replace '(?i)</div>', "`n"
    $txt = $txt -replace '<[^>]+>', ' '
    $txt = [System.Net.WebUtility]::HtmlDecode($txt)
    $txt = ($txt -replace '[ \t]+', ' ') -replace '(\r?\n\s*)+', "`n"
    return $txt.Trim()
}

# Helper: Extract candidate machine models from Description plain text
function Extract-Models {
    param([string]$PlainDesc, [string]$Brand)
    if ([string]::IsNullOrWhiteSpace($PlainDesc)) { return @() }

    # Remove common leading part-type phrases
    $work = $PlainDesc -replace '(?i)\b(wiper\s+blade|doctor\s+blade|cleaning\s+blade|recovery\s+blade|rubber\s+only|pickup\s+roller|transfer\s+belt|fuser\s+film|upper\s+fuser\s+roller|lower\s+pressure\s+roller|wax\s+bar|mylar|foam|for|wb|db)\b', ' '
    if ($Brand) {
        $escapedBrand = [regex]::Escape($Brand)
        $work = $work -replace "(?i)\b$escapedBrand\b", ' '
    }

    # Split on / , ; newlines parentheses
    $rawTokens = $work -split '[/,;()\r\n]+'
    $models = [System.Collections.Generic.List[string]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($tok in $rawTokens) {
        $t = $tok.Trim(" `t.-:")
        # Skip cross-reference notes (= ...) or wildcard markers (*)
        if ($t -match '[=*]') { continue }
        # Keep tokens that look like model codes (contain at least one digit and length >= 2, <= 35)
        if ($t.Length -ge 2 -and $t.Length -le 35 -and $t -match '\d') {
            # Avoid pure generic words
            if ($t -notmatch '^(new|old|only|type|size|mm|cm|pcs|pc)$') {
                if ($seen.Add($t)) {
                    $models.Add($t)
                }
            }
        }
    }
    return $models.ToArray()
}

# Helper: Save DAO Attachment field to disk (skipping existing files of same name)
function Save-AttachmentImages {
    param(
        $Record,
        [string]$FieldName,
        [string]$SubFolder,
        [string]$ItemPrefix
    )
    $savedPaths = @()
    try {
        $attRs = $Record.Fields($FieldName).Value
    } catch {
        return $savedPaths
    }

    if ($null -eq $attRs) { return $savedPaths }

    $targetFolder = Join-Path $imagesDir $SubFolder
    if (-not (Test-Path $targetFolder)) {
        New-Item -ItemType Directory -Force -Path $targetFolder | Out-Null
    }

    $idx = 0
    while (-not $attRs.EOF) {
        $origName = $attRs.Fields("FileName").Value
        if (-not [string]::IsNullOrWhiteSpace($origName)) {
            $safeOrig = ($origName -replace '[^a-zA-Z0-9._-]', '_')
            $outName = "${ItemPrefix}_${idx}_${safeOrig}"
            $outPath = Join-Path $targetFolder $outName
            if (-not (Test-Path $outPath)) {
                $attRs.Fields("FileData").SaveToFile($outPath)
            }
            $savedPaths += "images/$SubFolder/$outName"
            $idx++
        }
        $attRs.MoveNext()
    }
    $attRs.Close()
    return $savedPaths
}

# Open Access Database read-only via DAO
$dbe = New-Object -ComObject DAO.DBEngine.120
$db = $dbe.OpenDatabase($sourceDb, $false, $true)

try {
    # Load Category lookup
    $categoryMap = @{}
    $categoriesList = @()
    $rsCat = $db.OpenRecordset("SELECT [識別碼], [Category Name], [CatImg] FROM [Category]")
    while (-not $rsCat.EOF) {
        $cid = [string]$rsCat.Fields("識別碼").Value
        $cname = [string]$rsCat.Fields("Category Name").Value
        $catImgs = Save-AttachmentImages -Record $rsCat -FieldName "CatImg" -SubFolder "categories" -ItemPrefix "cat_$cid"
        $categoryMap[$cid] = $cname
        $categoriesList += [ordered]@{
            id    = $cid
            name  = $cname
            image = if ($catImgs.Count -gt 0) { $catImgs[0] } else { $null }
        }
        $rsCat.MoveNext()
    }
    $rsCat.Close()

    # Tables to include (in display order)
    $tableConfigs = @(
        @{ Table = "A3 Products"; Slug = "a3_products"; Segment = "A3 Copier"; DefaultCatId = "1"; Archived = $false },
        @{ Table = "A3 Products 的冷宮目錄"; Slug = "a3_products_archive"; Segment = "A3 Copier"; DefaultCatId = "1"; Archived = $true },
        @{ Table = "A4 Products"; Slug = "a4_products"; Segment = "A4 Printer"; DefaultCatId = "2"; Archived = $false },
        @{ Table = "Pickup Roller"; Slug = "pickup_roller"; Segment = "Parts"; DefaultCatId = "3"; Archived = $false },
        @{ Table = "TB"; Slug = "transfer_belt"; Segment = "Parts"; DefaultCatId = "4"; Archived = $false },
        @{ Table = "Fuser Parts"; Slug = "fuser_parts"; Segment = "Parts"; DefaultCatId = "5"; Archived = $false },
        @{ Table = "Mylar"; Slug = "mylar"; Segment = "Parts"; DefaultCatId = "6"; Archived = $false },
        @{ Table = "Wax Bar"; Slug = "wax_bar"; Segment = "Parts"; DefaultCatId = "7"; Archived = $false },
        @{ Table = "Foam"; Slug = "foam"; Segment = "Parts"; DefaultCatId = "8"; Archived = $false },
        @{ Table = "Others"; Slug = "others"; Segment = "Parts"; DefaultCatId = "9"; Archived = $false }
    )

    $allItems = [System.Collections.Generic.List[object]]::new()
    $imageCount = 0

    foreach ($cfg in $tableConfigs) {
        $tName = $cfg.Table
        Write-Host "Exporting table: $tName ..." -ForegroundColor Gray
        $rs = $db.OpenRecordset("SELECT * FROM [$tName]")

        # Check which fields exist on this table
        $fieldNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
        foreach ($f in $rs.Fields) { [void]$fieldNames.Add($f.Name) }

        while (-not $rs.EOF) {
            $idVal = if ($fieldNames.Contains("識別碼")) { [string]$rs.Fields("識別碼").Value } else { "" }
            $itemNo = if ($fieldNames.Contains("Item No")) { [string]$rs.Fields("Item No").Value } else { "" }
            $brand = if ($fieldNames.Contains("Brand")) { ([string]$rs.Fields("Brand").Value).Trim() } else { "" }
            $rawDesc = if ($fieldNames.Contains("Description")) { [string]$rs.Fields("Description").Value } else { "" }
            $rawOem = if ($fieldNames.Contains("OEM No")) { [string]$rs.Fields("OEM No").Value } else { "" }
            $status = if ($fieldNames.Contains("Status")) { ([string]$rs.Fields("Status").Value).Trim() } else { "" }

            # Resolve Category
            $catId = $cfg.DefaultCatId
            $catName = $categoryMap[$catId]
            if ($fieldNames.Contains("Type")) {
                $rawType = [string]$rs.Fields("Type").Value
                if (-not [string]::IsNullOrWhiteSpace($rawType)) {
                    if ($categoryMap.ContainsKey($rawType)) {
                        $catId = $rawType
                        $catName = $categoryMap[$rawType]
                    }
                }
            }

            # Determine Segment (Copier A3 vs Printer A4 vs Other Parts)
            $segment = $cfg.Segment
            if ($catId -eq "1") { $segment = "Copier (A3)" }
            elseif ($catId -eq "2") { $segment = "Printer (A4)" }

            $descHtml = Sanitize-AccessHtml -Raw $rawDesc
            $descText = Convert-HtmlToPlainText -Html $descHtml
            $oemHtml  = Sanitize-AccessHtml -Raw $rawOem
            $oemText  = Convert-HtmlToPlainText -Html $oemHtml
            $models   = Extract-Models -PlainDesc $descText -Brand $brand

            $imgs = @()
            if ($fieldNames.Contains("Image")) {
                $imgs = Save-AttachmentImages -Record $rs -FieldName "Image" -SubFolder $cfg.Slug -ItemPrefix "id_$idVal"
                $imageCount += $imgs.Count
            }

            $allItems.Add([ordered]@{
                uid              = "$($cfg.Slug)_$idVal"
                id               = $idVal
                source_table     = $tName
                archived         = $cfg.Archived
                segment          = $segment
                category_id      = $catId
                category_name    = $catName
                item_no          = $itemNo.Trim()
                brand            = $brand
                description_html = $descHtml
                description_text = $descText
                oem_html         = $oemHtml
                oem_text         = $oemText
                status           = $status
                models           = $models
                images           = $imgs
            })

            $rs.MoveNext()
        }
        $rs.Close()
    }

    # Build final JSON payload
    $payload = [ordered]@{
        generated_at = (Get-Date).ToString("o")
        source_file  = [System.IO.Path]::GetFileName($sourceDb)
        total_items  = $allItems.Count
        categories   = $categoriesList
        items        = $allItems
    }

    $jsonPath = Join-Path $dataDir "catalog.json"
    $payload | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path $jsonPath -Encoding UTF8

    Write-Host "Done! Exported $($allItems.Count) items and $imageCount images to $publicDir" -ForegroundColor Green
} finally {
    $db.Close()
}
