@echo off
rem krait CLI - chat in this terminal (default) or open the desktop app
if "%~1"=="--version" (
  echo krait 1.9.3 by Avepier - free AI coding agent
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
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0node_modules\electron\dist\electron.exe" "%~dp0cli\krait-cli.js" %*
exit /b 0
