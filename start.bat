@echo off
rem Bto (Tugeel) development servers for this PC and the local network (owner, 2026-10-13).
rem Starts PostgreSQL (installed on Windows, tools\dev-db), applies pending migrations, then runs "pnpm dev" in its own
rem window with Vite listening on every interface (DEV_LAN=1): another PC on the same network opens
rem http://<this PC's address>:5173. stop.bat stops everything again.
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Bto start

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm олдсонгүй. Node 26 суулгаад: npm i -g pnpm@11.28.2
  goto :fail
)

rem The database runs on Windows itself since 2026-11-09 (owner): no Docker, and this script never
rem starts Docker Desktop. dev-db.ps1 says which of its exit codes means what.
echo [1/4] Өгөгдлийн сан ^(PostgreSQL^) асааж байна...
powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev-db\dev-db.ps1 start
rem Exact codes: "if errorlevel N" means N or more and lets a negative code (powershell failing) through.
set "dbcode=%errorlevel%"
if "%dbcode%"=="0" goto :db_ready
if "%dbcode%"=="5" (
  echo Өгөгдлийн сан асахгүй байна. Шалтгаан нь дээрх мөрүүдэд, бүтнээрээ pg_ctl.log файлд байна.
  goto :fail
)
if "%dbcode%"=="4" (
  echo 15432 портыг өөр програм эзэлсэн байна. Ихэвчлэн хуучин Docker-ийн tugeel-postgres-1:
  echo Docker Desktop дээр түүнийг зогсоогоод start.bat-ийг дахин ажиллуулна уу.
  goto :fail
)
if "%dbcode%"=="3" (
  echo PostgreSQL 18 суугаагүй байна ^(C:\Program Files\PostgreSQL\18^). tools\dev-db\README.md-ийг харна уу.
  goto :fail
)
if "%dbcode%"=="2" (
  echo Өгөгдлийн сангийн хавтас олдсонгүй ^(%LOCALAPPDATA%\Bto\pg18^). tools\dev-db\README.md-ийг харна уу.
  goto :fail
)
echo Өгөгдлийн санг асаах скрипт ажилласангүй ^(код %dbcode%^). tools\dev-db\dev-db.ps1 байгаа эсэхийг шалгана уу.
goto :fail

:db_ready

if exist node_modules (
  echo [2/4] Сангууд суусан байна.
) else (
  echo [2/4] Сангууд суулгаж байна ^(pnpm install^)...
  call pnpm install
  if errorlevel 1 goto :fail
)

echo [3/4] Өгөгдлийн сангийн шинэчлэлт ^(migration^)...
call pnpm db:migrate
if errorlevel 1 goto :fail

call :listening 5173
if not errorlevel 1 (
  echo [4/4] Сервер аль хэдийн ажиллаж байна.
  goto :ready
)

echo [4/4] Серверүүдийг асааж байна. "Bto dev" цонх нээгдэнэ, түүнийг бүү хаа.
set DEV_LAN=1
start "Bto dev" cmd /k pnpm dev

echo Вэб сервер бэлэн болохыг хүлээж байна ^(1-3 минут^)...
for /l %%i in (1,1,90) do (
  call :listening 5173
  if not errorlevel 1 goto :ready
  ping -n 3 127.0.0.1 >nul
)
echo Вэб сервер 3 минутад асаагүй. "Bto dev" цонхонд гарсан алдааг харна уу.
goto :fail

:ready
echo.
echo Bto ажиллаж байна:
echo   Энэ компьютерээс:  http://localhost:5173
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | ForEach-Object { $_.IPv4Address.IPAddress }"`) do echo   Өөр компьютерээс:  http://%%a:5173
echo.
echo Өөр компьютерээс нээгдэхгүй бол: энэ компьютерийн сүлжээ "Private" байх, Windows Defender
echo Firewall-д Node.js-ийг Private сүлжээнд зөвшөөрсөн байх хэрэгтэй.
echo Зогсоохдоо stop.bat-ийг ажиллуулна.
echo.
pause
exit /b 0

:listening
netstat -ano | findstr /r /c:":%1 .*LISTENING" >nul
exit /b %errorlevel%

:fail
pause
exit /b 1
