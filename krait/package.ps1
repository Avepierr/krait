# package.ps1 — builds the user-facing zip: dist\krait-<version>-win-<arch>.zip
# A stranger downloads this, unzips it, and runs install.ps1 inside the krait folder.
# -Arch x64 (default) or ia32 (32-bit Windows).
param([string]$Arch = 'x64')
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path (Split-Path -Parent $src) 'dist'
$outZip = Join-Path $dist "krait-$version-win-$Arch.zip"
New-Item -ItemType Directory -Force $dist | Out-Null

# stage as <temp>\krait\... so the zip extracts into a krait folder
$stageRoot = Join-Path $env:TEMP "krait-pkg-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$stage = Join-Path $stageRoot 'krait'
New-Item -ItemType Directory -Force $stage | Out-Null
Write-Output "staging krait $version..."
robocopy $src $stage /E /NFL /NDL /NJH /NJS /NP `
  /XD "$src\.git" "$src\checks" "$src\study" "$src\dist" "$src\out" "$src\build" "$src\release" `
  /XF '*.log' 'package-lock.json' 'README-install.txt' 'snake-game.html' 'tic-tac-toe.html' 'tic-tac-toe-v2.html' 'tic-tac-toe-v3.html' 'tic-tac-toe-v4.html' 'publish.ps1' 'package.ps1' 'upload-zips.ps1' 'fetch-electron.js' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "staging failed (robocopy exit $LASTEXITCODE)" }

# 32-bit build: keep electron's JS wrapper, swap only the binary dist for the ia32 build.
# electron 44+ dropped 32-bit windows - the last line with win32/ia32 is 43.x (supported to Jan 2027).
$ia32Electron = '43.8.10'
if ($Arch -eq 'ia32') {
  Write-Output "downloading 32-bit electron $ia32Electron into the package..."
  $elDir = Join-Path $stage 'node_modules\electron'
  & node (Join-Path $src 'fetch-electron.js') $elDir ia32 $ia32Electron
  if ($LASTEXITCODE -ne 0) { throw '32-bit electron fetch failed' }
}

# readme travels with the zip
Copy-Item (Join-Path $src 'README-install.txt') (Join-Path $stage 'README.txt') -Force

# sanity: the staged electron must really be the requested arch
# (capture through a file: powershell relay can drop native stdout when stderr is redirected)
$archFile = Join-Path $env:TEMP 'krait-arch-check.txt'
Remove-Item $archFile -Force -ErrorAction SilentlyContinue
$env:ELECTRON_RUN_AS_NODE = '1'
cmd /c "`"$stage\node_modules\electron\dist\electron.exe`" -p process.arch > `"$archFile`" 2>nul"
Remove-Item env:ELECTRON_RUN_AS_NODE
$archOut = (Get-Content $archFile -ErrorAction SilentlyContinue | Select-Object -First 1) -replace '\s',''
if ($archOut -ne $Arch) { throw "electron arch mismatch: got '$archOut', wanted '$Arch'" }
Write-Output "electron arch verified: $archOut"

Write-Output "zipping -> $outZip"
if (Get-Command tar -ErrorAction SilentlyContinue) {
  tar -a -c -f $outZip -C $stageRoot 'krait'
} else {
  Compress-Archive -Path (Join-Path $stageRoot 'krait') -DestinationPath $outZip -Force
}
Remove-Item $stageRoot -Recurse -Force
$mb = [math]::Round((Get-Item $outZip).Length / 1MB, 1)
Write-Output "PACKAGE COMPLETE: $outZip ($mb MB)"
