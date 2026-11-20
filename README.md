# AccessWebsite — Spare Parts Catalog

Web catalog synced from Microsoft Access (`Spare Parts YYYYMMDD.accdb`) with embedded product pictures, preserved rich-text formatting/colors, **Brand → Machine Model → Parts** browsing, and instant **OEM No / Item No / Model** search.

## Project Structure

- `sync_access.ps1` — Reads the latest `Spare Parts YYYYMMDD.accdb` (from `D:\Dropbox\0-Product List\0-Product List` or the local workspace), preserves Access rich-text HTML colors/styles, extracts `Image` & `CatImg` attachments, and writes:
  - `public/data/catalog.json`
  - `public/images/...`
- `start_server.bat` — Double-click to launch the local web server on `http://localhost:3000` and open it in your browser.
- `sync_and_push.bat` — Double-click to sync the latest `.accdb`, commit `public/`, and push to GitHub (auto-deploys GitHub Pages).
- `.github/workflows/pages.yml` — GitHub Actions workflow that deploys `public/` to GitHub Pages on every push to `main`.
- `.gitignore` — Excludes `*.accdb` / `*.mdb` so raw Access databases are never pushed to GitHub.
- `public/` — Static web application (`index.html`, `styles.css`, `app.js`, plus `mobile-preview.html` for testing phone layouts on PC) ready to preview locally or deploy to any static host (GitHub Pages, Cloudflare Pages, Netlify, Vercel).

## Included & Excluded Data

- **Included tables:** `A3 Products`, `A3 Products 的冷宮目錄`, `A4 Products`, `Pickup Roller`, `TB`, `Fuser Parts`, `Mylar`, `Wax Bar`, `Foam`, `Others`, `Category`.
- **Excluded tables:** `A3 Blade`, `A4 Blade`, `Append`, `Blade Temp`, `SearchT`, `貼上錯誤`.
- **Excluded internal fields:** `歷程`, `買進?`, `新增日期`.

## How to Update When a New `.accdb` File Arrives

Run the sync script in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync_access.ps1
```

By default it automatically picks the newest `Spare Parts YYYYMMDD.accdb` in `D:\Dropbox\0-Product List\0-Product List` (or falls back to the workspace folder). Existing images are skipped so updates complete in seconds. You can also pass a specific file:

```powershell
powershell -ExecutionPolicy Bypass -File .\sync_access.ps1 -DbPath "Spare Parts 20261118.accdb"
```

## Preview Locally

Double-click `start_server.bat`, or serve the `public/` folder from PowerShell:

```powershell
npx --yes serve public -l 3000
```

Then open `http://localhost:3000` in your browser.

## Deploy to GitHub Pages

1. Initialize Git and push to your GitHub repo (`*.accdb` is ignored by `.gitignore`):
   ```powershell
   git init -b main
   git add .
   git commit -m "Initial Kuroki Spare Parts Catalog"
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. On GitHub, open your repo's **Settings → Pages → Build and deployment → Source**, and select **GitHub Actions**.
3. Whenever a new `Spare Parts YYYYMMDD.accdb` is saved in Dropbox, double-click `sync_and_push.bat` to sync and update your live GitHub Pages site.
