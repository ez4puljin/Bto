@echo off
setlocal
cd /d "%~dp0"
title Bto TEST
".data\local-dev\runtime\node-v26.7.0-win-x64\node.exe" tools\local-start\start.mjs qa
if errorlevel 1 pause
