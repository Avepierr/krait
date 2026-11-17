# publish.ps1 - publish krait to GitHub as a release, in one run.
#   1. signs in to GitHub once (a browser window pops up the first time; Windows stores it)
#   2. detects your username and creates github.com/<you>/krait if it doesn't exist
#   3. points the app's /update check at the real repo and rebuilds both zips if needed
#   4. pushes the source + tag, sets description/topics, creates the release, uploads the zips
# Run:  powershell -ExecutionPolicy Bypass -File krait\publish.ps1
param()
$ErrorActionPreference = 'Stop'
$git = 'C:\Program Files\Git\cmd\git.exe'
$repoRoot = Split-Path -Parent $PSScriptRoot
$kraitDir = Join-Path $repoRoot 'krait'
$distDir = Join-Path $repoRoot 'dist'
$version = (Get-Content (Join-Path $kraitDir 'package.json') -Raw | ConvertFrom-Json).version
$Tag = 'v' + $version

function Api([string]$method, [string]$url, [object]$body, [string]$ct = 'application/json') {
  $headers = @{ Authorization = "token $script:token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'krait-publish' }
  if ($null -ne $body) {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType $ct -Body ($body | ConvertTo-Json -Depth 6)
  } else {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers
  }
}

# ── 1. sign in ──
Write-Output '[1/6] signing in to GitHub (approve the browser window if one opens)...'
$inFile = Join-Path $env:TEMP 'krait-cred-in.txt'
$outFile = Join-Path $env:TEMP 'krait-cred-out.txt'
Set-Content $inFile "protocol=https`nhost=github.com`n`n"
$proc = Start-Process -FilePath $git -ArgumentList 'credential','fill' -NoNewWindow -PassThru `
  -RedirectStandardInput $inFile -RedirectStandardOutput $outFile -RedirectStandardError (Join-Path $env:TEMP 'krait-cred-err.txt')
$proc.WaitForExit(300000) | Out-Null
if (-not $proc.HasExited) { $proc.Kill(); throw 'GitHub sign-in timed out (5 min) - run publish.ps1 again' }
$token = [regex]::Match((Get-Content $outFile -Raw), '(?m)^password=(.+)$').Groups[1].Value.Trim()
if (-not $token) { throw 'no GitHub token received - sign-in failed' }
Write-Output '  signed in.'

# ── 2. who am I / repo ──
$me = Api GET 'https://api.github.com/user'
$owner = $me.login
$Repo = "$owner/krait"
Write-Output "[2/6] account: $owner -> repo github.com/$Repo"
try { Api GET "https://api.github.com/repos/$Repo" | Out-Null; Write-Output '  repo exists' }
catch {
  Write-Output '  creating the repo (public)...'
  Api POST 'https://api.github.com/user/repos' @{ name = 'krait'; description = 'krait - free AI coding agent by Avepier. Desktop app + terminal chat. Model-agnostic, free-tier friendly.'; private = $false; has_issues = $true; has_wiki = $false } | Out-Null
}

# ── 3. aim the update check at the real repo + rebuild zips if it changed ──
$oldUrl = 'https://raw.githubusercontent.com/Avepier/krait/main/version.json'
$newUrl = "https://raw.githubusercontent.com/$owner/krait/main/version.json"
if ($owner -ne 'Avepier') {
  $cli = Join-Path $kraitDir 'cli\krait-cli.js'
  $raw = Get-Content $cli -Raw
  if ($raw.Contains($oldUrl)) {
    Write-Output '[3/6] pointing the /update check at github.com/' + $owner + '/krait ...'
    Set-Content $cli ($raw.Replace($oldUrl, $newUrl)) -NoNewline
    & $git -C $repoRoot add $cli
    & $git -C $repoRoot commit -m "/update check now reads github.com/$owner/krait" | Out-Null
    Write-Output '  rebuilding the release zips so they carry the right URL...'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kraitDir 'package.ps1') -Arch x64
    if ($LASTEXITCODE -ne 0) { throw 'x64 zip build failed' }
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kraitDir 'package.ps1') -Arch ia32
    if ($LASTEXITCODE -ne 0) { throw 'ia32 zip build failed' }
    Write-Output '  zips rebuilt in dist\'
  } else { Write-Output '[3/6] update URL already correct' }
} else { Write-Output '[3/6] publishing as Avepier/krait' }

# ── 4. push source + tag ──
Write-Output '[4/6] pushing source and tag...'
# (no 2>$null here - a stderr write with ErrorActionPreference Stop kills the script)
$remotes = & $git -C $repoRoot remote
if ($remotes -contains 'origin') { & $git -C $repoRoot remote remove origin | Out-Null }
& $git -C $repoRoot remote add origin "https://github.com/$Repo.git" | Out-Null
& $git -C $repoRoot push origin master 2>&1 | ForEach-Object { Write-Output "  $_" }
& $git -C $repoRoot tag -f $Tag | Out-Null
& $git -C $repoRoot push -f origin $Tag 2>&1 | ForEach-Object { Write-Output "  $_" }
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }

# ── 5. description, topics ──
Write-Output '[5/6] setting description and topics...'
Api PATCH "https://api.github.com/repos/$Repo" @{ description = 'krait - free AI coding agent by Avepier. Desktop app + terminal chat. Model-agnostic, free-tier friendly, private by design.'; homepage = "https://github.com/$owner/krait/releases" } | Out-Null
Api PUT "https://api.github.com/repos/$Repo/topics" @{ names = @('ai', 'ai-agent', 'chat', 'claude-alternative', 'coding-agent', 'electron', 'free', 'ollama', 'openrouter', 'terminal', 'windows') } | Out-Null

# ── 6. release + zips ──
Write-Output "[6/6] creating release $Tag..."
$notes = @"
krait $Tag - by Avepier

**Free-first release:** free models on top of every list, and a full daily free limit
no longer blocks you - krait auto-switches to another free provider.

- opencode-style terminal chat: type ``krait`` in PowerShell
- agent mode with y/N permission prompts (reads/writes/edits files, asks first)
- model picker with search + Free tags + recents, UI color themes (``/theme``)
- ``/update`` version check against this repo
- real installer: unzip, run install.ps1 - desktop app + terminal command, no admin needed
- 32-bit Windows build (Electron 43, the last 32-bit line)

**Downloads:** win-x64 for most PCs, win-ia32 for 32-bit Windows.
"@
$rel = $null
try { $rel = Api GET "https://api.github.com/repos/$Repo/releases/tags/$Tag" } catch {}
if ($rel -and $rel.id) { Write-Output '  release already exists - uploading assets to it' }
else {
  $rel = Api POST "https://api.github.com/repos/$Repo/releases" @{ tag_name = $Tag; name = "krait $Tag"; body = $notes; draft = $false; prerelease = $false }
  Write-Output '  release created'
}
$uploadBase = ($rel.upload_url -split '\{')[0]
foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  $zip = Join-Path $distDir $zipName
  if (-not (Test-Path $zip)) { Write-Output "  SKIPPED (not found): $zip"; continue }
  Write-Output "  uploading $zipName ..."
  $headers = @{ Authorization = "token $token"; 'Content-Type' = 'application/zip'; 'User-Agent' = 'krait-publish' }
  Invoke-RestMethod -Method Post -Uri "$uploadBase`?name=$zipName" -Headers $headers -InFile $zip | Out-Null
  Write-Output '    done'
}
Write-Output ''
Write-Output "PUBLISH COMPLETE: https://github.com/$Repo"
Write-Output "Release: https://github.com/$Repo/releases/tag/$Tag"
