@echo off
cd /d "%~dp0"
echo [1/3] Syncing latest Spare Parts YYYYMMDD.accdb ...
powershell -ExecutionPolicy Bypass -File .\sync_access.ps1
if errorlevel 1 (
    echo Sync failed!
    pause
    exit /b 1
)

echo [2/3] Staging updated catalog and images ...
git add public/
git diff --cached --quiet
if %errorlevel%==0 (
    echo No changes detected in public/. Nothing to push.
    pause
    exit /b 0
)

for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set dt=%%I
set DATESTR=%dt:~0,4%-%dt:~4,2%-%dt:~6,2%

echo [3/3] Committing and pushing to GitHub ...
git commit -m "Update catalog %DATESTR%"
git push
if errorlevel 1 (
    echo Push failed! Check your Git remote and login.
    pause
    exit /b 1
)

echo.
echo Done! GitHub Pages will update automatically in ~1-2 minutes.
pause
