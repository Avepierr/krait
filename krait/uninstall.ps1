# krait uninstaller — removes everything the installer created.
# Usage: powershell -ExecutionPolicy Bypass -File uninstall.ps1 [-Quiet]
param([switch]$Quiet)
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Output 'Uninstalling krait (by Avepier)...'

# shortcuts
Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\krait.lnk"
Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) 'krait.lnk')

# terminal command - only if it points at this install
$shim = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\krait.cmd'
if (Test-Path $shim) {
  $content = Get-Content $shim -Raw
  if ($content -like "*$dir*") { Remove-Item $shim; Write-Output '  terminal command removed' }
  else { Write-Output '  terminal command belongs to another krait install - left alone' }
}

# apps list entry
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\krait'

# app files (ask unless -Quiet; warn if the app is running)
if (Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'krait' }) {
  Write-Output '  the krait window is open - close it first, then run this again (files kept)'
  Write-Output 'UNINSTALL PARTIAL - app files kept at ' $dir
  return
}
if (-not $Quiet) {
  $a = Read-Host "Delete krait app files at $dir? [y/N]"
  if ($a -notmatch '^y') { Write-Output 'UNINSTALL PARTIAL - app files kept'; return }
}
Remove-Item $dir -Recurse -Force
Write-Output 'UNINSTALL COMPLETE - krait is fully removed'
