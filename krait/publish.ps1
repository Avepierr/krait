# publish.ps1 - publish krait to GitHub as a release, in one run.
# What it does:
#   1. signs in to GitHub once (a browser window pops up the first time; Windows stores it)
#   2. creates the github.com/Avepier/krait repo if it doesn't exist yet
#   3. pushes the source (master) + the v1.9.5 tag
#   4. creates the v1.9.5 GitHub release and uploads the win-x64 and win-ia32 zips
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File krait\publish.ps1
param(
  [string]$Repo = 'Avepier/krait',
  [string]$ZipDir = "$env:USERPROFILE\OneDrive\Desktop\Krait",
  [string]$Tag = 'v1.9.5'
)
$ErrorActionPreference = 'Stop'
$git = 'C:\Program Files\Git\cmd\git.exe'
$repoRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $repoRoot 'krait\package.json') -Raw | ConvertFrom-Json).version
$Tag = 'v' + $version

function Api([string]$method, [string]$url, [object]$body) {
  $headers = @{ Authorization = "token $script:token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'krait-publish' }
  if ($null -ne $body) {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6)
  } else {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers
  }
}

# ── 1. sign in (first run pops a browser; Windows remembers) ──
Write-Output '[1/4] signing in to GitHub...'
$proc = Start-Process -FilePath $git -ArgumentList 'credential','fill' -NoNewWindow -PassThru `
  -RedirectStandardInput (Join-Path $env:TEMP 'krait-cred-in.txt') -RedirectStandardOutput (Join-Path $env:TEMP 'krait-cred-out.txt') -RedirectStandardError (Join-Path $env:TEMP 'krait-cred-err.txt')
Set-Content (Join-Path $env:TEMP 'krait-cred-in.txt') "protocol=https`nhost=github.com`n`n"
$proc.WaitForExit(300000) | Out-Null
if (-not $proc.HasExited) { $proc.Kill(); throw 'GitHub sign-in timed out (5 min) - run publish.ps1 again' }
$credOut = Get-Content (Join-Path $env:TEMP 'krait-cred-out.txt') -Raw
$token = [regex]::Match($credOut, '(?m)^password=(.+)$').Groups[1].Value.Trim()
if (-not $token) { throw 'no GitHub token received - sign-in failed' }
Write-Output '  signed in.'

# ── 2. repo ──
Write-Output '[2/4] checking the GitHub repo...'
try { Api GET "https://api.github.com/repos/$Repo" | Out-Null; Write-Output "  repo exists: github.com/$Repo" }
catch {
  Write-Output '  creating the repo...'
  Api POST 'https://api.github.com/user/repos' @{ name = ($Repo -split '/')[1]; description = 'krait - free AI coding agent by Avepier (desktop app + terminal chat)'; private = $false; has_issues = $true } | Out-Null
  Write-Output "  created: github.com/$Repo"
}

# ── 3. push source + tag ──
Write-Output '[3/4] pushing source and tag...'
& $git -C $repoRoot remote remove origin 2>$null
& $git -C $repoRoot remote add origin "https://github.com/$Repo.git" | Out-Null
& $git -C $repoRoot push origin master 2>&1 | ForEach-Object { Write-Output "  $_" }
& $git -C $repoRoot push origin $Tag 2>&1 | ForEach-Object { Write-Output "  $_" }
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }

# ── 4. release + zips ──
Write-Output "[4/4] creating release $Tag..."
$notes = @"
krait $Tag - by Avepier

- opencode-style terminal chat: type `krait` in PowerShell
- free-first: free models top of every list, auto-switch to another free provider on daily limits
- agent mode with y/N permission prompts (file tools)
- real installer: unzip, run install.ps1 - desktop app + terminal command, no admin needed

Downloads: win-x64 for most PCs, win-ia32 for 32-bit Windows (uses Electron 43, the last 32-bit line).
"@
$existing = $null
try { $existing = Api GET "https://api.github.com/repos/$Repo/releases/tags/$Tag" } catch {}
if ($existing -and $existing.id) {
  Write-Output '  release already exists'
  $rel = $existing
} else {
  $rel = Api POST "https://api.github.com/repos/$Repo/releases" @{ tag_name = $Tag; name = "krait $Tag"; body = $notes; draft = $false; prerelease = $false }
  Write-Output '  release created'
}
$uploadBase = ($rel.upload_url -split '\{')[0]
foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  $zip = Join-Path $ZipDir $zipName
  if (-not (Test-Path $zip)) { Write-Output "  SKIPPED (not found): $zip"; continue }
  Write-Output "  uploading $zipName ..."
  $headers = @{ Authorization = "token $token"; 'Content-Type' = 'application/zip'; 'User-Agent' = 'krait-publish' }
  Invoke-RestMethod -Method Post -Uri "$uploadBase`?name=$zipName" -Headers $headers -InFile $zip | Out-Null
  Write-Output "    done"
}
Write-Output ''
Write-Output "PUBLISH COMPLETE: https://github.com/$Repo/releases/tag/$Tag"
