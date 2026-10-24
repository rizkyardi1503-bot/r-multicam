# R Project Multicam AI for DaVinci Resolve (Free + Studio) v1.0.0 - Windows installer.
#   Double-click Install-DaVinci.bat, or: powershell -ExecutionPolicy Bypass -File Install-DaVinci.ps1
# Installs:
#   - the Lua bridge "R Project Multicam AI.lua" into C:\ProgramData\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility
#     (Resolve lists Lua menu scripts only from this all-users folder; if it is not writable, run as administrator)
#   - R Project Engine into %LOCALAPPDATA%\RProjectMulticam\davinci, with its own Node.js when none (>= 18) is installed
#     (official nodejs.org build, pinned version, SHA-256 verified)
#   - FFmpeg into %LOCALAPPDATA%\RProjectMulticam\tools exactly like the Premiere plugin installer (pinned, SHA-256 verified)
#   - the per-user command folder <Fusion profile>\RProjectBridge (next to Fusion.prefs)
#   - shortcuts "R Project Engine" on the Desktop and in the Start menu
param(
  [string]$ScriptsDir = (Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility'),
  [string[]]$OldScriptsDirs = @((Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Scripts\Utility')),
  [string[]]$ShortcutDirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'R Project')),
  [string]$OldPublicDir = 'C:\Users\Public\RProjectMulticam',
  # Pinned downloads (same values as the Premiere plugin for FFmpeg). Overrides exist for the installer tests.
  [string[]]$NodeZipSources = @('https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip'),
  [string]$NodeZipSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  [string[]]$FFmpegSources = @('https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
                               'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'),
  [string]$FFmpegSha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  [switch]$ForceNodeDownload,
  [switch]$NoPathLookup,
  # Tests only: run the Lua copy step without the UAC prompt (it then works only where this user may write).
  [switch]$NoElevate
)
$ErrorActionPreference = 'Stop'
$MinNodeMajor = 18
$AppDir = Join-Path $env:LOCALAPPDATA 'RProjectMulticam\davinci'
$ToolsDir = Join-Path $env:LOCALAPPDATA 'RProjectMulticam\tools'
$ProfileDir = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Support\Fusion\Profiles\Default'
$BridgeDir = Join-Path $ProfileDir 'RProjectBridge'
$src = $PSScriptRoot
$lua = Join-Path $src 'R Project Multicam AI.lua'
$need = @($lua, (Join-Path $src 'rp-davinci-engine.js'), (Join-Path $src 'rp-engine-cli.js'), (Join-Path $src 'lib\bridge.js'), (Join-Path $src 'lib\account.js'), (Join-Path $src 'lib\google-auth.js'),(Join-Path $src 'engine\ai-director.js'))
foreach ($p in $need) { if (-not (Test-Path -LiteralPath $p)) { throw "Missing file: $p. Extract the whole ZIP first, then run Install-DaVinci.bat from the extracted folder." } }

function Test-Reparse($path) { (Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint }
function Get-SafeSha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

# Download (or copy, for local test sources) the first source whose SHA-256 matches; nothing unverified is ever run.
function Get-VerifiedFile([string[]]$Sources, [string]$Sha256, [string]$OutFile, [string]$What) {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $previousProgress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  $iwrTimeout = if ($PSVersionTable.PSVersion.Major -ge 6) { 1800 } else { 60 }
  try {
    foreach ($s in $Sources) {
      try {
        Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
        if ($s -notmatch '^https://') {
          if (-not (Test-Path -LiteralPath $s -PathType Leaf)) { throw "not found: $s" }
          Copy-Item -LiteralPath $s -Destination $OutFile -Force
        } else {
          Write-Host "Downloading $What from $s ..."
          $ok = $false
          if (Test-Path -LiteralPath $curl -PathType Leaf) {
            & $curl -fsSL --proto '=https' --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 1800 --retry 1 -o $OutFile $s
            $ok = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $OutFile -PathType Leaf)
          }
          if (-not $ok) { Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue; Invoke-WebRequest -Uri $s -OutFile $OutFile -UseBasicParsing -TimeoutSec $iwrTimeout }
        }
        $got = Get-SafeSha256 $OutFile
        if ($got -eq $Sha256.ToLowerInvariant()) { return $true }
        Write-Host "$What from $s failed its integrity check (SHA-256 $got); trying the next source."
      } catch { Write-Host "$What from $s failed: $($_.Exception.Message)" }
    }
  } finally { $ProgressPreference = $previousProgress }
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  return $false
}

function Get-NodeMajor([string]$Exe) {
  # Read all output: stopping the pipeline early (Select-Object -First) kills node and fakes a failed exit code.
  try { $out = @(& $Exe --version 2>$null); $v = [string]($out | Select-Object -First 1); if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)\.') { return [int]$Matches[1] } } catch {}
  return 0
}
function Test-FFmpegExecutable([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try { $out = @(& $Path -version 2>&1); if ($LASTEXITCODE -ne 0) { return $false }; if ($out.Count -gt 0) { Write-Host ([string]$out[0]) }; return $true } catch { return $false }
}

# ---------------------------------------------------------------- who runs this
# Everything except the ProgramData copy is per-user, so the installer must run as the person who uses DaVinci.
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = (New-Object System.Security.Principal.WindowsPrincipal($me)).IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
if ($elevated) {
  $desktopUser = $null
  try {
    $ex = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction Stop | Select-Object -First 1
    if ($ex) { $o = Invoke-CimMethod -InputObject $ex -MethodName GetOwner; if ($o.User) { $desktopUser = ($o.Domain + '\' + $o.User) } }
  } catch {}
  if ($desktopUser -and ($desktopUser -ine $me.Name)) {
    Write-Host -ForegroundColor Red ("ERROR: This installer was started as " + $me.Name + " but you are signed in to Windows as " + $desktopUser + ". Double-click Install-DaVinci.bat as yourself (not 'Run as administrator' with another account); it asks for administrator permission only for the one step that needs it.")
    exit 1
  }
}

# ---------------------------------------------------------------- Lua bridge into the all-users Scripts folder (only elevated step)
# A separate, minimal elevated process copies the file (delete + recreate) and sets its ACL on every install.
$helper = Join-Path $src 'Install-LuaScript.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw "Missing file: $helper" }
$luaOk = $false
if ($elevated -or $NoElevate) {
  & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $helper -Source $lua -Target $ScriptsDir
  $luaOk = ($LASTEXITCODE -eq 0)
} else {
  Write-Host 'Windows will ask for administrator permission once, to put the script where DaVinci can see it:'
  Write-Host "  $ScriptsDir"
  try {
    $argList = '-NoProfile -ExecutionPolicy Bypass -File "' + $helper + '" -Source "' + $lua + '" -Target "' + $ScriptsDir + '"'
    $p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $argList -Verb RunAs -Wait -PassThru -WindowStyle Hidden
    $luaOk = ($p.ExitCode -eq 0)
  } catch {
    Write-Host -ForegroundColor Red ('ERROR: Administrator permission was not given (' + $_.Exception.Message + '). DaVinci Resolve only lists scripts from ' + $ScriptsDir + ', which needs administrator permission once. Run Install-DaVinci.bat again and click Yes.')
    exit 1
  }
}
if (-not $luaOk) {
  Write-Host -ForegroundColor Red "ERROR: Could not install the script into $ScriptsDir. Run Install-DaVinci.bat again and allow administrator permission."
  exit 1
}
foreach ($d in $OldScriptsDirs) {
  foreach ($name in @('R Project Multicam AI.lua', 'R Project Multicam AI.py')) {
    $p = Join-Path $d $name
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Host "Removed old copy: $p" }
  }
}

# ---------------------------------------------------------------- engine files (lib\ and engine\ cleared first; runtime\ and session kept)
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null
foreach ($sub in @('lib', 'engine')) {
  $out = Join-Path $AppDir $sub
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $out | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $src $sub) -File | Copy-Item -Destination $out -Force
}
foreach ($f in @('rp-davinci-engine.js', 'rp-engine-cli.js', 'README-DaVinci.md')) {
  $p = Join-Path $src $f
  if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination $AppDir -Force }
}

# ---------------------------------------------------------------- Node.js (>= 18): installed one, else our pinned copy
$runtimeDir = Join-Path $AppDir 'runtime'
$node = $null
$bundled = Join-Path $runtimeDir 'node.exe'
if (-not $ForceNodeDownload) {
  if ((Test-Path -LiteralPath $bundled) -and (Get-NodeMajor $bundled) -ge $MinNodeMajor) { $node = $bundled }
  elseif (-not $NoPathLookup) {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd -and (Get-NodeMajor $cmd.Source) -ge $MinNodeMajor) { $node = $cmd.Source }
  }
}
if (-not $node) {
  Write-Host 'Node.js 18 or newer not found: installing a private copy for R Project Engine...'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('rproject-node-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $zip = Join-Path $tmp 'node.zip'
    if (-not (Get-VerifiedFile $NodeZipSources $NodeZipSha256 $zip 'Node.js')) {
      Write-Host -ForegroundColor Red 'ERROR: Could not download a verified copy of Node.js (SHA-256 mismatch or no connection). Nothing was changed in DaVinci. Check your internet connection and run the installer again.'; exit 1
    }
    Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp 'unpacked') -Force
    $exe = Get-ChildItem -LiteralPath (Join-Path $tmp 'unpacked') -Filter 'node.exe' -Recurse -File | Select-Object -First 1
    if (-not $exe) { throw 'The Node.js package did not contain node.exe.' }
    if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Copy-Item -LiteralPath $exe.FullName -Destination $runtimeDir -Force
    $lic = Join-Path $exe.DirectoryName 'LICENSE'
    if (Test-Path -LiteralPath $lic) { Copy-Item -LiteralPath $lic -Destination (Join-Path $runtimeDir 'NODE-LICENSE.txt') -Force }
    if ((Get-NodeMajor $bundled) -lt $MinNodeMajor) { throw 'The downloaded Node.js cannot run on this computer.' }
    $node = $bundled
  } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- FFmpeg (same location and pinned build as the Premiere plugin)
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
$ff = Join-Path $ToolsDir 'ffmpeg.exe'
if ((Test-Path -LiteralPath $ff -PathType Leaf) -and -not (Test-FFmpegExecutable $ff)) { Remove-Item -LiteralPath $ff -Force }
if (-not (Test-Path -LiteralPath $ff -PathType Leaf) -and -not $NoPathLookup) {
  $systemFF = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if ($systemFF -and (Test-FFmpegExecutable $systemFF.Source)) {
    Write-Host ('Using existing FFmpeg: ' + $systemFF.Source)
    Copy-Item -LiteralPath $systemFF.Source -Destination $ff -Force
    # A shared build may need DLLs next to it: test the copy; if it does not run, use the verified download (M5).
    if (-not (Test-FFmpegExecutable $ff)) { Write-Host 'The copied FFmpeg does not run on its own; downloading the verified build instead.'; Remove-Item -LiteralPath $ff -Force }
  }
}
if (-not (Test-Path -LiteralPath $ff -PathType Leaf)) {
  Write-Host 'Installing FFmpeg automatically...'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('rproject-ffmpeg-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    $zip = Join-Path $tmp 'ffmpeg.zip'
    if (-not (Get-VerifiedFile $FFmpegSources $FFmpegSha256 $zip 'FFmpeg')) {
      Write-Host -ForegroundColor Red 'ERROR: Could not download a verified copy of FFmpeg 9.0.2. Check your internet connection and run the installer again, or install FFmpeg yourself so ffmpeg.exe is on PATH.'; exit 1
    }
    Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp 'unpacked') -Force
    $candidate = Get-ChildItem -LiteralPath (Join-Path $tmp 'unpacked') -Filter 'ffmpeg.exe' -Recurse -File | Select-Object -First 1
    if (-not $candidate) { throw 'FFmpeg package did not contain ffmpeg.exe.' }
    if (-not (Test-FFmpegExecutable $candidate.FullName)) { throw 'Downloaded FFmpeg cannot run on this computer.' }
    Copy-Item -LiteralPath $candidate.FullName -Destination $ff -Force
  } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not (Test-FFmpegExecutable $ff)) { throw 'FFmpeg cannot run on this computer.' }
[IO.File]::WriteAllText((Join-Path $ToolsDir 'ffmpeg-path.txt'), $ff)

# ---------------------------------------------------------------- per-user command folder (never a link); old shared folder
New-Item -ItemType Directory -Force -Path $BridgeDir | Out-Null
if (Test-Reparse $BridgeDir) { throw "$BridgeDir is a link/junction. Remove it and run the installer again." }
if (Test-Path -LiteralPath $OldPublicDir) {
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $owner = (Get-Acl -LiteralPath $OldPublicDir).Owner
  $links = @(Get-ChildItem -LiteralPath $OldPublicDir -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if ((Test-Reparse $OldPublicDir) -or $links.Count) { Write-Warning "$OldPublicDir contains links; not removed. Delete it by hand." }
  elseif ($owner -ne $me) { Write-Warning "$OldPublicDir belongs to $owner; not removed." }
  else { Remove-Item -LiteralPath $OldPublicDir -Recurse -Force; Write-Host "Removed old shared folder: $OldPublicDir" }
}

# ---------------------------------------------------------------- shortcuts "R Project Engine"
$engineJs = Join-Path $AppDir 'rp-davinci-engine.js'
$shell = New-Object -ComObject WScript.Shell
foreach ($d in $ShortcutDirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  $lnk = $shell.CreateShortcut((Join-Path $d 'R Project Engine.lnk'))
  $lnk.TargetPath = $node
  $lnk.Arguments = '"' + $engineJs + '"'
  $lnk.WorkingDirectory = $AppDir
  $lnk.Description = 'R Project Engine for DaVinci Resolve (R Project Multicam AI)'
  $lnk.IconLocation = "$node,0"
  $lnk.Save()
  Write-Host "Shortcut         : $(Join-Path $d 'R Project Engine.lnk')"
}

Write-Host "Installed bridge : $(Join-Path $ScriptsDir 'R Project Multicam AI.lua')"
Write-Host "Installed engine : $AppDir"
Write-Host "Command folder   : $BridgeDir"
Write-Host "Node.js          : $node ($(& $node --version))"
Write-Host "FFmpeg           : $ff"

$lockFile = Join-Path $AppDir 'engine.lock'
if (Test-Path -LiteralPath $lockFile) {
  try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json; if (Get-Process -Id $lock.pid -ErrorAction SilentlyContinue) { Write-Warning 'R Project Engine is running with the previous version: close its window and start it again.' } } catch { }
}

Write-Host ''
Write-Host 'Done. Next:'
Write-Host '  1. Restart DaVinci Resolve once (so the Scripts menu lists the new script).'
Write-Host '  2. Start "R Project Engine" (Desktop or Start menu). A browser page opens: sign in with your R Project account.'
Write-Host '  3. In DaVinci: Workspace > Scripts > R Project Multicam AI. The page shows "DaVinci connected".'
