# pump.ps1 - krait CLI launcher for the PC terminal.
# Why this exists: electron.exe (run-as-node) cannot read console stdin on Windows -
# readline gets instant EOF. So for interactive sessions this script reads the real
# console and pumps each typed line into krait's stdin, while krait's output streams
# straight to the console (colors and all). Piped input (scripts/tests) skips the
# pump entirely and behaves exactly like before.
$ErrorActionPreference = 'Stop'
$cliDir = $PSScriptRoot
$kraitDir = Split-Path -Parent $cliDir
$exe = Join-Path $kraitDir 'node_modules\electron\dist\electron.exe'
$cli = Join-Path $cliDir 'krait-cli.js'
$env:ELECTRON_RUN_AS_NODE = '1'

if ([Console]::IsInputRedirected) {
  # stdin is a pipe - electron reads pipes fine, run exactly as before
  & $exe $cli @args
  exit $LASTEXITCODE
}

# interactive console: read real console lines, feed them to krait
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = '"{0}" {1}' -f $cli, ($args -join ' ')
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.CreateNoWindow = $false
$psi.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
$psi.EnvironmentVariables['KRAIT_PUMP'] = '1'
$p = [System.Diagnostics.Process]::Start($psi)
$p.StandardInput.AutoFlush = $true
try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    try { $p.StandardInput.WriteLine($line) } catch { break }
    if ($p.HasExited) { break }
  }
} finally {
  if (-not $p.HasExited) { try { $p.Kill() } catch {} }
}
exit $p.ExitCode
