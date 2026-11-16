@echo off
rem krait CLI - chat in this terminal (default) or open the desktop app
if "%~1"=="--version" (
  echo krait 1.9.5 by Avepier - free AI coding agent
  exit /b 0
)
if "%~1"=="--help" (
  echo krait - free AI coding agent by Avepier
  echo   krait           chat right here in the terminal (streaming; /help inside)
  echo   krait app       open the desktop app window
  echo   krait --version print the version
  exit /b 0
)
if /i "%~1"=="app" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
  exit /b 0
)
rem piped/script stdin: electron directly (pump's powershell relay can drop tail bytes)
rem interactive console: pump.ps1 (electron can't read console stdin on Windows)
powershell -NoProfile -Command "exit ([int][Console]::IsInputRedirected)" 2>nul
if errorlevel 1 goto piped
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cli\pump.ps1" %*
exit /b 0
:piped
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0cli\krait-cli.js" %*
exit /b 0
