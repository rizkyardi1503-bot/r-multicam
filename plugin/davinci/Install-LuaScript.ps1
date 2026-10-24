# R Project Multicam AI - the only step that may run elevated: put the Lua bridge into Resolve's all-users Scripts
# folder (or remove it). Started by Install-DaVinci.ps1 / Uninstall-DaVinci.ps1 with the paths as arguments.
#   -Source <R Project Multicam AI.lua> -Target <...\Fusion\Scripts\Utility>      copy (delete + recreate) and set the ACL
#   -Target <...\Fusion\Scripts\Utility> -Remove                                  remove the script (and an old .py)
# ACL of the script: inheritance off; Administrators + SYSTEM full control; Users read & execute.
param([string]$Source = '', [Parameter(Mandatory = $true)][string]$Target, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'R Project Multicam AI.lua'
# Delete a file even when its own ACL denies it (an earlier install made it read-only for Users): the owner or an
# administrator can always reset the ACL first.
function Remove-Script([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  try { Remove-Item -LiteralPath $Path -Force; return } catch {}
  $acl = New-Object System.Security.AccessControl.FileSecurity      # DACL only (no SACL privilege needed)
  $me = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($me, 'FullControl', 'Allow')))
  [IO.File]::SetAccessControl($Path, $acl)
  Remove-Item -LiteralPath $Path -Force
}
try {
  $targetFull = [IO.Path]::GetFullPath($Target)
  if ($targetFull -notmatch '\\Fusion\\Scripts\\Utility\\?$') { throw "Unexpected target folder: $targetFull" }
  $dest = Join-Path $targetFull $name
  $oldPy = Join-Path $targetFull 'R Project Multicam AI.py'
  if ($Remove) {
    foreach ($p in @($dest, $oldPy)) { Remove-Script $p }
    exit 0
  }
  $srcFull = [IO.Path]::GetFullPath($Source)
  if ((Split-Path -Leaf $srcFull) -ne $name -or -not (Test-Path -LiteralPath $srcFull -PathType Leaf)) { throw "Unexpected source file: $srcFull" }
  $first = Get-Content -LiteralPath $srcFull -TotalCount 1
  if ($first -notlike '-- R Project Multicam AI - DaVinci Resolve bridge*') { throw 'The source file is not the R Project bridge script.' }
  if (-not (Test-Path -LiteralPath $targetFull)) { New-Item -ItemType Directory -Force -Path $targetFull | Out-Null }
  if ((Get-Item -LiteralPath $targetFull -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "The Scripts folder is a link: $targetFull" }
  Remove-Script $dest
  Remove-Script $oldPy
  [IO.File]::WriteAllBytes($dest, [IO.File]::ReadAllBytes($srcFull))
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @(@('S-1-5-32-544', 'FullControl'), @('S-1-5-18', 'FullControl'), @('S-1-5-32-545', 'ReadAndExecute'))) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($rule[0])
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($sid, $rule[1], 'Allow')))
  }
  [IO.File]::SetAccessControl($dest, $acl)
  exit 0
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message)
  exit 1
}
