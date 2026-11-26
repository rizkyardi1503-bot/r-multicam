; R Project Multicam AI - Windows setup (NSIS 3). Built by build-installers.cjs; do not run makensis by hand without its defines:
;   VERSION  e.g. 1.2.0        SRC  folder with the extracted package (Install-Windows.ps1, app\, SHA256SUMS-FinalCut.txt)
;   OUT      output .exe       ICON app\assets\icon.ico
; Per-user install, no administrator rights. Node.js and FFmpeg are downloaded and SHA-256 verified by Install-Windows.ps1.
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"

Name "R Project Multicam AI"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\RProjectMulticam\setup"
BrandingText "R Project Multicam AI ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "R Project Multicam AI"
VIAddVersionKey "FileDescription" "R Project Multicam AI setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "R Project"
VIAddVersionKey "LegalCopyright" "R Project"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "R Project Multicam AI ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "From set to Reels: sync your cameras, find every drop, export ready-to-post videos or an XML for Final Cut Pro and DaVinci Resolve.$\r$\n$\r$\nSetup downloads Node.js and FFmpeg (official, verified builds), so stay online. No administrator rights are needed."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!define MUI_FINISHPAGE_RUN_TEXT "Open R Project Multicam AI"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\RProjectMulticamAI"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function OpenApp
  Exec '"$SYSDIR\wscript.exe" "$LOCALAPPDATA\RProjectMulticam\finalcut\R Project Multicam AI.vbs"'
FunctionEnd

Section "Install"
  SetDetailsPrint both
  RMDir /r "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  DetailPrint "Setting up R Project Multicam AI (Node.js and FFmpeg are downloaded once)..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Install-Windows.ps1" -NoStart'
  Pop $0
  StrCmp $0 "0" ok
    MessageBox MB_ICONSTOP "Setup could not finish (code $0). Check your internet connection and run setup again. The details above say what failed."
    Abort
  ok:
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "R Project Multicam AI"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "R Project"
  WriteRegStr HKCU "${UNINST}" "URLInfoAbout" "https://r-multicam.pages.dev/"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$LOCALAPPDATA\RProjectMulticam\finalcut\app\assets\icon.ico"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$LOCALAPPDATA\RProjectMulticam\finalcut"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\Uninstall-Windows.ps1"'
  Pop $0
  DeleteRegKey HKCU "${UNINST}"
  RMDir /r "$INSTDIR"
SectionEnd
