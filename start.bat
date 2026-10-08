@echo off
cd /d "%~dp0"
start "simul-interpreter server" /min node server.js
timeout /t 1 /nobreak >nul
start "" msedge "http://localhost:8765/"
