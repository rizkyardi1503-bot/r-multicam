; R Project Multicam AI - Windows setup (NSIS 3), fully offline: the app, Node.js and FFmpeg are inside this .exe.
; No PowerShell, no downloads, no administrator rights. Built by build-installers.cjs with these defines:
;   VERSION  e.g. 1.2.0      SRC  extracted release package (app\ ...)      OUT  output .exe
;   NODEDIR  folder with node.exe + LICENSE (official nodejs.org build, SHA-256 checked by the build)
;   FFDIR    folder with ffmpeg.exe + FFMPEG-LICENSE.txt (pinned gyan.dev build, SHA-256 checked by the build)
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"

!define APPNAME "R Project Multicam AI"
!define ROOTDIR "$LOCALAPPDATA\RProjectMulticam"
!define DEST "$LOCALAPPDATA\RProjectMulticam\finalcut"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\RProjectMulticamAI"

Name "${APPNAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\RProjectMulticam\finalcut"
BrandingText "${APPNAME} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "R Project"
VIAddVersionKey "LegalCopyright" "R Project"

!define MUI_ICON "${SRC}\app\assets\icon.ico"
!define MUI_UNICON "${SRC}\app\assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "${APPNAME} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "From set to Reels: sync your cameras, find every drop, export ready-to-post videos or an XML for Final Cut Pro and DaVinci Resolve.$\r$\n$\r$\nEverything is included. No internet or administrator rights are needed to install."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION OpenApp
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function OpenApp
  Exec '"$SYSDIR\wscript.exe" "${DEST}\${APPNAME}.vbs"'
FunctionEnd

Section "Install"
  SetDetailsPrint both
  DetailPrint "Installing the app..."
  RMDir /r "${DEST}\app"
  SetOutPath "${DEST}\app"
  File /r "${SRC}\app\*.*"
  SetOutPath "${DEST}"
  File "${SRC}\README-FinalCut.md"
  File "${SRC}\THIRD-PARTY-NOTICES.txt"

  DetailPrint "Installing Node.js..."
  SetOutPath "${DEST}\runtime"
  ; ifdiff: the same build is not rewritten, so a running app (which holds node.exe open) does not block setup.
  SetOverwrite ifdiff
  File "${NODEDIR}\node.exe"
  SetOverwrite on
  File /oname=NODE-LICENSE.txt "${NODEDIR}\LICENSE"

  DetailPrint "Installing FFmpeg..."
  SetOutPath "${ROOTDIR}\tools"
  SetOverwrite ifdiff
  File "${FFDIR}\ffmpeg.exe"
  SetOverwrite on
  File "${FFDIR}\FFMPEG-LICENSE.txt"
  FileOpen $1 "${ROOTDIR}\tools\ffmpeg-path.txt" w
  FileWrite $1 "${ROOTDIR}\tools\ffmpeg.exe"
  FileClose $1

  ; Launcher without a console window: wscript runs node hidden; node opens the app window.
  FileOpen $1 "${DEST}\${APPNAME}.vbs" w
  FileWriteWord $1 0xFEFF
  FileWriteUTF16LE $1 'CreateObject("WScript.Shell").Run """${DEST}\runtime\node.exe"" ""${DEST}\app\rp-finalcut-engine.js"" --app", 0, False'
  FileClose $1

  SetOutPath "${DEST}"
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$SYSDIR\wscript.exe" '"${DEST}\${APPNAME}.vbs"' "${DEST}\app\assets\icon.ico" 0
  CreateDirectory "$SMPROGRAMS\R Project"
  CreateShortCut "$SMPROGRAMS\R Project\${APPNAME}.lnk" "$SYSDIR\wscript.exe" '"${DEST}\${APPNAME}.vbs"' "${DEST}\app\assets\icon.ico" 0

  ; The engine must start with the bundled Node.js.
  nsExec::ExecToLog '"${DEST}\runtime\node.exe" -e "require(process.argv[1])" "${DEST}\app\lib\fcp-workflow.js"'
  Pop $0
  StrCmp $0 "0" +3
    MessageBox MB_ICONSTOP "The app could not start on this computer (code $0). Please send a screenshot of this window to R Project support."
    Abort

  WriteUninstaller "${DEST}\Uninstall.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "R Project"
  WriteRegStr HKCU "${UNINST}" "URLInfoAbout" "https://r-multicam.pages.dev/"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "${DEST}\app\assets\icon.ico"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"${DEST}\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "${DEST}"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  ; Older script-based install (Install-Windows.bat) used another shortcut target; the new ones replace it.
  Delete "$DESKTOP\R Project Engine.lnk"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\R Project\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\R Project"
  DeleteRegKey HKCU "${UNINST}"
  ; Your edits (Videos\R Project Multicam) and the shared FFmpeg in tools\ stay.
  RMDir /r "${DEST}"
SectionEnd
