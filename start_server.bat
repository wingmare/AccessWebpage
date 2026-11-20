@echo off
cd /d "%~dp0"
echo Starting Spare Parts Catalog server on http://localhost:3000 ...
start "" http://localhost:3000
npx --yes serve public -l 3000
if errorlevel 1 (
    echo.
    echo Failed to start server. Make sure Node.js is installed.
    pause
)
