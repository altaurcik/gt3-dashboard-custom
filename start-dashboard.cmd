@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
if not defined PORT set PORT=3001
start "" "http://localhost:%PORT%/dashboard"
node server.mjs
pause
