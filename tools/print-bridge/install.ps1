# Installs the Bto print bridge on the Windows PC the label printer is attached to (ADR-0226).
# Run in a PowerShell window opened with "Run as administrator" (Windows 10 or later). The office
# page "Sistem -> Printer" shows the whole line with the server and the key, like:
#
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/print-bridge/install.ps1))) -Server 'http://192.168.1.250' -Key 'bps_1_...'
#
# or, from a copy of this folder:   powershell -ExecutionPolicy Bypass -File install.ps1 -Server ... -Key ...
#
# What it does, each step safe to repeat:
#   1. asks which Windows printer the labels go to (or takes -Printer)
#   2. copies print-bridge.ps1 to C:\ProgramData\BtoPrint and writes its settings there, readable
#      only by the signed-in user and the administrators (the key is a password)
#   3. starts the bridge now and at every sign-in of that user (a scheduled task)
#   4. waits for the bridge's first word with the server and says what it heard
# Plain ASCII on purpose (see print-bridge.ps1).

param(
  [string]$Server = 'http://192.168.1.250',
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Printer = ''
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Bto print bridge'
$Folder = Join-Path $env:ProgramData 'BtoPrint'
$Script = Join-Path $Folder 'print-bridge.ps1'
$Config = Join-Path $Folder 'config.json'
$Log = Join-Path $Folder 'bridge.log'
$Source = 'https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/print-bridge/print-bridge.ps1'

function Install-Bridge {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host ''
    Write-Host 'NOT INSTALLED: this window is not an administrator window.' -ForegroundColor Red
    Write-Host 'Close it, right-click PowerShell, choose "Run as administrator", and run the same line again.'
    return
  }
  if ($Key -notmatch '^bps_\d+_[A-Za-z0-9_-]{20,}$') {
    Write-Host 'NOT INSTALLED: the key does not look like a Bto printer key (bps_...). Copy it again from Bto.' -ForegroundColor Red
    return
  }

  # The person who works at this PC: the bridge runs in their session, where their printers are.
  $user = (Get-CimInstance Win32_ComputerSystem).UserName
  if (-not $user) { $user = $identity.Name }

  Write-Host '1/4  the printer'
  $printers = @(Get-Printer -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object { $_.Name })
  if (-not $Printer) {
    if ($printers.Count -eq 0) {
      Write-Host 'NOT INSTALLED: Windows shows no printer. Install the printer (its USB driver) first.' -ForegroundColor Red
      return
    }
    for ($index = 0; $index -lt $printers.Count; $index++) {
      Write-Host ("     {0}. {1}" -f ($index + 1), $printers[$index])
    }
    $choice = Read-Host '     The number of the label printer'
    $number = 0
    if (-not [int]::TryParse($choice, [ref]$number) -or $number -lt 1 -or $number -gt $printers.Count) {
      Write-Host 'NOT INSTALLED: no such number. Run the same line again.' -ForegroundColor Red
      return
    }
    $Printer = $printers[$number - 1]
  } elseif ($printers -notcontains $Printer) {
    Write-Host "NOT INSTALLED: Windows has no printer named '$Printer'." -ForegroundColor Red
    return
  }
  Write-Host "     labels go to '$Printer'"

  Write-Host "2/4  copying the bridge to $Folder (it will run as $user)"
  New-Item -ItemType Directory -Force -Path $Folder | Out-Null
  $beside = ''
  if ($PSScriptRoot) { $beside = Join-Path $PSScriptRoot 'print-bridge.ps1' }
  if ($beside -and (Test-Path $beside)) {
    Copy-Item -Force $beside $Script
  } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Source -OutFile $Script
  }
  @{ server = $Server.TrimEnd('/'); key = $Key; printer = $Printer } | ConvertTo-Json | Set-Content -Path $Config -Encoding ASCII
  # Only the user, the administrators and Windows itself read the folder (the key is in it).
  & icacls $Folder /inheritance:r /grant:r "${user}:(OI)(CI)M" '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
  if (Test-Path $Log) { Remove-Item -Force $Log -ErrorAction SilentlyContinue }

  Write-Host '3/4  starting the bridge, now and at every sign-in'
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`""
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

  Write-Host '4/4  waiting for the bridge to reach the server'
  $heard = ''
  for ($attempt = 0; $attempt -lt 15 -and -not $heard; $attempt++) {
    Start-Sleep -Seconds 2
    if (Test-Path $Log) {
      $lines = @(Get-Content -Path $Log -ErrorAction SilentlyContinue)
      $heard = ($lines | Where-Object { $_ -match 'does not answer|refused the key|STOPPED' } | Select-Object -Last 1)
      if (-not $heard -and $attempt -ge 4 -and ($lines | Where-Object { $_ -match 'started:' })) { $heard = 'OK' }
    }
  }

  Write-Host ''
  if ($heard -eq 'OK') {
    Write-Host "INSTALLED. Labels sent to this printer in Bto print on '$Printer'." -ForegroundColor Green
    Write-Host 'In Bto, "Sistem -> Printer" shows the printer as online within a minute.'
  } elseif ($heard) {
    Write-Host 'INSTALLED, BUT:' -ForegroundColor Yellow
    Write-Host "    $heard" -ForegroundColor Yellow
    Write-Host "Check the server address ($Server) and the key, then run the line again. The log: $Log"
  } else {
    Write-Host 'INSTALLED, BUT THE BRIDGE SAID NOTHING YET.' -ForegroundColor Yellow
    Write-Host "Look at $Log, sign out and in again, and run this line once more."
  }
}

Install-Bridge
