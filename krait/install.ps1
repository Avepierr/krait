# krait installer — creates Start Menu + Desktop shortcuts with the krait icon
$ErrorActionPreference = "Stop"
$kraitDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Output "Installing krait from: $kraitDir"

# 1. build the .ico from the logo
node (Join-Path $kraitDir "make-ico.js")

# 2. write the launcher with the real path baked in
$vbs = Join-Path $kraitDir "krait-launch.vbs"
(Get-Content $vbs -Raw) -replace "__KRAIT_DIR__", $kraitDir | Set-Content $vbs -Encoding ASCII
Write-Output "Launcher ready: $vbs"

# 3. shortcuts
$sh = New-Object -ComObject WScript.Shell
$ico = Join-Path $kraitDir "assets\krait.ico"

$startMenu = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\krait.lnk"
$s = $sh.CreateShortcut($startMenu)
$s.TargetPath = $vbs
$s.IconLocation = $ico
$s.Description = "krait - code like Claude, free"
$s.Save()
Write-Output "Start Menu shortcut: $startMenu"

$desktopPath = [Environment]::GetFolderPath('Desktop')
$desktop = Join-Path $desktopPath "krait.lnk"
$d = $sh.CreateShortcut($desktop)
$d.TargetPath = $vbs
$d.IconLocation = $ico
$d.Description = "krait - code like Claude, free"
$d.Save()
Write-Output "Desktop shortcut: $desktop"

Write-Output "INSTALL COMPLETE"
