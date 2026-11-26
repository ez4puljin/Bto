@echo off
setlocal
cd /d "%~dp0"
title Bto MAIN
".data\local-dev\runtime\node-v26.7.0-win-x64\node.exe" tools\local-start\start.mjs main
if errorlevel 1 pause
