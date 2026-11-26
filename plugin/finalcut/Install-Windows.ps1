# R Project Multicam AI for DaVinci Resolve (XML app) - Windows installer.
#   Double-click Install-Windows.bat, or: powershell -ExecutionPolicy Bypass -File Install-Windows.ps1
# Installs, for this Windows user only (no administrator permission):
#   - the app into %LOCALAPPDATA%\RProjectMulticam\finalcut\app (the same engine as the Mac version)
#   - Node.js (official nodejs.org build, pinned, SHA-256 verified) when none (>= 18) is installed
#   - FFmpeg into %LOCALAPPDATA%\RProjectMulticam\tools exactly like the Premiere plugin installer (pinned, SHA-256 verified)
#   - shortcuts "R Project Multicam AI" on the Desktop and in the Start menu
param(
  [string[]]$ShortcutDirs = @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'R Project')),
  [string[]]$NodeZipSources = @('https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip'),
  [string]$NodeZipSha256 = '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  [string[]]$FFmpegSources = @('https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
                               'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'),
  [string]$FFmpegSha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
  [switch]$NoPathLookup,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$MinNodeMajor = 18
$Support = Join-Path $env:LOCALAPPDATA 'RProjectMulticam'
$Dest = Join-Path $Support 'finalcut'
$ToolsDir = Join-Path $Support 'tools'
$src = $PSScriptRoot
Write-Host 'R Project Multicam AI v1.2.0 - Windows'

# ---------------------------------------------------------------- package integrity
$sums = Join-Path $src 'SHA256SUMS-FinalCut.txt'
if (-not (Test-Path -LiteralPath $sums)) { throw 'SHA256SUMS-FinalCut.txt is missing. Extract the whole ZIP first, then run Install-Windows.bat from the extracted folder.' }
foreach ($line in Get-Content -LiteralPath $sums) {
  if (-not $line.Trim()) { continue }
  $expected, $rel = $line -split '  ', 2
  if ($rel -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($rel)) { throw "Invalid package path: $rel" }
  $p = Join-Path $src $rel
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw "Missing package file: $rel. Extract the whole ZIP first." }
  if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw "Package damaged: $rel. Download the ZIP again." }
}

function Get-VerifiedFile([string[]]$Sources, [string]$Sha256, [string]$OutFile, [string]$What) {
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $previousProgress = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  try {
    foreach ($s in $Sources) {
      try {
        Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
        if ($s -notmatch '^https://') { Copy-Item -LiteralPath $s -Destination $OutFile -Force }
        else {
          Write-Host "Downloading $What from $s ..."
          $ok = $false
          if (Test-Path -LiteralPath $curl -PathType Leaf) {
            & $curl -fsSL --proto '=https' --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 1800 --retry 1 -o $OutFile $s
            $ok = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $OutFile -PathType Leaf)
          }
          if (-not $ok) { Invoke-WebRequest -Uri $s -OutFile $OutFile -UseBasicParsing }
        }
        if ((Get-FileHash -LiteralPath $OutFile -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256.ToLowerInvariant()) { return $true }
        Write-Host "$What from $s failed its integrity check; trying the next source."
      } catch { Write-Host "$What from $s failed: $($_.Exception.Message)" }
    }
  } finally { $ProgressPreference = $previousProgress }
  Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
  return $false
}
function Get-NodeMajor([string]$Exe) {
  try { $out = @(& $Exe --version 2>$null); $v = [string]($out | Select-Object -First 1); if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)\.') { return [int]$Matches[1] } } catch {}
  return 0
}
function Test-FFmpegExecutable([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
  try { $null = @(& $Path -version 2>&1); return ($LASTEXITCODE -eq 0) } catch { return $false }
}
function Expand-One([string[]]$Sources, [string]$Sha, [string]$What, [string]$Exe) {
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('rproject-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp 'download.zip'
  if (-not (Get-VerifiedFile $Sources $Sha $zip $What)) { Remove-Item -LiteralPath $tmp -Recurse -Force; throw "Could not download a verified copy of $What. Check your internet connection and run the installer again." }
  Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp 'unpacked') -Force
  $f = Get-ChildItem -LiteralPath (Join-Path $tmp 'unpacked') -Filter $Exe -Recurse -File | Select-Object -First 1
  if (-not $f) { Remove-Item -LiteralPath $tmp -Recurse -Force; throw "The $What package did not contain $Exe." }
  return @($tmp, $f)
}

New-Item -ItemType Directory -Force -Path $Dest, $ToolsDir | Out-Null

# ---------------------------------------------------------------- Node.js (>= 18): ours, an installed one, else download
$runtimeDir = Join-Path $Dest 'runtime'
$bundled = Join-Path $runtimeDir 'node.exe'
$node = $null
if ((Test-Path -LiteralPath $bundled) -and (Get-NodeMajor $bundled) -ge $MinNodeMajor) { $node = $bundled }
elseif (-not $NoPathLookup) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd -and (Get-NodeMajor $cmd.Source) -ge $MinNodeMajor) { $node = $cmd.Source }
}
if (-not $node) {
  Write-Host 'Installing a private copy of Node.js...'
  $tmp, $exe = Expand-One $NodeZipSources $NodeZipSha256 'Node.js' 'node.exe'
  try {
    if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    Copy-Item -LiteralPath $exe.FullName -Destination $runtimeDir -Force
    $lic = Join-Path $exe.DirectoryName 'LICENSE'
    if (Test-Path -LiteralPath $lic) { Copy-Item -LiteralPath $lic -Destination (Join-Path $runtimeDir 'NODE-LICENSE.txt') -Force }
  } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  if ((Get-NodeMajor $bundled) -lt $MinNodeMajor) { throw 'The downloaded Node.js cannot run on this computer.' }
  $node = $bundled
}

# ---------------------------------------------------------------- FFmpeg (same location and pinned build as the Premiere plugin)
$ff = Join-Path $ToolsDir 'ffmpeg.exe'
if ((Test-Path -LiteralPath $ff -PathType Leaf) -and -not (Test-FFmpegExecutable $ff)) { Remove-Item -LiteralPath $ff -Force }
if (-not (Test-Path -LiteralPath $ff -PathType Leaf)) {
  Write-Host 'Installing FFmpeg...'
  $tmp, $exe = Expand-One $FFmpegSources $FFmpegSha256 'FFmpeg' 'ffmpeg.exe'
  try { Copy-Item -LiteralPath $exe.FullName -Destination $ff -Force } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
if (-not (Test-FFmpegExecutable $ff)) { throw 'FFmpeg cannot run on this computer.' }
[IO.File]::WriteAllText((Join-Path $ToolsDir 'ffmpeg-path.txt'), $ff)

# ---------------------------------------------------------------- stop a running engine, then replace the app folder
$lockFile = Join-Path $Dest 'engine.lock'
if (Test-Path -LiteralPath $lockFile) {
  try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json; $p = Get-Process -Id $lock.pid -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $lock.pid -Force; Start-Sleep -Seconds 1 } } catch {}
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}
$stage = Join-Path $Dest ('.app-new-' + $PID)
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
Copy-Item -LiteralPath (Join-Path $src 'app') -Destination $stage -Recurse -Force
$appDir = Join-Path $Dest 'app'
if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
Move-Item -LiteralPath $stage -Destination $appDir
& $node -e "require(process.argv[1])" (Join-Path $appDir 'lib\fcp-workflow.js')
if ($LASTEXITCODE -ne 0) { throw 'The app does not start with Node.js on this computer.' }

# ---------------------------------------------------------------- shortcuts
$engineJs = Join-Path $appDir 'rp-finalcut-engine.js'
$shell = New-Object -ComObject WScript.Shell
foreach ($d in $ShortcutDirs) {
  New-Item -ItemType Directory -Force -Path $d | Out-Null
  $lnk = $shell.CreateShortcut((Join-Path $d 'R Project Multicam AI.lnk'))
  $lnk.TargetPath = $node
  $lnk.Arguments = '"' + $engineJs + '"'
  $lnk.WorkingDirectory = $appDir
  $lnk.Description = 'R Project Multicam AI for DaVinci Resolve (XML)'
  $lnk.IconLocation = "$node,0"
  $lnk.Save()
}

Write-Host ''
Write-Host 'Installed. Open "R Project Multicam AI" from the Desktop or the Start menu.'
Write-Host 'Terpasang. Buka "R Project Multicam AI" dari Desktop atau Start menu.'
if (-not $NoStart) { Start-Process -FilePath $node -ArgumentList ('"' + $engineJs + '"') -WorkingDirectory $appDir }
