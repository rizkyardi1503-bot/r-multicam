@echo off
setlocal
cd /d "%~dp0"
echo R Project Multicam AI for DaVinci Resolve - uninstaller (close R Project Engine first)
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-DaVinci.ps1" %*
set RC=%ERRORLEVEL%
pause
exit /b %RC%
