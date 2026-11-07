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

rem With Docker Desktop off the database has stopped already, and a docker command could start it.
call :docker_running
if errorlevel 1 (
  echo [3/3] Docker Desktop асаагүй байна: өгөгдлийн сан аль хэдийн зогссон.
) else (
  echo [3/3] Өгөгдлийн санг ^(PostgreSQL^) зогсоож байна...
  docker compose stop
)

echo.
echo Bto зогслоо.
pause
exit /b 0

:docker_running
rem Asks Windows, not docker: on 2026-11-07 Docker Desktop started right after a docker command, three
rem times out of three, so any docker command here could bring it up by itself.
tasklist /FI "IMAGENAME eq com.docker.backend.exe" /NH | findstr /I "com.docker.backend.exe" >nul
exit /b %errorlevel%
