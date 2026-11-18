# publish.ps1 - publish krait to GitHub as a release, in one run.
# Order matters: the git push runs FIRST - a successful push is what makes
# Windows store the GitHub login permanently. The API steps then read the
# stored credential, which is instant and needs no popup.
# IMPORTANT: if a GitHub window opens during the push, APPROVE it (don't close it).
# Run:  powershell -ExecutionPolicy Bypass -File krait\publish.ps1
param([string]$Owner = 'Avepierr')
$ErrorActionPreference = 'Stop'
$git = 'C:\Program Files\Git\cmd\git.exe'
$repoRoot = Split-Path -Parent $PSScriptRoot
$kraitDir = Join-Path $repoRoot 'krait'
$distDir = Join-Path $repoRoot 'dist'
$version = (Get-Content (Join-Path $kraitDir 'package.json') -Raw | ConvertFrom-Json).version
$Tag = 'v' + $version
$Repo = "$Owner/krait"

function Api([string]$method, [string]$url, [object]$body, [string]$ct = 'application/json') {
  $headers = @{ Authorization = "token $script:token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'krait-publish' }
  if ($null -ne $body) {
    # send UTF-8 bytes: PS 5.1 otherwise mangles non-ASCII text and GitHub answers "Problems parsing JSON"
    $json = $body | ConvertTo-Json -Depth 6
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType $ct -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
  } else {
    Invoke-RestMethod -Method $method -Uri $url -Headers $headers
  }
}

# ── 1. push source + tag (this stores the login on success) ──
Write-Output '[1/6] pushing source and tag...'
# keep version.json (the /update + popup endpoint) in sync with package.json
$versionJson = Join-Path $repoRoot 'version.json'
$vj = '{' + [char]10 + '  "version": "' + $version + '"' + [char]10 + '}' + [char]10
Set-Content $versionJson $vj -NoNewline
& $git -C $repoRoot add $versionJson
& $git -C $repoRoot commit -m "release $Tag" 2>&1 | Out-Null
Write-Output '  >>> IF A GITHUB WINDOW OPENS: APPROVE IT (logging in as github.com/Avepierr) <<<'
$remotes = & $git -C $repoRoot remote
if ($remotes -contains 'origin') { & $git -C $repoRoot remote remove origin | Out-Null }
& $git -C $repoRoot remote add origin "https://github.com/$Repo.git" | Out-Null
# git writes progress to stderr; EAP Stop would treat that as a fatal error - relax it for the push
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& $git -C $repoRoot push origin main 2>&1 | ForEach-Object { Write-Output "  $_" }
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $eap
if ($pushCode -ne 0) { throw 'git push failed - was the GitHub window closed instead of approved?' }
& $git -C $repoRoot tag -f $Tag | Out-Null
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
& $git -C $repoRoot push -f origin $Tag 2>&1 | ForEach-Object { Write-Output "  $_" }
$pushCode = $LASTEXITCODE
$ErrorActionPreference = $eap
if ($pushCode -ne 0) { throw 'git tag push failed' }
Write-Output '  pushed - the login is now saved on this PC.'

# ── 2. read the stored credential ──
Write-Output '[2/6] reading the stored GitHub login...'
$inFile = Join-Path $env:TEMP 'krait-cred-in.txt'
$outFile = Join-Path $env:TEMP 'krait-cred-out.txt'
Set-Content $inFile "protocol=https`nhost=github.com`nusername=$Owner`n`n"
$proc = Start-Process -FilePath $git -ArgumentList 'credential','fill' -NoNewWindow -PassThru `
  -RedirectStandardInput $inFile -RedirectStandardOutput $outFile -RedirectStandardError (Join-Path $env:TEMP 'krait-cred-err.txt')
$proc.WaitForExit(120000) | Out-Null
if (-not $proc.HasExited) { $proc.Kill(); throw 'credential read timed out - run publish.ps1 again' }
$credRaw = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
if ($credRaw) { $token = [regex]::Match($credRaw, '(?m)^password=(.+)$').Groups[1].Value.Trim() }
if (-not $token) { throw 'no stored GitHub login found - the push popup must be approved once (it saves it)' }
Write-Output '  login found.'

# ── 3. repo exists? ──
try { Api GET "https://api.github.com/repos/$Repo" | Out-Null; Write-Output "[3/6] repo exists: github.com/$Repo" }
catch {
  Write-Output "[3/6] creating the repo (public)..."
  Api POST 'https://api.github.com/user/repos' @{ name = 'krait'; description = 'krait - free AI coding agent by Avepier. Desktop app + terminal chat. Model-agnostic, free-tier friendly.'; private = $false; has_issues = $true; has_wiki = $false } | Out-Null
}

# ── 4. /update URL check (should already be correct) ──
$cli = Join-Path $kraitDir 'cli\krait-cli.js'
$raw = Get-Content $cli -Raw
$wantUrl = "https://raw.githubusercontent.com/$Owner/krait/main/version.json"
if (-not $raw.Contains($wantUrl)) {
  Write-Output "[4/6] pointing the /update check at $wantUrl and rebuilding zips..."
  $raw = $raw -replace "https://raw\.githubusercontent\.com/[^/]+/krait/main/version\.json", $wantUrl
  Set-Content $cli $raw -NoNewline
  & $git -C $repoRoot add $cli
  & $git -C $repoRoot commit -m "/update check now reads $wantUrl" | Out-Null
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  & $git -C $repoRoot push origin main 2>&1 | ForEach-Object { Write-Output "  $_" }
  $ErrorActionPreference = $eap
  Write-Output '  rebuilding the release zips so they carry the right URL...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kraitDir 'package.ps1') -Arch x64
  if ($LASTEXITCODE -ne 0) { throw 'x64 zip build failed' }
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $kraitDir 'package.ps1') -Arch ia32
  if ($LASTEXITCODE -ne 0) { throw 'ia32 zip build failed' }
  Write-Output '  zips rebuilt in dist\'
} else { Write-Output '[4/6] /update URL already correct' }

# ── 5. description, topics ──
Write-Output '[5/6] setting description and topics...'
Api PATCH "https://api.github.com/repos/$Repo" @{ description = 'krait - free AI coding agent by Avepier. Desktop app + terminal chat. Model-agnostic, free-tier friendly, private by design.'; homepage = "https://github.com/$Repo/releases" } | Out-Null
Api PUT "https://api.github.com/repos/$Repo/topics" @{ names = @('ai', 'ai-agent', 'chat', 'claude-alternative', 'coding-agent', 'electron', 'free', 'ollama', 'openrouter', 'terminal', 'windows') } | Out-Null

# ── 6. release + zips ──
Write-Output "[6/6] creating release $Tag..."
# notes come from krait\RELEASE-NOTES.md so every release keeps its own story
$notesFile = Join-Path $kraitDir 'RELEASE-NOTES.md'
if (Test-Path $notesFile) {
  $notes = Get-Content $notesFile -Raw -Encoding UTF8
} else {
  $notes = "krait $Tag - by Avepier`n`nFree, model-agnostic AI coding agent: desktop app + terminal chat.`n`nDownloads: win-x64 for most PCs, win-ia32 for 32-bit Windows.`n"
}
$rel = $null
try { $rel = Api GET "https://api.github.com/repos/$Repo/releases/tags/$Tag" } catch {}
if ($rel -and $rel.id) { Write-Output '  release already exists - uploading assets to it' }
else {
  # build the JSON by hand: Windows PowerShell's ConvertTo-Json mangles long
  # multi-line strings (GitHub then answers "Problems parsing JSON")
  function Esc-Json([string]$s) {
    return $s.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '\n').Replace("`t", '\t')
  }
  $payload = '{"tag_name":"' + (Esc-Json $Tag) + '","name":"krait ' + (Esc-Json $Tag) +
    '","body":"' + (Esc-Json $notes) + '","draft":false,"prerelease":false}'
  $headers = @{ Authorization = "token $token"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'krait-publish' }
  $rel = Invoke-RestMethod -Method POST -Uri "https://api.github.com/repos/$Repo/releases" -Headers $headers `
    -ContentType 'application/json' -Body ([System.Text.Encoding]::UTF8.GetBytes($payload))
  Write-Output '  release created'
}
$uploadBase = ($rel.upload_url -split '\{')[0]
# a retry must not hit "already_exists": drop same-named assets first
$rel = Api GET "https://api.github.com/repos/$Repo/releases/tags/$Tag"
foreach ($a in $rel.assets) {
  if ($a.name -like "krait-$version-win-*.zip") {
    Api DELETE "https://api.github.com/repos/$Repo/releases/assets/$($a.id)" | Out-Null
    Write-Output "  replaced old asset: $($a.name)"
  }
}
foreach ($zipName in @("krait-$version-win-x64.zip", "krait-$version-win-ia32.zip")) {
  # look in dist\ first, then the Desktop\Krait folder where release copies live
  $zip = Join-Path $distDir $zipName
  if (-not (Test-Path $zip)) { $zip = Join-Path (Join-Path $env:USERPROFILE 'OneDrive\Desktop\Krait') $zipName }
  if (-not (Test-Path $zip)) { Write-Output "  SKIPPED (not found): $zipName"; continue }
  Write-Output "  uploading $zipName ..."
  $headers = @{ Authorization = "token $token"; 'Content-Type' = 'application/zip'; 'User-Agent' = 'krait-publish' }
  $ok = $false
  for ($try = 1; $try -le 3 -and -not $ok; $try++) {
    try { $ok = $true; Invoke-RestMethod -Method Post -Uri "$uploadBase`?name=$zipName" -Headers $headers -InFile $zip -TimeoutSec 900 | Out-Null }
    catch {
      $ok = $false
      Write-Output "    attempt $try failed: $($_.Exception.Message)"
      Start-Sleep -Seconds 5
    }
  }
  if (-not $ok) { throw "upload of $zipName failed after 3 attempts" }
  Write-Output '    done'
}
Write-Output ''
Write-Output "PUBLISH COMPLETE: https://github.com/$Repo"
Write-Output "Release: https://github.com/$Repo/releases/tag/$Tag"
