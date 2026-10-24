# Removes R Project Multicam AI for DaVinci Resolve v1.0.0. Double-click Uninstall-DaVinci.bat.
# Stops R Project Engine, removes the script (administrator permission for the all-users copy), the engine, shortcuts,
# command folders and the R Project keys in Fusion.prefs (only while DaVinci is closed). Keeps the shared FFmpeg and the
# Premiere plugin. Never stops halfway: every step runs and a summary lists anything that could not be removed.
param(
  [string[]]$ScriptsDirs = @((Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility'),
                            (Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility')),
  [string[]]$ShortcutDirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'R Project')),
  [string]$OldPublicDir = 'C:\Users\Public\RProjectMulticam',
  [string]$ResolveProcess = 'Resolve',
  [switch]$NoElevate      # tests only
)
$ErrorActionPreference = 'Stop'
$AppDir = Join-Path $env:LOCALAPPDATA 'RProjectMulticam\davinci'
$ProfileDir = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Profiles\Default'
$Prefs = Join-Path $ProfileDir 'Fusion.prefs'
$problems = New-Object System.Collections.Generic.List[string]
function Step([string]$What, [scriptblock]$Block) { try { & $Block } catch { $problems.Add($What + ': ' + $_.Exception.Message) } }
function Test-Reparse($path) { (Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint }

# 1. stop the running engine (only our own node process, checked by its command line)
Step 'Stop R Project Engine' {
  $lockFile = Join-Path $AppDir 'engine.lock'
  if (Test-Path -LiteralPath $lockFile) {
    $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
    $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$lock.pid) -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -ieq 'node.exe' -and [string]$proc.CommandLine -match 'rp-davinci-engine\.js') {
      Stop-Process -Id $proc.ProcessId -Force; Start-Sleep -Milliseconds 500; Write-Host 'Stopped R Project Engine.'
    }
  }
}

# 2. the script: per-user copies directly, the all-users copy through the elevated helper when needed
$helper = Join-Path $PSScriptRoot 'Install-LuaScript.ps1'
foreach ($d in $ScriptsDirs) {
  Step "Remove script in $d" {
    $files = @('R Project Multicam AI.lua', 'R Project Multicam AI.py') | ForEach-Object { Join-Path $d $_ } | Where-Object { Test-Path -LiteralPath $_ }
    if (-not $files) { return }
    try { foreach ($p in $files) { Remove-Item -LiteralPath $p -Force }; Write-Host "Removed the script from $d" }
    catch {
      if (-not (Test-Path -LiteralPath $helper)) { throw }
      if ($NoElevate) {
        & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $helper -Target $d -Remove
        if ($LASTEXITCODE -ne 0) { throw 'could not remove the script' }
      } else {
        $argList = '-NoProfile -ExecutionPolicy Bypass -File "' + $helper + '" -Target "' + $d + '" -Remove'
        $p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argList -Verb RunAs -Wait -PassThru -WindowStyle Hidden
        if ($p.ExitCode -ne 0) { throw 'administrator step failed' }
      }
      Write-Host "Removed the script from $d"
    }
  }
}

# 3. shortcuts
foreach ($d in $ShortcutDirs) {
  Step "Remove shortcut in $d" {
    $lnk = Join-Path $d 'R Project Engine.lnk'
    if (Test-Path -LiteralPath $lnk) { Remove-Item -LiteralPath $lnk -Force; Write-Host "Removed $lnk" }
    if ((Split-Path -Leaf $d) -eq 'R Project' -and (Test-Path -LiteralPath $d) -and -not (Get-ChildItem -LiteralPath $d -Force)) { Remove-Item -LiteralPath $d -Force }
  }
}

# 4. engine folder (includes runtime\ and the saved sign-in), only when it really is this install
Step "Remove $AppDir" {
  if ((Test-Path -LiteralPath (Join-Path $AppDir 'rp-davinci-engine.js')) -or (Test-Path -LiteralPath (Join-Path $AppDir 'rp-engine-cli.js'))) {
    Remove-Item -LiteralPath $AppDir -Recurse -Force; Write-Host "Removed $AppDir"
  } elseif (Test-Path -LiteralPath $AppDir) { throw 'does not look like an R Project Engine install; left in place' }
}

# 5. command folders: only our files, then the folder if empty and not a link
$bridgeDirs = @((Join-Path $ProfileDir 'RProjectBridge'), (Join-Path $OldPublicDir 'bridge'))
$pd = Join-Path $env:ProgramData 'RProjectMulticam'
if (Test-Path -LiteralPath $pd) { $bridgeDirs += @(Get-ChildItem -LiteralPath $pd -Directory -Filter 'bridge-*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }) }
foreach ($b in $bridgeDirs) {
  Step "Remove $b" {
    if ((Test-Path -LiteralPath $b) -and -not (Test-Reparse $b)) {
      Get-ChildItem -LiteralPath $b -File | Where-Object { $_.Name -like 'cmd-*' -or $_.Name -like 'ack-*' } | Remove-Item -Force
      if (-not (Get-ChildItem -LiteralPath $b -Force)) { Remove-Item -LiteralPath $b -Force; Write-Host "Removed $b" }
    }
  }
}
Step "Remove $OldPublicDir" { if ((Test-Path -LiteralPath $OldPublicDir) -and -not (Test-Reparse $OldPublicDir) -and -not (Get-ChildItem -LiteralPath $OldPublicDir -Force)) { Remove-Item -LiteralPath $OldPublicDir -Force } }

# 6. Fusion.prefs keys (Resolve rewrites this file, so only while it is closed)
Step 'Remove the R Project keys from Fusion.prefs' {
  if (-not (Test-Path -LiteralPath $Prefs)) { return }
  $text = [IO.File]::ReadAllText($Prefs)
  if ($text -notmatch 'RProjectBridge') { return }
  if (Get-Process -Name $ResolveProcess -ErrorAction SilentlyContinue) { throw 'DaVinci Resolve is running. Close DaVinci Resolve and run the uninstaller again to remove them.' }
  $clean = [regex]::Replace($text, '(?m)^[ \t]*RProjectBridge[ \t]*=[ \t]*\{[^{}]*\},?[ \t]*\r?\n', '')
  if ($clean -match 'RProjectBridge') { throw 'unexpected format; left unchanged' }
  Copy-Item -LiteralPath $Prefs -Destination ($Prefs + '.rp-backup') -Force
  [IO.File]::WriteAllText($Prefs, $clean)
  Write-Host 'Removed the R Project keys from Fusion.prefs (backup: Fusion.prefs.rp-backup).'
}

Write-Host ''
if ($problems.Count) {
  Write-Host -ForegroundColor Yellow 'Finished, but some items could not be removed:'
  foreach ($p in $problems) { Write-Host ('  - ' + $p) }
  exit 1
}
Write-Host 'Done. Restart DaVinci Resolve to refresh the Scripts menu.'
exit 0
