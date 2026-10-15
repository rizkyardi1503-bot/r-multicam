param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$logPath = [string]$cfg.log
function Test-CurrentAttempt {
    try { return ([IO.File]::ReadAllText([string]$cfg.attemptFile).Trim() -eq [string]$cfg.attempt) } catch { return $false }
}
function Set-UpdateStatus([string]$State,[string]$Message,[int]$Progress) {
    if (-not (Test-CurrentAttempt)) { return }
    $status = @{state=$State;message=$Message;progress=$Progress;version=$cfg.version;attempt=$cfg.attempt;updated_at=[DateTime]::UtcNow.ToString('o')}
    $target = [string]$cfg.status; $tmp = $target + '.' + $PID + '.tmp'
    [IO.File]::WriteAllText($tmp,($status | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
    for ($i = 1; ; $i++) {
        try { if ([IO.File]::Exists($target)) { [IO.File]::Replace($tmp,$target,[NullString]::Value) } else { [IO.File]::Move($tmp,$target) }; return }
        catch { if ($i -ge 10) { throw }; Start-Sleep -Milliseconds 200 }
    }
}
function Test-PremiereRunning { return [bool](Get-Process -Name 'Adobe Premiere Pro*' -ErrorAction SilentlyContinue) }
try {
    Start-Transcript -LiteralPath $logPath -Force | Out-Null
    $root = [IO.Path]::GetFullPath([string]$cfg.work).TrimEnd('\') + '\'
    foreach ($item in @($cfg.zip,$cfg.package,$cfg.log,$Config)) {
        if (-not [IO.Path]::GetFullPath([string]$item).StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid updater workspace path.' }
    }
    if ((Get-FileHash -LiteralPath $cfg.zip -Algorithm SHA256).Hash -ine $cfg.sha256) { throw 'Downloaded archive checksum mismatch.' }
    Set-UpdateStatus 'waiting' 'Save your project and close Premiere. The update will install after Premiere exits.' 75
    $deadline = [DateTime]::UtcNow.AddHours(12)
    do {
        while (Test-PremiereRunning) {
            if (-not (Test-CurrentAttempt)) { exit 0 }
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Timed out waiting for Premiere to close. Click Update again when you are ready.' }
            Start-Sleep -Seconds 2
        }
        Start-Sleep -Seconds 3
    } while (Test-PremiereRunning)
    # A newer update attempt or a manual install replaced this one: exit without touching the plugin or status.
    if (-not (Test-CurrentAttempt)) { exit 0 }
    Set-UpdateStatus 'extracting' 'Extracting verified update...' 82
    if (Test-Path -LiteralPath $cfg.package) { throw 'Update extraction directory already exists. Start a fresh update.' }
    Expand-Archive -LiteralPath $cfg.zip -DestinationPath $cfg.package
    $installer = Join-Path $cfg.package 'Install-Windows.ps1'
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Installer missing from package.' }
    Set-UpdateStatus 'installing' ('Installing v'+$cfg.version+'...') 90
    & $installer -AutoUpdate
    $installed = Join-Path $env:APPDATA 'Adobe/CEP/extensions/RProjectMulticamAI/CSXS/manifest.xml'
    [xml]$manifest = Get-Content -LiteralPath $installed -Raw
    if ($manifest.ExtensionManifest.ExtensionBundleVersion -ne $cfg.version) { throw 'Installed version verification failed.' }
    Set-UpdateStatus 'installed' ('Updated to v'+$cfg.version+'. You can reopen Premiere now.') 100
} catch {
    $message = $_.Exception.Message
    try { Add-Content -LiteralPath $logPath -Value ('ERROR: '+$message) } catch {}
    Set-UpdateStatus 'error' ('Update failed: '+$message+' Log: '+$logPath) 0
    exit 1
} finally { try { Stop-Transcript | Out-Null } catch {} }
