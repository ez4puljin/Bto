# Removes the Bto call bridge of the signed-in user: the background task (or its Startup
# shortcut), the desktop shortcut and %LOCALAPPDATA%\BtoCall (Python, the bridge, config.json with
# the key, metrics.csv, bridge.log). No administrator window is needed. Plain ASCII on purpose.
#
#   irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/call-bridge/windows/uninstall.ps1 | iex

$ErrorActionPreference = 'Continue'
$TaskName = 'Bto call bridge'
$Folder = Join-Path $env:LOCALAPPDATA 'BtoCall'
$PythonDir = Join-Path $Folder 'python'

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($PythonDir) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

foreach ($link in @(
    (Join-Path ([Environment]::GetFolderPath('Startup')) 'Bto call bridge.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bto AI call.lnk'))) {
  if (Test-Path $link) { Remove-Item -Force $link }
}
if (Test-Path $Folder) { Remove-Item -Recurse -Force $Folder }
# The phone link's firewall rule goes only from an administrator's window; otherwise it stays (harmless).
Remove-NetFirewallRule -DisplayName 'Bto call bridge (phone link)' -ErrorAction SilentlyContinue

Write-Host 'REMOVED. In Bto, make a new key for the line if this PC should no longer use the old one.' -ForegroundColor Green
