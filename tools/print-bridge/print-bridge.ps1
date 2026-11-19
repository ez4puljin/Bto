# Bto print bridge (ADR-0226): prints Bto's price labels on a printer attached to THIS Windows PC
# (an 80 mm thermal receipt printer by USB, or one Windows shares). It asks the Bto server for the
# next job of its print station with the station's key, writes the job's bytes RAW to the chosen
# Windows printer (the winspool API, no driver rendering: the bytes are ready ESC/POS from the
# server) and reports done or failed. It only calls out: no port is opened on this PC.
#
#   GET  <server>/api/v1/print-bridge/next           waits up to ~25 s; { job: { id, labels, data } | null }
#   POST <server>/api/v1/print-bridge/jobs/<id>/done { ok, message }
#
# Installed and started by install.ps1 (a scheduled task at the user's sign-in), with its settings
# in C:\ProgramData\BtoPrint\config.json (server, key, printer).
# Plain ASCII on purpose: Windows PowerShell 5.1 reads a script without a BOM as ANSI.

param(
  [string]$ConfigFile = (Join-Path $env:ProgramData 'BtoPrint\config.json'),
  [string]$Server = '',
  [string]$Key = '',
  [string]$Printer = '',
  [string]$LogFile = (Join-Path $env:ProgramData 'BtoPrint\bridge.log'),
  # Tests only: one poll, then stop.
  [switch]$Once
)

$ErrorActionPreference = 'Stop'

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

# The settings: the command line wins over the file install.ps1 wrote.
if (Test-Path $ConfigFile) {
  try {
    $config = Get-Content -Raw -Path $ConfigFile | ConvertFrom-Json
    if (-not $Server) { $Server = [string]$config.server }
    if (-not $Key) { $Key = [string]$config.key }
    if (-not $Printer) { $Printer = [string]$config.printer }
  } catch {
    Write-Log "cannot read $ConfigFile : $($_.Exception.Message)"
  }
}
if (-not $Server -or -not $Key -or -not $Printer) {
  Write-Log 'STOPPED: the server, the key or the printer is missing; run install.ps1 again.'
  exit 1
}
$Server = $Server.TrimEnd('/')

# winspool: the bytes go to the printer as they are (datatype RAW).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class BtoRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO info);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

  // Null when the printer took every byte, else what went wrong.
  public static string Send(string printer, byte[] data) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) {
      return "cannot open printer '" + printer + "' (Windows error " + Marshal.GetLastWin32Error() + ")";
    }
    IntPtr buffer = IntPtr.Zero;
    try {
      DOCINFO info = new DOCINFO();
      info.pDocName = "Bto price labels";
      info.pDataType = "RAW";
      if (StartDocPrinter(handle, 1, info) == 0) {
        return "the printer refused the job (Windows error " + Marshal.GetLastWin32Error() + ")";
      }
      try {
        if (!StartPagePrinter(handle)) {
          return "the printer refused the page (Windows error " + Marshal.GetLastWin32Error() + ")";
        }
        buffer = Marshal.AllocCoTaskMem(data.Length);
        Marshal.Copy(data, 0, buffer, data.Length);
        int written;
        bool ok = WritePrinter(handle, buffer, data.Length, out written);
        int error = Marshal.GetLastWin32Error();
        EndPagePrinter(handle);
        if (!ok || written != data.Length) {
          return "the printer took " + written + " of " + data.Length + " bytes (Windows error " + error + ")";
        }
        return null;
      } finally {
        EndDocPrinter(handle);
      }
    } finally {
      if (buffer != IntPtr.Zero) Marshal.FreeCoTaskMem(buffer);
      ClosePrinter(handle);
    }
  }
}
'@

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$headers = @{ Authorization = "Bearer $Key"; 'X-Printer-Name' = $Printer }
Write-Log "started: server $Server, printer '$Printer'"
$wasDown = $false

while ($true) {
  try {
    $answer = Invoke-RestMethod -Method Get -Uri "$Server/api/v1/print-bridge/next" -Headers $headers -TimeoutSec 60
    if ($wasDown) { Write-Log 'the server answers again'; $wasDown = $false }
    $job = $answer.job
    if ($job) {
      $bytes = [Convert]::FromBase64String([string]$job.data)
      $problem = [BtoRawPrinter]::Send($Printer, $bytes)
      if ($problem) {
        Write-Log ("job {0}: FAILED {1}" -f $job.id, $problem)
        $body = @{ ok = $false; message = $problem } | ConvertTo-Json -Compress
      } else {
        Write-Log ("job {0}: printed {1} label(s), {2} bytes" -f $job.id, $job.labels, $bytes.Length)
        $body = @{ ok = $true } | ConvertTo-Json -Compress
      }
      Invoke-RestMethod -Method Post -Uri "$Server/api/v1/print-bridge/jobs/$($job.id)/done" -Headers $headers `
        -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
    }
  } catch {
    $status = $null
    try { $status = [int]$_.Exception.Response.StatusCode } catch { }
    if ($status -eq 401) {
      Write-Log 'the server refused the key: the printer was disabled in Bto or got a new key. Run install.ps1 with the new key.'
      Start-Sleep -Seconds 60
    } else {
      if (-not $wasDown) { Write-Log "the server does not answer: $($_.Exception.Message)" }
      $wasDown = $true
      Start-Sleep -Seconds 5
    }
  }
  if ($Once) { break }
}
