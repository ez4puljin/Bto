# The development database on this PC: PostgreSQL 18 installed on Windows, not in Docker (owner
# 2026-11-09). start.bat and stop.bat call it; a session may too. It never starts Docker.
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\dev-db\dev-db.ps1 start|stop|status
# Exit codes (start.bat prints the Mongolian message): 0 running / stopped, 1 not running (status),
# 2 data folder missing, 3 PostgreSQL 18 not installed, 4 port 15432 held by another program,
# 5 the server did not start (it prints the end of pg_ctl.log in the data folder).
# BTO_PG_BIN and BTO_PG_DATA override the defaults below. Setting up a new PC: tools/dev-db/README.md.
param([Parameter(Mandatory = $true)][ValidateSet('start', 'stop', 'status')][string]$Action)

$port = 15432
$bin = if ($env:BTO_PG_BIN) { $env:BTO_PG_BIN } else { 'C:\Program Files\PostgreSQL\18\bin' }
$data = if ($env:BTO_PG_DATA) { $env:BTO_PG_DATA } else { Join-Path $env:LOCALAPPDATA 'Bto\pg18' }
# A trailing backslash would escape the closing quote of the -D argument below.
$data = $data.TrimEnd('\')
$startLog = Join-Path $data 'pg_ctl.log'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$isReady = Join-Path $bin 'pg_isready.exe'

if (-not (Test-Path $pgCtl)) { Write-Output "PostgreSQL 18 not found in $bin"; exit 3 }
if (-not (Test-Path (Join-Path $data 'PG_VERSION'))) { Write-Output "no data folder at $data"; exit 2 }

function Test-Running {
  & $pgCtl status -D $data *> $null
  return $LASTEXITCODE -eq 0
}

function Test-Ready {
  & $isReady -h 127.0.0.1 -p $port -t 2 *> $null
  return $LASTEXITCODE -eq 0
}

switch ($Action) {
  'status' {
    if (Test-Running) { Write-Output "running on $port ($data)"; exit 0 }
    Write-Output 'not running'
    exit 1
  }
  'stop' {
    if (-not (Test-Running)) { Write-Output 'not running'; exit 0 }
    & $pgCtl stop -D $data -m fast -w -t 60
    exit $LASTEXITCODE
  }
  'start' {
    if (Test-Running) {
      if (Test-Ready) { Write-Output "running on $port"; exit 0 }
    } else {
      if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
        # Most likely the old Docker container (docker compose): this script never stops it.
        Write-Output "port $port is held by another program"
        exit 4
      }
      # A hidden window of its own: the server outlives the window that ran start.bat. Its working
      # folder is the data folder, so it never holds the caller's folder (the repository) open.
      Start-Process -FilePath $pgCtl -WindowStyle Hidden -WorkingDirectory $data -ArgumentList @(
        'start', '-D', "`"$data`"", '-l', "`"$startLog`"", '-w', '-t', '60'
      )
    }
    for ($i = 0; $i -lt 60; $i++) {
      if (Test-Ready) { Write-Output "running on $port"; exit 0 }
      Start-Sleep -Seconds 1
    }
    # A failure before the logging collector starts (a bad setting, the port, a stale lock) is only
    # in pg_ctl.log; later messages are in the log folder.
    Write-Output "did not start; see $startLog"
    if (Test-Path $startLog) { Get-Content $startLog -Tail 15 }
    exit 5
  }
}
