# krait installer — puts krait on the PC properly, no admin rights needed:
#   1. copies the app to %LOCALAPPDATA%\krait (self-contained, electron included)
#   2. builds the icon, Start Menu + Desktop shortcuts
#   3. installs the `krait` terminal command (chat in PowerShell/CMD, `krait app` opens the window)
#   4. registers an uninstall entry in Windows Settings > Apps
# Usage:  powershell -ExecutionPolicy Bypass -File install.ps1 [-TargetDir path] [-NoShortcuts] [-NoShim] [-NoRegistry] [-Run]
param(
  [string]$TargetDir = "$env:LOCALAPPDATA\krait",
  [switch]$NoShortcuts,
  [switch]$NoShim,
  [switch]$NoRegistry,
  [switch]$Run
)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).version
Write-Output "krait $version installer (by Avepier)"
Write-Output "  from: $src"
Write-Output "  to:   $TargetDir"

# ── 1. copy the app ──
Write-Output '[1/5] copying app files...'
New-Item -ItemType Directory -Force $TargetDir | Out-Null
robocopy $src $TargetDir /E /NFL /NDL /NJH /NJS /NP `
  /XD "$src\.git" "$src\checks" "$src\study" "$src\dist" "$src\out" "$src\build" "$src\release" `
  /XF '*.log' 'krait-launch.vbs' 'install.ps1' 'uninstall.ps1' 'package.ps1' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "copy failed (robocopy exit $LASTEXITCODE)" }
if (-not (Test-Path (Join-Path $TargetDir 'node_modules\electron\dist\electron.exe'))) {
  throw 'electron.exe missing after copy - node_modules must ship with the package'
}
Copy-Item (Join-Path $src 'uninstall.ps1') $TargetDir -Force

# ── 2. icon ──
Write-Output '[2/5] preparing icon...'
$ico = Join-Path $TargetDir 'assets\krait.ico'
if (-not (Test-Path $ico)) {
  & (Join-Path $TargetDir 'node_modules\electron\dist\electron.exe') (Join-Path $TargetDir 'make-ico.js') | Out-Null
}

# ── 3. launcher vbs (portable path baked in) ──
Write-Output '[3/5] writing launcher...'
$vbs = Join-Path $TargetDir 'krait-launch.vbs'
(Get-Content (Join-Path $src 'krait-launch.vbs') -Raw) -replace '__KRAIT_DIR__', $TargetDir | Set-Content $vbs -Encoding ASCII

# ── 4. shortcuts ──
if (-not $NoShortcuts) {
  Write-Output '[4/5] creating shortcuts...'
  $sh = New-Object -ComObject WScript.Shell
  $startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\krait.lnk"
  $s = $sh.CreateShortcut($startMenu)
  $s.TargetPath = $vbs
  $s.IconLocation = $ico
  $s.Description = 'krait - free AI coding agent by Avepier'
  $s.Save()
  $desktopPath = [Environment]::GetFolderPath('Desktop')
  $d = $sh.CreateShortcut((Join-Path $desktopPath 'krait.lnk'))
  $d.TargetPath = $vbs
  $d.IconLocation = $ico
  $d.Description = 'krait - free AI coding agent by Avepier'
  $d.Save()
} else { Write-Output '[4/5] shortcuts skipped' }

# ── 5. the `krait` terminal command (WindowsApps is on PATH by default) ──
if (-not $NoShim) {
  Write-Output '[5/5] installing the krait terminal command...'
  $shimDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
  New-Item -ItemType Directory -Force $shimDir | Out-Null
  $E = Join-Path $TargetDir 'node_modules\electron\dist\electron.exe'
  $P = Join-Path $TargetDir 'cli\pump.ps1'
  $C = Join-Path $TargetDir 'cli\krait-cli.js'
  $shim = '@echo off' + "`r`n" +
    'if "%~1"=="--version" (' + "`r`n" +
    "  echo krait $version by Avepier - free AI coding agent" + "`r`n" +
    '  exit /b 0' + "`r`n" +
    ')' + "`r`n" +
    'if "%~1"=="--help" (' + "`r`n" +
    '  echo krait - free AI coding agent by Avepier' + "`r`n" +
    '  echo   krait           chat right here in the terminal' + "`r`n" +
    '  echo   krait app       open the desktop app window' + "`r`n" +
    '  echo   krait --version print the version' + "`r`n" +
    '  exit /b 0' + "`r`n" +
    ')' + "`r`n" +
    'if /i "%~1"=="app" (' + "`r`n" +
    "  start `"`" `"$E`" `"$TargetDir`"" + "`r`n" +
    '  exit /b 0' + "`r`n" +
    ')' + "`r`n" +
    'rem piped/script stdin: electron directly (pump relay can drop tail bytes)' + "`r`n" +
    'rem interactive console: pump.ps1 (electron can''t read console stdin on Windows)' + "`r`n" +
    'powershell -NoProfile -Command "exit ([int][Console]::IsInputRedirected)" 2>nul' + "`r`n" +
    'if errorlevel 1 goto piped' + "`r`n" +
    "powershell -NoProfile -ExecutionPolicy Bypass -File `"$P`" %*" + "`r`n" +
    'exit /b 0' + "`r`n" +
    ':piped' + "`r`n" +
    'set "ELECTRON_RUN_AS_NODE=1"' + "`r`n" +
    "`"$E`" `"$C`" %*" + "`r`n" +
    'exit /b 0' + "`r`n"
  Set-Content (Join-Path $shimDir 'krait.cmd') $shim -Encoding ASCII
} else { Write-Output '[5/5] terminal command skipped' }

# ── uninstall entry (Windows Settings > Apps) ──
if (-not $NoRegistry) {
  $un = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\krait'
  New-Item -Force $un | Out-Null
  Set-ItemProperty $un 'DisplayName' 'krait - free AI coding agent'
  Set-ItemProperty $un 'DisplayVersion' $version
  Set-ItemProperty $un 'Publisher' 'Avepier'
  Set-ItemProperty $un 'DisplayIcon' $ico
  Set-ItemProperty $un 'UninstallString' "powershell -NoProfile -ExecutionPolicy Bypass -File `"$TargetDir\uninstall.ps1`""
  Set-ItemProperty $un 'NoModify' 1 -Type DWord
  Set-ItemProperty $un 'NoRepair' 1 -Type DWord
}

Write-Output ''
Write-Output 'INSTALL COMPLETE - krait by Avepier'
Write-Output '  desktop app : Start Menu > krait (or the desktop shortcut)'
Write-Output '  terminal    : open PowerShell and type:  krait'
if ($Run) { Start-Process $vbs }
