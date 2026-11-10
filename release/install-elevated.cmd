@echo off
setlocal
set "SETUP=%~dp0MrTyper_2.0.0_x64-setup.exe"
if not exist "%SETUP%" (
  echo MrTyper setup was not found next to this helper.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%SETUP%' -Verb RunAs"
