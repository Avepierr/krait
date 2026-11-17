# upload-zips.ps1 - upload the release zips to the existing GitHub release.
# Reads the stored GitHub login (no popup). Safe to re-run: re-uploading an
# asset that already exists gets deleted first.
param([string]$Owner = 'Avepierr')
$ErrorActionPreference = 'Stop'
$git = 'C:\Program Files\Git\cmd\git.exe'
$repoRoot = Split-Path -Parent $PSScriptRoot
$kraitDir = Join-Path $repoRoot 'krait'
$distDir = Join-Path $repoRoot 'dist'
$version = (Get-Content (Join-Path $kraitDir 'package.json') -Raw | ConvertFrom-Json).version
$Tag = 'v' + $version
$Repo = "$Owner/krait"

# stored credential -> token
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
$rel = Invoke-RestMethod -Method GET -Uri "https://api.github.com/repos/$Repo/releases/tags/$Tag" -Headers $headers
$uploadBase = ($rel.upload_url -split '\{')[0]
Write-Output "release found: $($rel.name) (id $($rel.id))"

foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  $zip = Join-Path $distDir $zipName
  if (-not (Test-Path $zip)) { $zip = Join-Path (Join-Path $env:USERPROFILE 'OneDrive\Desktop\Krait') $zipName }
  if (-not (Test-Path $zip)) { Write-Output "SKIPPED (not found): $zipName"; continue }
  # delete an existing asset with the same name so re-runs are clean
  foreach ($a in $rel.assets) { if ($a.name -eq $zipName) { Invoke-RestMethod -Method DELETE -Uri "https://api.github.com/repos/$Repo/releases/assets/$($a.id)" -Headers $headers | Out-Null; Write-Output "  replaced old asset: $zipName" } }
  $size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
  Write-Output "uploading $zipName ($size MB)..."
  Invoke-RestMethod -Method Post -Uri "$uploadBase`?name=$zipName" -Headers @{ Authorization = "token $token"; 'Content-Type' = 'application/zip'; 'User-Agent' = 'krait-publish' } -InFile $zip | Out-Null
  Write-Output "  done"
}
Write-Output "UPLOAD COMPLETE: https://github.com/$Repo/releases/tag/$Tag"
