# Installs the Bto call bridge (the phone AI order line, ADR-0232) on a Windows 10/11 PC, for the
# user who is signed in. NO administrator window is needed: everything goes to
# %LOCALAPPDATA%\BtoCall. Open an ordinary PowerShell window and paste the line the line's page in
# Bto shows ("System -> Phone AI line"), like:
#
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/call-bridge/windows/install.ps1))) -Server 'http://192.168.1.250' -Key 'bpl_1_...'
#
# or, from a copy of this folder:   powershell -ExecutionPolicy Bypass -File install.ps1 -Server ... -Key ...
#
# -Mode bluetooth (stage 3): the line's phone is paired to this PC with Windows Phone Link; the
# bridge takes its calls through the Android app "Bto duudlaga" over the LAN (port 8766) and
# carries the audio: the call captured from the output Phone Link plays on, the AI's voice into
# VB-Cable ("CABLE Input"), Phone Link's microphone ("CABLE Output"). -Mode local (stage 2, the
# default for a first install): test calls through this PC's headset only. -Mode cable needs a USB
# sound card and cables that were not bought: refused. A repeat install keeps the mode, the devices
# and the paired phone unless told otherwise.
#
# What it does, each step safe to repeat:
#   1. downloads Python 3.12.10 (the official "embeddable" zip from python.org, checked by its
#      SHA-256) into %LOCALAPPDATA%\BtoCall\python: a private copy, nothing is registered in Windows
#   2. installs the pinned packages of requirements.txt with pip (every file checked by its hash)
#   3. copies the bridge (btobridge\*.py) and writes config.json: the server, the key, the audio
#      mode and its devices (the key is a password: the folder is the user's own); bluetooth: checks
#      Bluetooth, Phone Link and VB-Cable, and the inbound firewall rule for the phone's link (made
#      only when this window is an administrator's; otherwise the one command is printed)
#   4. starts the bridge's background task now and at every sign-in (a scheduled task; if Windows
#      refuses one to a non-administrator, a shortcut in the user's Startup folder instead)
#   5. puts "Bto AI call" on the desktop: the console for test calls and the numbers
#   6. asks Bto about the station and says what it heard
# Needs: Windows 10 or 11 (64-bit), internet to python.org and pypi.org once, the LAN to Bto.
# Plain ASCII on purpose (Windows PowerShell 5 reads a script without a BOM as the ANSI code page).

param(
  [string]$Server = 'http://192.168.1.250',
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$InputDevice = '',
  [string]$OutputDevice = '',
  [ValidateSet('', 'local', 'bluetooth', 'cable')][string]$Mode = '',
  [string]$CallDevice = '',
  [switch]$NoDevicePrompt
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Bto call bridge'
$Folder = Join-Path $env:LOCALAPPDATA 'BtoCall'
$PythonDir = Join-Path $Folder 'python'
$AppDir = Join-Path $Folder 'app'
$ConfigPath = Join-Path $Folder 'config.json'
$Raw = 'https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/call-bridge/windows'

$PythonUrl = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
$PythonSha = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
$PipUrl = 'https://bootstrap.pypa.io/pip/zipapp/pip-26.2.2.pyz'
$PipSha = 'e5ef64ef63ff89a746014ad81658b76c1940385fdcdbc4fcbfa6e3ef1887352d'
$AppFiles = @(
  'btobridge/__init__.py', 'btobridge/__main__.py', 'btobridge/audio.py', 'btobridge/bto.py',
  'btobridge/cli.py', 'btobridge/config.py', 'btobridge/dsp.py', 'btobridge/metrics.py',
  'btobridge/phone.py', 'btobridge/protocol.py', 'btobridge/session.py', 'btobridge/ws.py',
  'btobridge/link.py', 'btobridge/serve.py', 'btobridge/calibrate.py', 'btobridge/checks.py',
  'requirements.txt'
)
$FirewallRule = 'Bto call bridge (phone link)'

function Test-Administrator {
  $who = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $who.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Set-PhoneFirewall([int]$Port) {
  $rule = Get-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue
  if ($rule) { Write-Host '     firewall: the phone link rule is there.'; return }
  $command = "New-NetFirewallRule -DisplayName '$FirewallRule' -Direction Inbound -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Action Allow -Profile Any"
  if (Test-Administrator) {
    Invoke-Expression $command | Out-Null
    Write-Host '     firewall: the phone link rule was added (TCP' $Port ', the LAN only).'
  } else {
    Write-Host '     firewall: the phone cannot reach this PC until ONE command is run as administrator' -ForegroundColor Yellow
    Write-Host '     (Start -> type PowerShell -> right click -> Run as administrator, paste, Enter):' -ForegroundColor Yellow
    Write-Host "     $command"
  }
}

function Get-Checked([string]$Url, [string]$Sha, [string]$OutFile) {
  if ((Test-Path $OutFile) -and ((Get-FileHash -Algorithm SHA256 $OutFile).Hash -eq $Sha.ToUpper())) { return }
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile
  $got = (Get-FileHash -Algorithm SHA256 $OutFile).Hash
  if ($got -ne $Sha.ToUpper()) {
    Remove-Item -Force $OutFile
    throw "the download of $Url is not the expected file (SHA-256 $got)"
  }
}

function Install-Bridge {
  if ($Key -notmatch '^bpl_\d+_[A-Za-z0-9_-]{20,}$') {
    Write-Host 'NOT INSTALLED: the key does not look like a Bto phone line key (bpl_...). Copy it again from Bto.' -ForegroundColor Red
    return
  }
  if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Host 'NOT INSTALLED: this needs 64-bit Windows.' -ForegroundColor Red
    return
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $ProgressPreference = 'SilentlyContinue'
  New-Item -ItemType Directory -Force -Path $Folder, $AppDir, (Join-Path $AppDir 'btobridge') | Out-Null

  # A running bridge holds python.exe: stop it before replacing anything.
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='pythonw.exe' OR Name='python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($PythonDir) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Write-Host '1/6  Python 3.12 (private copy)'
  $zip = Join-Path $Folder 'python-3.12.10-embed-amd64.zip'
  Get-Checked $PythonUrl $PythonSha $zip
  if (-not (Test-Path (Join-Path $PythonDir 'python.exe'))) {
    Expand-Archive -Force -Path $zip -DestinationPath $PythonDir
  }
  # The embeddable Python ignores site-packages until "import site" is on; ..\app holds the bridge.
  $pth = Join-Path $PythonDir 'python312._pth'
  Set-Content -Path $pth -Encoding ASCII -Value @('python312.zip', '.', '..\app', 'import site')
  $python = Join-Path $PythonDir 'python.exe'
  $pythonw = Join-Path $PythonDir 'pythonw.exe'

  Write-Host '2/6  copying the bridge'
  $beside = ''
  if ($PSScriptRoot) { $beside = $PSScriptRoot }
  foreach ($file in $AppFiles) {
    $target = Join-Path $AppDir ($file -replace '/', '\')
    $local = ''
    if ($beside) { $local = Join-Path $beside ($file -replace '/', '\') }
    if ($local -and (Test-Path $local)) {
      Copy-Item -Force $local $target
    } else {
      Invoke-WebRequest -UseBasicParsing -Uri "$Raw/$file" -OutFile $target
    }
  }

  Write-Host '3/6  the packages (pip, every file checked by its hash)'
  $pip = Join-Path $Folder 'pip-26.2.2.pyz'
  Get-Checked $PipUrl $PipSha $pip
  # pip writes progress to stderr; Windows PowerShell 5 would turn that into an error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  & $python $pip install --disable-pip-version-check --no-warn-script-location --only-binary=:all: --require-hashes -r (Join-Path $AppDir 'requirements.txt') 2>&1 |
    Where-Object { $_ -match 'ERROR|Successfully' } | ForEach-Object { Write-Host "     $_" }
  $pipExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($pipExit -ne 0) {
    Write-Host 'NOT INSTALLED: pip could not install the packages (internet to pypi.org?). Run the same line again.' -ForegroundColor Red
    return
  }

  Write-Host '4/6  the audio mode and its devices'
  $bridgeSettings = [ordered]@{ server = ''; key = ''; mode = 'local'; input_device = $null; output_device = $null }
  if (Test-Path $ConfigPath) {
    try {
      # Every old setting is kept (the paired phone too); only what is given here changes.
      $old = Get-Content -Raw $ConfigPath | ConvertFrom-Json
      foreach ($prop in $old.PSObject.Properties) { $bridgeSettings[$prop.Name] = $prop.Value }
    } catch { }
  }
  $bridgeSettings.server = $Server.TrimEnd('/')
  $bridgeSettings.key = $Key
  if ($Mode -eq 'cable') {
    Write-Host '     The cable mode needs a USB sound card and cables that were not bought; it is not built. Use -Mode bluetooth.' -ForegroundColor Yellow
  } elseif ($Mode) {
    $bridgeSettings.mode = $Mode
  }
  if ($bridgeSettings.mode -eq 'cable') { $bridgeSettings.mode = 'local' }
  $bridgeMode = $bridgeSettings.mode
  Write-Host "     mode: $bridgeMode"
  if ($InputDevice) { $bridgeSettings.input_device = $InputDevice }
  if ($OutputDevice) { $bridgeSettings.output_device = $OutputDevice }
  if ($CallDevice) { $bridgeSettings.call_output_device = $CallDevice }
  if ($bridgeMode -eq 'bluetooth') {
    if (-not $bridgeSettings.Contains('agent_output_device') -or -not $bridgeSettings.agent_output_device) { $bridgeSettings.agent_output_device = 'CABLE Input' }
    if (-not $bridgeSettings.Contains('phone_port') -or -not $bridgeSettings.phone_port) { $bridgeSettings.phone_port = 8766 }
  }
  # The checks below run the bridge, which reads config.json: write it once now.
  [IO.File]::WriteAllText($ConfigPath, ($bridgeSettings | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
  if ($bridgeMode -eq 'bluetooth') {
    Write-Host '     Bluetooth, Phone Link, VB-Cable:'
    & $python -m btobridge doctor
    if (-not $NoDevicePrompt -and -not $CallDevice) {
      & $python -m btobridge devices
      Write-Host '     The CALL device is the speaker/headset Phone Link plays a call on (heard in it now).'
      Write-Host '     D = find it now: call the line phone from another phone, take the call in Phone Link, keep talking, then press D.'
      $answer = Read-Host '     The number of the CALL device, or D (Enter: Windows default output)'
      $n = 0
      if ($answer -eq 'D' -or $answer -eq 'd') {
        & $python -m btobridge find-call-device --no-wait
        $saved = Get-Content -Raw $ConfigPath | ConvertFrom-Json
        $bridgeSettings.call_output_device = $saved.call_output_device
      } elseif ([int]::TryParse($answer, [ref]$n)) {
        $bridgeSettings.call_output_device = $n
      }
    }
    Set-PhoneFirewall ([int]$bridgeSettings.phone_port)
  }
  if ($bridgeMode -eq 'local' -and -not $NoDevicePrompt -and -not $InputDevice -and -not $OutputDevice) {
    & $python -m btobridge devices
    Write-Host '     A headset is best: with speakers the AI hears itself.'
    $in = Read-Host '     The number of the MICROPHONE (Enter: Windows default)'
    $out = Read-Host '     The number of the HEADPHONES / SPEAKERS (Enter: Windows default)'
    $n = 0
    if ([int]::TryParse($in, [ref]$n)) { $bridgeSettings.input_device = $n }
    if ([int]::TryParse($out, [ref]$n)) { $bridgeSettings.output_device = $n }
  }
  $json = $bridgeSettings | ConvertTo-Json
  [IO.File]::WriteAllText($ConfigPath, $json, (New-Object Text.UTF8Encoding($false)))
  # An older installer wrote the settings to a file with this odd name in the current folder: remove it.
  foreach ($stray in @((Get-Location).Path, $HOME)) {
    $strayFile = Join-Path $stray 'System.Collections.Specialized.OrderedDictionary'
    if ((Test-Path $strayFile -PathType Leaf) -and ((Get-Item $strayFile).Length -lt 4096)) {
      Remove-Item -Force $strayFile -ErrorAction SilentlyContinue
    }
  }

  Write-Host '5/6  the background task, now and at every sign-in'
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $registered = $false
  try {
    $action = New-ScheduledTaskAction -Execute $pythonw -Argument '-m btobridge serve' -WorkingDirectory $Folder
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $runAs = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $runAs `
      -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    $registered = $true
  } catch {
    Write-Host '     Windows refused a scheduled task to this account; using the Startup folder instead.'
  }
  $shell = New-Object -ComObject WScript.Shell
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Bto call bridge.lnk'
  if ($registered) {
    if (Test-Path $startup) { Remove-Item -Force $startup }
  } else {
    $link = $shell.CreateShortcut($startup)
    $link.TargetPath = $pythonw
    $link.Arguments = '-m btobridge serve'
    $link.WorkingDirectory = $Folder
    $link.Save()
    Start-Process -FilePath $pythonw -ArgumentList '-m btobridge serve' -WorkingDirectory $Folder -WindowStyle Hidden
  }

  Write-Host '6/6  the desktop shortcut and the first word with Bto'
  $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bto AI call.lnk'
  $link = $shell.CreateShortcut($desktop)
  $link.TargetPath = $python
  $link.Arguments = '-m btobridge'
  $link.WorkingDirectory = $Folder
  $link.Save()

  & $python -m btobridge check
  if ($LASTEXITCODE -eq 0) {
    Write-Host ''
    if ($bridgeMode -eq 'bluetooth') {
      Write-Host 'INSTALLED. Open "Bto AI call" on the desktop: 6 pairs the phone app, 9 measures a test call.' -ForegroundColor Green
    } else {
      Write-Host 'INSTALLED. Open "Bto AI call" on the desktop to make a test call.' -ForegroundColor Green
    }
  } else {
    Write-Host ''
    Write-Host 'INSTALLED, BUT: Bto did not accept this station yet (see the line above).' -ForegroundColor Yellow
  }
}

Install-Bridge
