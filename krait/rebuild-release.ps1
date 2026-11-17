# rebuild-release.ps1 - rebuild both zips clean, verify, sync Desktop copies,
# and replace the release assets on GitHub. One command for post-fix republish.
param([string]$Owner = 'Avepierr')
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$kraitDir = Join-Path $repoRoot 'krait'
$distDir = Join-Path $repoRoot 'dist'
$deskDir = Join-Path $env:USERPROFILE 'OneDrive\Desktop\Krait'
$version = (Get-Content (Join-Path $kraitDir 'package.json') -Raw | ConvertFrom-Json).version
$Tag = 'v' + $version

# 1. build both
foreach ($arch in 'x64','ia32') {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kraitDir 'package.ps1') -Arch $arch
  if ($LASTEXITCODE -ne 0) { throw "$arch build failed" }
}

# 2. verify: clean + complete
Add-Type -AssemblyName System.IO.Compression.FileSystem
$badNames = 'snake-game','tic-tac-toe','README-install','publish.ps1','package.ps1','upload-zips.ps1','fetch-electron.js'
foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  $zipPath = Join-Path $distDir $zipName
  $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  $names = $zip.Entries.FullName
  $zip.Dispose()
  $junk = $names | Where-Object { $n = ($_ -split '/')[-1]; $badNames -contains $n }
  if ($junk) { throw "junk still in ${zipName}: $($junk -join ', ')" }
  $must = 'krait/README.txt','krait/install.ps1','krait/uninstall.ps1','krait/node_modules/electron/dist/electron.exe','krait/cli/krait-cli.js'
  foreach ($m in $must) { if ($names -notcontains $m) { throw "$zipName missing required file: $m" } }
  Write-Output "verified clean: $zipName"
}

# 3. sync Desktop copies
foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  Copy-Item (Join-Path $distDir $zipName) (Join-Path $deskDir $zipName) -Force
}
Write-Output 'Desktop copies updated'

# 4. replace release assets
$git = 'C:\Program Files\Git\cmd\git.exe'
$inFile = Join-Path $env:TEMP 'krait-cred-in.txt'
$outFile = Join-Path $env:TEMP 'krait-cred-out.txt'
Set-Content $inFile "protocol=https`nhost=github.com`nusername=$Owner`n`n"
$proc = Start-Process -FilePath $git -ArgumentList 'credential','fill' -NoNewWindow -PassThru `
  -RedirectStandardInput $inFile -RedirectStandardOutput $outFile -RedirectStandardError (Join-Path $env:TEMP 'krait-cred-err.txt')
$proc.WaitForExit(120000) | Out-Null
if (-not $proc.HasExited) { $proc.Kill(); throw 'credential read timed out' }
$credRaw = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
$token = [regex]::Match($credRaw, '(?m)^password=(.+)$').Groups[1].Value.Trim()
if (-not $token) { throw 'no stored GitHub login found' }
$headers = @{ Authorization = "token $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'krait-publish' }
$rel = Invoke-RestMethod -Method GET -Uri "https://api.github.com/repos/$Owner/krait/releases/tags/$Tag" -Headers $headers
$uploadBase = ($rel.upload_url -split '\{')[0]
foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  foreach ($a in $rel.assets) { if ($a.name -eq $zipName) { Invoke-RestMethod -Method DELETE -Uri "https://api.github.com/repos/$Owner/krait/releases/assets/$($a.id)" -Headers $headers | Out-Null; Write-Output "deleted old asset: $zipName" } }
  $ok = $false
  for ($try = 1; $try -le 3 -and -not $ok; $try++) {
    try {
      Write-Output "uploading $zipName (attempt $try)..."
      Invoke-RestMethod -Method Post -Uri "$uploadBase`?name=$zipName" -Headers @{ Authorization = "token $token"; 'Content-Type' = 'application/zip'; 'User-Agent' = 'krait-publish' } -InFile (Join-Path $distDir $zipName) -TimeoutSec 900 | Out-Null
      $ok = $true; Write-Output '  done'
    } catch { Write-Output "  failed: $($_.Exception.Message)"; Start-Sleep -Seconds 5 }
  }
  if (-not $ok) { throw "upload of $zipName failed after 3 attempts" }
}
Write-Output ''
Write-Output "REBUILD + REPUBLISH COMPLETE: https://github.com/$Owner/krait/releases/tag/$Tag"
