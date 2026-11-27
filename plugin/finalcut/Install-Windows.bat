@echo off
setlocal
cd /d "%~dp0"
echo R Project Multicam AI (XML app) - Install
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-Windows.ps1" %*
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" echo Failed (code %RC%). Read the message above.
pause
exit /b %RC%
