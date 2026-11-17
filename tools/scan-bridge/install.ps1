# Installs the Bto scan bridge on the office PC the scanner is plugged into (ADR-0212).
# Run in a PowerShell window opened with "Run as administrator" (Windows 10 or later):
#
#   irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/scan-bridge/install.ps1 | iex
#
# or, from a copy of this folder:   powershell -ExecutionPolicy Bypass -File install.ps1
#
# What it does, each step safe to repeat:
#   1. copies scan-bridge.ps1 to C:\ProgramData\BtoScan
#   2. lets the signed-in user listen on the port (netsh http add urlacl)
#   3. opens the port in the firewall for the Bto server's address only
#   4. starts the bridge now and at every sign-in of that user (a scheduled task)
#   5. asks the bridge what scanner it sees and prints the address to type into Bto
# Plain ASCII on purpose (see scan-bridge.ps1).

param(
  # The Bto server: the only other machine the bridge answers.
  [string]$Server = '192.168.1.250',
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Bto scan bridge'
$RuleName = 'Bto scan bridge'
$Folder = Join-Path $env:ProgramData 'BtoScan'
$Script = Join-Path $Folder 'scan-bridge.ps1'
$Source = 'https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/scan-bridge/scan-bridge.ps1'

function Install-Bridge {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ''
    Write-Host 'NOT INSTALLED: this window is not an administrator window.' -ForegroundColor Red
    Write-Host 'Close it, right-click PowerShell, choose "Run as administrator", and run the same line again.'
    return
  }

  # The person who works at this PC: the bridge must run in their session to reach the scanner.
  $user = (Get-CimInstance Win32_ComputerSystem).UserName
  if (-not $user) { $user = $identity.Name }
  Write-Host "1/5  copying the bridge to $Folder (it will run as $user)"
  New-Item -ItemType Directory -Force -Path $Folder | Out-Null
  $beside = ''
  if ($PSScriptRoot) { $beside = Join-Path $PSScriptRoot 'scan-bridge.ps1' }
  if ($beside -and (Test-Path $beside)) {
    Copy-Item -Force $beside $Script
  } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Script
  }
  # The signed-in user writes the log there.
  & icacls $Folder /grant "${user}:(OI)(CI)M" | Out-Null

  Write-Host "2/5  letting $user listen on port $Port"
  & netsh http delete urlacl url="http://+:$Port/" | Out-Null
  & netsh http add urlacl url="http://+:$Port/" user="$user" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "netsh could not reserve port $Port" }

  Write-Host "3/5  opening port $Port in the firewall for $Server only"
  & netsh advfirewall firewall delete rule name="$RuleName" | Out-Null
  & netsh advfirewall firewall add rule name="$RuleName" dir=in action=allow protocol=TCP localport=$Port remoteip=$Server | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'netsh could not add the firewall rule' }

  Write-Host '4/5  starting the bridge, now and at every sign-in'
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`" -Port $Port -AllowFrom $Server"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $runAs = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Start-Sleep -Seconds 2
  }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $runAs -Settings $settings | Out-Null
  Start-ScheduledTask -TaskName $TaskName

  Write-Host '5/5  asking the bridge what it sees'
  $seen = ''
  for ($attempt = 0; $attempt -lt 10 -and -not $seen; $attempt++) {
    Start-Sleep -Seconds 2
    try { $seen = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/" -TimeoutSec 15).Content } catch { }
  }

  $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } |
      ForEach-Object { $_.IPAddress })

  Write-Host ''
  if (-not $seen) {
    Write-Host 'INSTALLED, BUT THE BRIDGE DID NOT ANSWER.' -ForegroundColor Yellow
    Write-Host "Look at $Folder\bridge.log, sign out and in again, and run this line once more."
    return
  }
  Write-Host "INSTALLED.  $seen" -ForegroundColor Green
  if ($seen -match 'no scanner found') {
    Write-Host 'The bridge runs, but Windows shows it no scanner: switch the scanner on, check its USB cable' -ForegroundColor Yellow
    Write-Host 'and that Windows "Scan" / "Windows Fax and Scan" can scan with it. Nothing has to be installed again.' -ForegroundColor Yellow
  }
  Write-Host ''
  Write-Host 'In Bto: Orlogo -> Padaan unshikh -> Scanner tokhiruulakh -> Scanner nemekh, and type this address:'
  foreach ($address in $addresses) { Write-Host "    http://${address}:$Port" -ForegroundColor Cyan }
  if ($addresses.Count -eq 0) { Write-Host "    http://<this PC's address>:$Port" -ForegroundColor Cyan }
  Write-Host ''
  Write-Host 'This PC must keep the same address: ask whoever looks after the router to reserve it.'
}

Install-Bridge
