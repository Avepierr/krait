# package.ps1 — builds the user-facing zip: dist\krait-<version>-win-x64.zip
# A stranger downloads this, unzips it, and runs install.ps1 inside the krait folder.
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = (Get-Content (Join-Path $src 'package.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path (Split-Path -Parent $src) 'dist'
$outZip = Join-Path $dist "krait-$version-win-x64.zip"
New-Item -ItemType Directory -Force $dist | Out-Null

# stage as <temp>\krait\... so the zip extracts into a krait folder
$stageRoot = Join-Path $env:TEMP "krait-pkg-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$stage = Join-Path $stageRoot 'krait'
New-Item -ItemType Directory -Force $stage | Out-Null
Write-Output "staging krait $version..."
robocopy $src $stage /E /NFL /NDL /NJH /NJS /NP `
  /XD "$src\.git" "$src\checks" "$src\study" "$src\dist" "$src\out" "$src\build" "$src\release" `
  /XF '*.log' 'package-lock.json' | Out-Null
if ($LASTEXITCODE -ge 8) { throw "staging failed (robocopy exit $LASTEXITCODE)" }

Write-Output "zipping -> $outZip"
if (Get-Command tar -ErrorAction SilentlyContinue) {
  tar -a -c -f $outZip -C $stageRoot 'krait'
} else {
  Compress-Archive -Path (Join-Path $stageRoot 'krait') -DestinationPath $outZip -Force
}
Remove-Item $stageRoot -Recurse -Force
$mb = [math]::Round((Get-Item $outZip).Length / 1MB, 1)
Write-Output "PACKAGE COMPLETE: $outZip ($mb MB)"
