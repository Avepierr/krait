@echo off
rem krait CLI - chat in this terminal (default) or open the desktop app
if "%~1"=="--version" (
  echo krait 1.9.4 by Avepier - free AI coding agent
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
rem chat (pipe or interactive console - pump.ps1 decides; electron can't read console stdin on Windows)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cli\pump.ps1" %*
exit /b 0
