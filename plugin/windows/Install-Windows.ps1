param([string]$TestRoot = '', [switch]$AutoUpdate)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$base = $PSScriptRoot
$src = Join-Path $base 'Plugin'
$version = '2.3.11.2'
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw 'Plugin payload folder is missing.' }

# Manual recovery guard: stop only stale R Project one-click updater processes from an older build.
# Never run this inside AutoUpdate because the parent updater is intentionally still alive.
if (-not $AutoUpdate -and -not $TestRoot) {
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            ($_.Name -ieq 'powershell.exe' -or $_.Name -ieq 'pwsh.exe') -and ([string]$_.CommandLine -match 'windows-one-click\.ps1')
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $staleStatus = Join-Path $env:LOCALAPPDATA 'RProjectMulticamAI/updater/status.json'
        Remove-Item -LiteralPath $staleStatus -Force -ErrorAction SilentlyContinue
    } catch {}
}

function Get-SafeSha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

function Test-FFmpegExecutable([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    try {
        $versionOutput = @(& $Path -version 2>&1)
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) { return $false }
        if ($versionOutput.Count -gt 0) { Write-Host ([string]$versionOutput[0]) }
        return $true
    } catch {
        return $false
    }
}

$sumFile = Join-Path $base 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $sumFile -PathType Leaf)) { throw 'Package checksum inventory is missing.' }
foreach ($rawLine in Get-Content -LiteralPath $sumFile) {
    $line = ([string]$rawLine).TrimEnd("`r")
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid package checksum inventory.' }
    $expected = $Matches[1]; $relative = $Matches[2]
    if ($relative -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($relative)) { throw 'Invalid package path.' }
    $item = [IO.Path]::GetFullPath((Join-Path $base $relative))
    $prefix = [IO.Path]::GetFullPath($base).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $item.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid package path.' }
    if (-not (Test-Path -LiteralPath $item -PathType Leaf)) { throw "Missing package file: $relative" }
    if ((Get-SafeSha256 $item) -ne $expected) { throw "Package damaged: $relative. Download and extract again." }
}

[xml]$manifest = Get-Content -LiteralPath (Join-Path $src 'CSXS/manifest.xml') -Raw
if ($manifest.ExtensionManifest.ExtensionBundleVersion -ne $version) { throw 'Version mismatch.' }
$hostScript = Join-Path $src 'jsx/host.jsx'
$panelScript = Join-Path $src 'panel.js'
if (-not (Test-Path -LiteralPath $hostScript -PathType Leaf)) { throw 'Host script is missing.' }
if (-not (Test-Path -LiteralPath $panelScript -PathType Leaf)) { throw 'Panel script is missing.' }
$hostText = Get-Content -LiteralPath $hostScript -Raw
$panelText = Get-Content -LiteralPath $panelScript -Raw
if ($hostText -notlike ("*version:'" + $version + "'*")) { throw 'Host script version mismatch.' }
if ($panelText -notlike ("*r.version==='" + $version + "'*")) { throw 'Panel/host handshake version mismatch.' }

if ($TestRoot) {
    $profileRoot = [IO.Path]::GetFullPath($TestRoot)
    if (-not (Test-Path -LiteralPath $profileRoot -PathType Container)) { throw 'TestRoot must already exist.' }
    $roaming = Join-Path $profileRoot 'Roaming'; $local = Join-Path $profileRoot 'Local'
} else {
    if ($AutoUpdate) {
        if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) { throw 'Close Premiere before automatic installation.' }
    } elseif (Get-Process -Name 'Adobe Premiere Pro','AfterFX','CEPHtmlEngine' -ErrorAction SilentlyContinue) {
        throw 'Close Adobe applications before installation.'
    }
    $roaming = $env:APPDATA; $local = $env:LOCALAPPDATA
    if (-not $roaming -or -not $local) { throw 'Windows profile paths unavailable.' }
}

$extensionRoot = Join-Path $roaming 'Adobe/CEP/extensions'
$dest = Join-Path $extensionRoot 'RProjectMulticamAI'
$backup = Join-Path $local ('RProjectMulticamAI/backups/' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $extensionRoot ('rproject-stage-' + [Guid]::NewGuid().ToString('N'))

foreach ($target in @($extensionRoot,$backup)) {
    $check = [IO.Path]::GetFullPath($target)
    while ($check) {
        if ((Test-Path -LiteralPath $check) -and ((Get-Item -LiteralPath $check -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Redirected installation path: $check" }
        $parent = [IO.Directory]::GetParent($check); if ($null -eq $parent) { break }; $check = $parent.FullName
    }
}

New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null
New-Item -ItemType Directory -Path $local -Force | Out-Null

# Preflight dependencies BEFORE replacing the currently installed plugin.
if (-not $TestRoot) {
    foreach ($v in 9..15) {
        $key = "HKCU:\Software\Adobe\CSXS.$v"
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -PropertyType String -Force | Out-Null
    }
    $toolsDir = Join-Path $local 'RProjectMulticam/tools'
    New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
    $ff = Join-Path $toolsDir 'ffmpeg.exe'
    if (Test-Path -LiteralPath $ff -PathType Leaf) {
        if (-not (Test-FFmpegExecutable $ff)) { Remove-Item -LiteralPath $ff -Force }
    }
    if (-not (Test-Path -LiteralPath $ff -PathType Leaf)) {
        $systemFF = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
        if ($systemFF -and (Test-FFmpegExecutable $systemFF.Source)) {
            Write-Host ('Using existing FFmpeg: ' + $systemFF.Source)
            Copy-Item -LiteralPath $systemFF.Source -Destination $ff -Force
        }
    }
    if (-not (Test-Path -LiteralPath $ff -PathType Leaf)) {
        Write-Host 'Installing FFmpeg automatically...'
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('rproject-ffmpeg-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        try {
            $zip = Join-Path $tmp 'ffmpeg-release-essentials.zip'
            Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip -UseBasicParsing
            Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $tmp 'unpacked') -Force
            $candidate = Get-ChildItem -LiteralPath (Join-Path $tmp 'unpacked') -Filter 'ffmpeg.exe' -Recurse -File | Select-Object -First 1
            if (-not $candidate) { throw 'FFmpeg package did not contain ffmpeg.exe.' }
            if (-not (Test-FFmpegExecutable $candidate.FullName)) { throw 'Downloaded FFmpeg cannot run on this computer.' }
            Copy-Item -LiteralPath $candidate.FullName -Destination $ff -Force
        } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if (-not (Test-FFmpegExecutable $ff)) { throw 'FFmpeg cannot run on this computer.' }
    [IO.File]::WriteAllText((Join-Path $toolsDir 'ffmpeg-path.txt'), $ff)
}

# Stage and atomically switch plugin only after all preflight checks succeed.
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
Copy-Item -LiteralPath $src -Destination $stage -Recurse -Force
$oldCopies = @('RProjectMulticamAI','com.rproject.multicam','R-Project-Multicam-AI','r.project.multicam')
$moved = @(); $installed = $false
try {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    foreach ($name in $oldCopies) {
        $old = Join-Path $extensionRoot $name
        if (Test-Path -LiteralPath $old) {
            if ((Get-Item -LiteralPath $old -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Redirected plugin folder: $old" }
            Move-Item -LiteralPath $old -Destination (Join-Path $backup $name)
            $moved += $name
        }
    }
    Move-Item -LiteralPath $stage -Destination $dest
    $installed = $true
    [xml]$installedManifest = Get-Content -LiteralPath (Join-Path $dest 'CSXS/manifest.xml') -Raw
    if ($installedManifest.ExtensionManifest.ExtensionBundleVersion -ne $version) { throw 'Installed plugin verification failed.' }
$installedHost = Get-Content -LiteralPath (Join-Path $dest 'jsx/host.jsx') -Raw
$installedPanel = Get-Content -LiteralPath (Join-Path $dest 'panel.js') -Raw
if ($installedHost -notlike ("*version:'" + $version + "'*")) { throw 'Installed host script version verification failed.' }
if ($installedPanel -notlike ("*r.version==='" + $version + "'*")) { throw 'Installed panel/host handshake verification failed.' }
} catch {
    if ($installed -and (Test-Path -LiteralPath $dest)) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($name in $moved) {
        $saved = Join-Path $backup $name
        if (Test-Path -LiteralPath $saved) { Move-Item -LiteralPath $saved -Destination (Join-Path $extensionRoot $name) -Force }
    }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    throw
}

Write-Host "Installed R Project Multicam AI v$version MUSIC ENGINE V18 PUBLIC: $dest"
Write-Host "Previous plugin backup: $backup"
if (-not $TestRoot) { Write-Host 'FFmpeg is configured automatically.' }
Write-Host 'Open Premiere > Window > Extensions (Legacy) > R Project Multicam AI.'
