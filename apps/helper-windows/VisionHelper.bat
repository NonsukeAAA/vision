@echo off
chcp 65001 >nul
title vision helper
cd /d "%~dp0"

:: One-click resident helper for JoyCaption local API.
:: Needs Docker Desktop (recommended) or Python 3.12+.

where powershell >nul 2>&1
if errorlevel 1 (
  echo PowerShell が見つかりません。
  pause
  exit /b 1
)

echo vision helper を起動しています…
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0VisionHelper.ps1"
if errorlevel 1 (
  echo.
  echo 起動に失敗しました。README.txt を確認してください。
  pause
)
