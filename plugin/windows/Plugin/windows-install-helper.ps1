param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$logPath = [string]$cfg.log
function Set-UpdateStatus([string]$State,[string]$Message,[int]$Progress) {
    $status = @{state=$State;message=$Message;progress=$Progress;version=$cfg.version;updated_at=[DateTime]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText([string]$cfg.status,($status | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))
}
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
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Update wait expired. Start the update again.' }
        while (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Update wait expired. Start the update again.' }
            Start-Sleep -Seconds 2
        }
        Start-Sleep -Seconds 3
    } while (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue)
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
