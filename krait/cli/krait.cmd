@echo off
rem krait CLI shim - launches the krait app (or prints version)
rem Works from PowerShell and CMD once this file is on PATH (the installer does that).
if "%~1"=="--version" (
  echo krait 1.9.2 by Avepier - free AI coding agent
  exit /b 0
)
if "%~1"=="--help" (
  echo krait - free AI coding agent by Avepier
  echo   krait            launch the krait app
  echo   krait --version  print the version
  exit /b 0
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
