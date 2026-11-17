# Bto scan bridge (ADR-0212): lets the Bto server ask a scanner that is plugged into THIS Windows PC
# by USB for a sheet. It answers the small part of eSCL (AirScan) that Bto's client speaks
# (apps/api/src/integrations/scanner) and scans through Windows' own WIA, so the scanner needs
# nothing but its normal Windows driver. One sheet from the glass per scan.
#
#   GET    /eSCL/ScannerCapabilities        what the scanner is
#   GET    /eSCL/ScannerStatus              Idle
#   POST   /eSCL/ScanJobs                   201 + Location: .../eSCL/ScanJobs/<id>
#   GET    /eSCL/ScanJobs/<id>/NextDocument the sheet as a JPEG (scanned now), then 404
#   DELETE /eSCL/ScanJobs/<id>              forgets the job
#
# Only the addresses in -AllowFrom (the Bto server) and this PC itself are answered. Installed and
# started by install.ps1; it runs in the signed-in user's session, where WIA can reach the scanner.
# Plain ASCII on purpose: Windows PowerShell 5.1 reads a script without a BOM as ANSI.

param(
  [int]$Port = 8765,
  [string[]]$AllowFrom = @('192.168.1.250'),
  [int]$Dpi = 200,
  [string]$LogFile = (Join-Path $env:ProgramData 'BtoScan\bridge.log'),
  # Tests only: answer with this JPEG file instead of scanning (no WIA, any system).
  [string]$FakeImage = ''
)

$ErrorActionPreference = 'Stop'
$JpegFormat = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
$WiaScannerType = 1
$Namespaces = 'xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm"'

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  try {
    $folder = Split-Path -Parent $LogFile
    if ($folder -and -not (Test-Path $folder)) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
    # A small log: started again once it passes a megabyte.
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 1MB)) { Remove-Item $LogFile -Force }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch {
    # The log is a help, never a reason to stop.
  }
}

function Get-WiaProperty($Owner, [int]$Id) {
  foreach ($property in $Owner.Properties) {
    if ($property.PropertyID -eq $Id) { return $property.Value }
  }
  return $null
}

# Sets a WIA property when the driver has it and takes the value; a driver that refuses keeps its own.
function Set-WiaProperty($Owner, [int]$Id, [int]$Value) {
  foreach ($property in $Owner.Properties) {
    if ($property.PropertyID -eq $Id) {
      try { $property.Value = $Value } catch { Write-Log ("property {0} kept its value: {1}" -f $Id, $_.Exception.Message) }
      return
    }
  }
}

function Get-ScannerInfo {
  $manager = New-Object -ComObject WIA.DeviceManager
  foreach ($candidate in $manager.DeviceInfos) {
    if ($candidate.Type -eq $WiaScannerType) { return $candidate }
  }
  return $null
}

function Get-ScannerName {
  if ($FakeImage) { return 'Bto scan bridge (test image)' }
  try {
    $info = Get-ScannerInfo
    if (-not $info) { return $null }
    foreach ($property in $info.Properties) {
      if ($property.Name -eq 'Name') { return [string]$property.Value }
    }
    return 'Scanner'
  } catch {
    Write-Log ("WIA did not answer: {0}" -f $_.Exception.Message)
    return $null
  }
}

# One sheet from the glass as JPEG bytes: colour, $Dpi, the whole bed.
function Invoke-Scan {
  if ($FakeImage) { return ,[System.IO.File]::ReadAllBytes($FakeImage) }
  $info = Get-ScannerInfo
  if (-not $info) { throw 'no scanner is connected to this PC (is it switched on and plugged in?)' }
  $device = $info.Connect()
  $item = $device.Items.Item(1)
  Set-WiaProperty $item 6146 1      # colour
  Set-WiaProperty $item 6147 $Dpi   # horizontal resolution
  Set-WiaProperty $item 6148 $Dpi   # vertical resolution
  Set-WiaProperty $item 6149 0      # from the left edge
  Set-WiaProperty $item 6150 0      # from the top edge
  # The bed's size comes in thousandths of an inch; the extents are in pixels.
  $bedWidth = Get-WiaProperty $device 3074
  $bedHeight = Get-WiaProperty $device 3075
  if ($bedWidth) { Set-WiaProperty $item 6151 ([int][math]::Floor($bedWidth * $Dpi / 1000)) }
  if ($bedHeight) { Set-WiaProperty $item 6152 ([int][math]::Floor($bedHeight * $Dpi / 1000)) }
  $image = $item.Transfer($JpegFormat)
  if ($image.FormatID -ne $JpegFormat) {
    # Many drivers hand over a bitmap whatever was asked.
    $process = New-Object -ComObject WIA.ImageProcess
    $process.Filters.Add($process.FilterInfos.Item('Convert').FilterID)
    $process.Filters.Item(1).Properties.Item('FormatID').Value = $JpegFormat
    $process.Filters.Item(1).Properties.Item('Quality').Value = 85
    $image = $process.Apply($image)
  }
  return ,[byte[]]$image.FileData.BinaryData
}

function Send-Response($Context, [int]$Status, [string]$ContentType, [byte[]]$Body, $Headers) {
  $response = $Context.Response
  try {
    $response.StatusCode = $Status
    if ($Headers) {
      foreach ($key in $Headers.Keys) { $response.Headers[$key] = [string]$Headers[$key] }
    }
    if ($Body -and $Body.Length -gt 0) {
      $response.ContentType = $ContentType
      $response.ContentLength64 = $Body.Length
      $response.OutputStream.Write($Body, 0, $Body.Length)
    }
  } finally {
    try { $response.Close() } catch { }
  }
}

function Send-Xml($Context, [string]$Xml) {
  Send-Response $Context 200 'text/xml' ([System.Text.Encoding]::UTF8.GetBytes($Xml)) $null
}

function Test-Allowed($Address) {
  if ([System.Net.IPAddress]::IsLoopback($Address)) { return $true }
  $text = $Address.ToString()
  if ($Address.IsIPv4MappedToIPv6) { $text = $Address.MapToIPv4().ToString() }
  return ($AllowFrom -contains $text)
}

function Read-Body($Request) {
  if (-not $Request.HasEntityBody) { return '' }
  $reader = New-Object System.IO.StreamReader($Request.InputStream, [System.Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

$jobs = @{}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()
Write-Log ("listening on port {0}, answering {1}; scanner: {2}" -f $Port, ($AllowFrom -join ', '), (Get-ScannerName))

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $path = $request.Url.AbsolutePath.TrimEnd('/')
      $method = $request.HttpMethod
      if (-not (Test-Allowed $request.RemoteEndPoint.Address)) {
        Write-Log ("refused {0} from {1}" -f $path, $request.RemoteEndPoint.Address)
        Send-Response $context 403 'text/plain' $null $null
        continue
      }

      if ($method -eq 'GET' -and $path -eq '') {
        $name = Get-ScannerName
        if (-not $name) { $name = 'no scanner found' }
        Send-Response $context 200 'text/plain' ([System.Text.Encoding]::UTF8.GetBytes("Bto scan bridge: $name")) $null
      }
      elseif ($method -eq 'GET' -and $path -eq '/eSCL/ScannerCapabilities') {
        $name = Get-ScannerName
        if (-not $name) { $name = 'No scanner found on this PC' }
        $safe = [System.Security.SecurityElement]::Escape($name)
        Send-Xml $context ("<?xml version=`"1.0`" encoding=`"UTF-8`"?><scan:ScannerCapabilities $Namespaces><pwg:Version>2.0</pwg:Version><pwg:MakeAndModel>$safe</pwg:MakeAndModel><scan:Platen><scan:PlatenInputCaps><scan:SettingProfiles><scan:SettingProfile><scan:ColorModes><scan:ColorMode>RGB24</scan:ColorMode></scan:ColorModes><scan:DocumentFormats><pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat></scan:DocumentFormats></scan:SettingProfile></scan:SettingProfiles></scan:PlatenInputCaps></scan:Platen></scan:ScannerCapabilities>")
      }
      elseif ($method -eq 'GET' -and $path -eq '/eSCL/ScannerStatus') {
        Send-Xml $context ("<?xml version=`"1.0`" encoding=`"UTF-8`"?><scan:ScannerStatus $Namespaces><pwg:Version>2.0</pwg:Version><pwg:State>Idle</pwg:State></scan:ScannerStatus>")
      }
      elseif ($method -eq 'POST' -and $path -eq '/eSCL/ScanJobs') {
        $settings = Read-Body $request
        if ($settings -match 'InputSource>\s*Feeder') {
          # This bridge scans from the glass only.
          Send-Response $context 409 'text/plain' $null $null
        }
        elseif (-not (Get-ScannerName)) {
          Write-Log 'a scan was asked, but no scanner is connected'
          Send-Response $context 500 'text/plain' $null $null
        }
        else {
          $id = [guid]::NewGuid().ToString()
          $jobs[$id] = $false
          Send-Response $context 201 'text/plain' $null @{ Location = ("http://{0}/eSCL/ScanJobs/{1}" -f $request.UserHostName, $id) }
        }
      }
      elseif ($method -eq 'GET' -and $path -match '^/eSCL/ScanJobs/([0-9a-fA-F-]{36})/NextDocument$') {
        $id = $Matches[1]
        if (-not $jobs.ContainsKey($id) -or $jobs[$id]) {
          # No such job, or its one sheet was already given.
          Send-Response $context 404 'text/plain' $null $null
        }
        else {
          $jobs[$id] = $true
          try {
            $started = Get-Date
            $jpeg = Invoke-Scan
            Write-Log ("scanned a sheet: {0} bytes in {1:N0} s" -f $jpeg.Length, ((Get-Date) - $started).TotalSeconds)
            Send-Response $context 200 'image/jpeg' $jpeg $null
          } catch {
            Write-Log ("the scan failed: {0}" -f $_.Exception.Message)
            Send-Response $context 500 'text/plain' $null $null
          }
        }
      }
      elseif ($method -eq 'DELETE' -and $path -match '^/eSCL/ScanJobs/([0-9a-fA-F-]{36})$') {
        $jobs.Remove($Matches[1])
        Send-Response $context 200 'text/plain' $null $null
      }
      else {
        Send-Response $context 404 'text/plain' $null $null
      }
    } catch {
      Write-Log ("a request failed: {0}" -f $_.Exception.Message)
      try { Send-Response $context 500 'text/plain' $null $null } catch { }
    }
  }
} finally {
  $listener.Stop()
  Write-Log 'stopped'
}
