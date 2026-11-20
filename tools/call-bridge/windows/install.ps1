# Installs the Bto call bridge (the phone AI order line, ADR-0232) on a Windows 10/11 PC, for the
# user who is signed in. NO administrator window is needed: everything goes to
# %LOCALAPPDATA%\BtoCall. Open an ordinary PowerShell window and paste the line the line's page in
# Bto shows ("System -> Phone AI line"), like:
#
#   [Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/call-bridge/windows/install.ps1))) -Server 'http://192.168.1.250' -Key 'bpl_1_...'
#
# or, from a copy of this folder:   powershell -ExecutionPolicy Bypass -File install.ps1 -Server ... -Key ...
#
# What it does, each step safe to repeat:
#   1. downloads Python 3.12.10 (the official "embeddable" zip from python.org, checked by its
#      SHA-256) into %LOCALAPPDATA%\BtoCall\python: a private copy, nothing is registered in Windows
#   2. installs the pinned packages of requirements.txt with pip (every file checked by its hash)
#   3. copies the bridge (btobridge\*.py) and writes config.json: the server, the key, the audio
#      mode "local" and the chosen microphone and speakers (the key is a password: the folder is the
#      user's own)
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
  'requirements.txt'
)

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

  Write-Host '4/6  microphone and speakers'
  $bridgeSettings = [ordered]@{ server = $Server.TrimEnd('/'); key = $Key; mode = 'local'; input_device = $null; output_device = $null }
  if (Test-Path $ConfigPath) {
    try {
      $old = Get-Content -Raw $ConfigPath | ConvertFrom-Json
      foreach ($name in 'input_device', 'output_device', 'chunk_ms', 'max_call_s', 'silence_s', 'grace_s') {
        if ($old.PSObject.Properties.Name -contains $name) { $bridgeSettings[$name] = $old.$name }
      }
    } catch { }
  }
  if ($InputDevice) { $bridgeSettings.input_device = $InputDevice }
  if ($OutputDevice) { $bridgeSettings.output_device = $OutputDevice }
  if (-not $NoDevicePrompt -and -not $InputDevice -and -not $OutputDevice) {
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
    Write-Host 'INSTALLED. Open "Bto AI call" on the desktop to make a test call.' -ForegroundColor Green
  } else {
    Write-Host ''
    Write-Host 'INSTALLED, BUT: Bto did not accept this station yet (see the line above).' -ForegroundColor Yellow
  }
}

Install-Bridge
