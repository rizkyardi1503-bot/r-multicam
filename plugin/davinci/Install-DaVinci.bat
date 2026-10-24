@echo off
setlocal
cd /d "%~dp0"
echo R Project Multicam AI for DaVinci Resolve - installer
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-DaVinci.ps1" %*
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" echo Installation failed (code %RC%). Read the message above.
pause
exit /b %RC%
