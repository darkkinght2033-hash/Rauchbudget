@echo off
title WhatsApp Auto Reply v3 KI
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte Node.js LTS installieren: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installiere benoetigte Pakete...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
start "" http://localhost:3000
node server.js
pause
