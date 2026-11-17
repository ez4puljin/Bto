# Removes the Bto scan bridge from this PC (ADR-0212): its task, its firewall rule, its port
# reservation and its folder. Run in a PowerShell window opened with "Run as administrator":
#
#   irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/scan-bridge/uninstall.ps1 | iex
#
# Plain ASCII on purpose (see scan-bridge.ps1).

param([int]$Port = 8765)

$TaskName = 'Bto scan bridge'
$RuleName = 'Bto scan bridge'
$Folder = Join-Path $env:ProgramData 'BtoScan'

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
  & netsh advfirewall firewall delete rule name="$RuleName" | Out-Null
  & netsh http delete urlacl url="http://+:$Port/" | Out-Null
  Start-Sleep -Seconds 2
  if (Test-Path $Folder) { Remove-Item -Recurse -Force $Folder -ErrorAction SilentlyContinue }
  Write-Host 'REMOVED. In Bto, switch the scanner off under "Scanner tokhiruulakh".' -ForegroundColor Green
}

Uninstall-Bridge
