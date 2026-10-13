@echo off
rem Stops what start.bat started: the "Bto dev" window and every node process of this repository
rem (web, api, worker). Servers of other projects (for example the one on port 3000) are left
rem alone. PostgreSQL stops but keeps its data.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Bto stop

echo [1/3] "Bto dev" цонхыг хааж байна...
taskkill /FI "WINDOWTITLE eq Bto dev*" /T /F >nul 2>&1

echo [2/3] Энэ төслийн Node процессуудыг зогсоож байна...
powershell -NoProfile -Command "$root = (Get-Location).Path.ToLower(); Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.Replace('/', '\').ToLower().Contains($root) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [3/3] Өгөгдлийн санг ^(PostgreSQL^) зогсоож байна...
docker compose stop

echo.
echo Bto зогслоо.
pause
