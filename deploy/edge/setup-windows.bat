@echo off
rem The store edge on Windows (ADR-0136): double-click, or "Run as administrator" once to open the
rem kiosk port in the firewall. docs/runbooks/edge-install.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
