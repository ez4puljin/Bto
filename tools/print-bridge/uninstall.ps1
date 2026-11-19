# Removes the Bto print bridge from this PC (ADR-0226): its task and its folder (with the key).
# Run in a PowerShell window opened with "Run as administrator":
#
#   irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/print-bridge/uninstall.ps1 | iex
#
# Plain ASCII on purpose (see print-bridge.ps1).

$TaskName = 'Bto print bridge'
$Folder = Join-Path $env:ProgramData 'BtoPrint'

function Uninstall-Bridge {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'NOT REMOVED: open PowerShell with "Run as administrator" and run the same line again.' -ForegroundColor Red
    return
  }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  Start-Sleep -Seconds 2
  if (Test-Path $Folder) { Remove-Item -Recurse -Force $Folder -ErrorAction SilentlyContinue }
  Write-Host 'REMOVED. In Bto, disable the printer under "Sistem -> Printer".' -ForegroundColor Green
}

Uninstall-Bridge
