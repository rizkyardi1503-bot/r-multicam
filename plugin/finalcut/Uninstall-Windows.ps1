# Removes R Project Multicam AI (XML app) for this Windows user. Your edits (Videos\R Project Multicam) and the
# Node.js / FFmpeg in tools\ (shared with the Premiere and DaVinci plugins) are kept.
$ErrorActionPreference = 'Continue'
$Dest = Join-Path $env:LOCALAPPDATA 'RProjectMulticam\finalcut'
$lockFile = Join-Path $Dest 'engine.lock'
if (Test-Path -LiteralPath $lockFile) {
  try { $lock = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json; $p = Get-Process -Id $lock.pid -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $lock.pid -Force; Start-Sleep -Seconds 1 } } catch {}
}
if (Test-Path -LiteralPath $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force }
foreach ($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'R Project'))) {
  Remove-Item -LiteralPath (Join-Path $d 'R Project Multicam AI.lnk') -Force -ErrorAction SilentlyContinue
}
Write-Host 'R Project Multicam AI (XML app) was removed. Your edits in Videos\R Project Multicam are kept.'
Write-Host 'R Project Multicam AI (aplikasi XML) sudah dihapus. Hasil edit di Videos\R Project Multicam tetap ada.'
