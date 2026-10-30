param([string]$TestRoot = '', [switch]$AutoUpdate)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$base = $PSScriptRoot
$src = Join-Path $base 'Plugin'
$version = '2.3.11.15'
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw 'Plugin payload folder is missing. Extract the whole ZIP first, then run SETUP-WINDOWS.cmd from the extracted folder.' }

# Manual recovery guard: stop only stale R Project one-click updater processes from an older build.
# Never run this inside AutoUpdate because the parent updater is intentionally still alive.
if (-not $AutoUpdate -and -not $TestRoot) {
    try {
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            ($_.Name -ieq 'powershell.exe' -or $_.Name -ieq 'pwsh.exe') -and ([string]$_.CommandLine -match 'windows-one-click\.ps1')
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $staleStatus = Join-Path $env:LOCALAPPDATA 'RProjectMulticamAI/updater/status.json'
        Remove-Item -LiteralPath $staleStatus -Force -ErrorAction SilentlyContinue
        # A manual install supersedes any pending in-panel update: its helper exits when attempt.txt no longer matches.
        Remove-Item -LiteralPath (Join-Path $env:LOCALAPPDATA 'RProjectMulticamAI/updater/attempt.txt') -Force -ErrorAction SilentlyContinue
    } catch {}
}

function Get-SafeSha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }

# Older Windows PowerShell 5.1 builds cannot Move-Item a folder to another volume (e.g. %APPDATA% redirected to another drive than %LOCALAPPDATA%): copy, then delete.
# Newer builds copy-and-delete inside Move-Item. Either way a copy or delete that stops part-way must not leave the source half-deleted.
function Move-PluginFolder([string]$From, [string]$To) {
    # Move-Item would nest $From inside an existing $To instead of replacing it.
    if (Test-Path -LiteralPath $To) { throw "Destination already exists: $To" }
    $partial = $false
    try { Move-Item -LiteralPath $From -Destination $To -ErrorAction Stop; return }
    catch {
        if (-not (Test-Path -LiteralPath $From)) { throw }
        $failure = $_
        $partial = Test-Path -LiteralPath $To
        # -2147024879 = ERROR_NOT_SAME_DEVICE (a junction or mount point to another volume behind the same drive letter).
        $crossVolume = ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($From)) -ine [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($To))) -or ($_.Exception.HResult -eq -2147024879)
        if (-not $partial -and -not $crossVolume) { throw }
    }
    if (-not $partial) {
        try {
            Copy-Item -LiteralPath $From -Destination $To -Recurse -Force -ErrorAction Stop
            Remove-Item -LiteralPath $From -Recurse -Force -ErrorAction Stop
            return
        } catch { $failure = $_ }
    }
    # Restore files already deleted from the source, then drop the copy. If that fails, keep the copy and say where it is.
    if (Test-Path -LiteralPath $To) {
        try {
            $copyRoot = (Get-Item -LiteralPath $To -Force).FullName
            foreach ($file in @(Get-ChildItem -LiteralPath $copyRoot -Recurse -Force -File)) {
                $target = Join-Path $From $file.FullName.Substring($copyRoot.Length)
                if (-not (Test-Path -LiteralPath $target)) {
                    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                    Copy-Item -LiteralPath $file.FullName -Destination $target -Force -ErrorAction Stop
                }
            }
        } catch { throw ($failure.Exception.Message + ' A complete copy is kept at: ' + $To) }
        Remove-Item -LiteralPath $To -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw $failure
}

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
    # Only Premiere loads this extension. 'Adobe Premiere Pro*' also covers 'Adobe Premiere Pro (Beta)'.
    # Photoshop/After Effects keep their own CEPHtmlEngine running and do not lock the plugin folder.
    if (Get-Process -Name 'Adobe Premiere Pro*' -ErrorAction SilentlyContinue) {
        if ($AutoUpdate) { throw 'Close Premiere before automatic installation.' }
        throw 'Close Adobe Premiere Pro before installation.'
    }
    $roaming = $env:APPDATA; $local = $env:LOCALAPPDATA
    if (-not $roaming -or -not $local) { throw 'Windows profile paths unavailable.' }
}

$extensionRoot = Join-Path $roaming 'Adobe/CEP/extensions'
$dest = Join-Path $extensionRoot 'RProjectMulticamAI'
$backup = Join-Path $local ('RProjectMulticamAI/backups/' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $extensionRoot ('rproject-stage-' + [Guid]::NewGuid().ToString('N'))

# Check only folders the installer owns inside the profile. A junctioned or redirected profile/AppData (e.g. C:\Users on another drive)
# is a valid setup; %APPDATA% is used as-is and is not affected by OneDrive/Documents redirection.
foreach ($pair in @(@($roaming,$extensionRoot),@($local,$backup))) {
    $stop = [IO.Path]::GetFullPath($pair[0]).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar)
    $check = [IO.Path]::GetFullPath($pair[1])
    while ($check -and $check.Length -gt $stop.Length -and $check.StartsWith($stop,[StringComparison]::OrdinalIgnoreCase)) {
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
            # Scoop shims and shared builds only run from their own folder; fall back to the pinned build.
            if (-not (Test-FFmpegExecutable $ff)) { Remove-Item -LiteralPath $ff -Force -ErrorAction SilentlyContinue }
        }
    }
    if (-not (Test-Path -LiteralPath $ff -PathType Leaf)) {
        Write-Host 'Installing FFmpeg automatically...'
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('rproject-ffmpeg-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp -Force | Out-Null
        try {
            # FFmpeg is pinned to one exact build and verified before it is ever executed.
            # Two independent, versioned sources publish the same file (same SHA-256).
            $ffmpegVersion = '9.0.2'
            $ffmpegSha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
            $ffmpegSources = @(
                'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
                'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
            )
            $zip = Join-Path $tmp ('ffmpeg-' + $ffmpegVersion + '-essentials_build.zip')
            $verified = $false
            # Windows PowerShell's progress bar slows large downloads dramatically.
            $previousProgress = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            # curl.exe (Windows 10 1803+) aborts stalled transfers and retries once; Invoke-WebRequest (system proxy aware) is the fallback.
            $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
            # PowerShell 7 applies -TimeoutSec to the whole transfer; Windows PowerShell 5.1 only to connect/response headers.
            $iwrTimeout = if ($PSVersionTable.PSVersion.Major -ge 6) { 1800 } else { 60 }
            foreach ($ffmpegUrl in $ffmpegSources) {
                try {
                    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
                    $downloaded = $false
                    if (Test-Path -LiteralPath $curl -PathType Leaf) {
                        & $curl -fsSL --proto '=https' --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 1800 --retry 1 -o $zip $ffmpegUrl
                        $downloaded = ($LASTEXITCODE -eq 0) -and (Test-Path -LiteralPath $zip -PathType Leaf)
                        if (-not $downloaded) { Write-Host ('curl could not download ' + $ffmpegUrl + ' (exit ' + $LASTEXITCODE + '); retrying with PowerShell.') }
                    }
                    if (-not $downloaded) {
                        Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
                        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $zip -UseBasicParsing -TimeoutSec $iwrTimeout
                    }
                    if ((Get-SafeSha256 $zip) -eq $ffmpegSha256) { $verified = $true; break }
                    Write-Host ('FFmpeg download from ' + $ffmpegUrl + ' failed its integrity check; trying the next source.')
                } catch {
                    Write-Host ('FFmpeg download from ' + $ffmpegUrl + ' failed: ' + $_.Exception.Message)
                }
            }
            $ProgressPreference = $previousProgress
            if (-not $verified) {
                Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
                throw ('Could not download a verified copy of FFmpeg ' + $ffmpegVersion + '. Check your internet connection and run the installer again, or install FFmpeg yourself so ffmpeg.exe is on PATH.')
            }
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
            Move-PluginFolder $old (Join-Path $backup $name)
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
    # Whatever is at $dest after the old copy was moved out is the new (possibly half-moved) plugin.
    if (($installed -or ($moved -contains (Split-Path -Leaf $dest))) -and (Test-Path -LiteralPath $dest)) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue }
    foreach ($name in $moved) {
        $saved = Join-Path $backup $name
        # Restore each copy on its own: one failure must not hide the original error or skip the others.
        if (-not (Test-Path -LiteralPath $saved)) { continue }
        $target = Join-Path $extensionRoot $name
        # A leftover the removal above could not delete (locked file) would make the restore fail with "Destination already exists":
        # move it into this run's backup folder (outside the extensions folder, so CEP never loads a second copy of the bundle ID),
        # try to delete it, then restore anyway. [IO.Directory]::Move is a plain rename: it fails cleanly across volumes, never half-copies.
        if (Test-Path -LiteralPath $target) {
            $aside = Join-Path $backup ('failed-install-' + $name)
            try {
                [IO.Directory]::Move($target, $aside)
                Remove-Item -LiteralPath $aside -Recurse -Force -ErrorAction SilentlyContinue
                if (Test-Path -LiteralPath $aside) { Write-Warning ("Leftover of the failed install kept at: $aside") }
            } catch {}
        }
        if (Test-Path -LiteralPath $target) { Write-Warning ("Could not restore $name automatically; it is kept at: $saved"); continue }
        try { Move-PluginFolder $saved $target } catch { Write-Warning ("Could not restore $name automatically; it is kept at: $saved") }
    }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    throw
}

Write-Host "Installed R Project Multicam AI v$version MUSIC ENGINE V19 PUBLIC: $dest"
Write-Host "Previous plugin backup: $backup"
if (-not $TestRoot) { Write-Host 'FFmpeg is configured automatically.' }
Write-Host 'Open Premiere > Window > Extensions (Legacy) > R Project Multicam AI.'
