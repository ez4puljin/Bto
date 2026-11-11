# The second copy of the store PC's backups, pulled to this PC over SSH (ADR-0186 #7).
# The store's Ubuntu PC has one disk; deploy/store/backup.sh writes a backup there every night
# and copies it to a USB disk when one is mounted. This script fetches the newest night's folder
# (both databases, the row counts, the two .env files) and checks every file against its checksum.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\store-backup\pull.ps1
#   ... -Storage          also the uploaded files written since the last pull (the first pull takes all)
#   ... -Server bto-edge@192.168.1.152 -Dest D:\Bto-backups\store -KeepDays 60
#
# It only reads on the store PC. The folder it fills holds password hashes and the box's secrets:
# keep it out of cloud-synced folders and never inside this repository.
param(
  [string]$Server = 'bto-edge@192.168.1.152',
  [string]$RemoteDir = '/var/backups/bto',
  [string]$Dest = (Join-Path $env:USERPROFILE 'Documents\Bto-backups\store'),
  [int]$KeepDays = 60,
  [switch]$Storage
)
$ErrorActionPreference = 'Stop'

if ($RemoteDir -notmatch '^/[A-Za-z0-9_./-]+$') { Write-Output 'RemoteDir: a plain absolute path, please'; exit 64 }
if ($Server -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$') { Write-Output 'Server: user@host, please'; exit 64 }

$dailyDest = Join-Path $Dest 'daily'
New-Item -ItemType Directory -Force $dailyDest | Out-Null

Write-Output "== The last backup run on $Server"
& ssh -o BatchMode=yes -o ConnectTimeout=10 $Server "cat $RemoteDir/last-run.txt"
if ($LASTEXITCODE -ne 0) { Write-Output 'No backup has run there yet (or the PC is unreachable).'; exit 1 }

$latest = (& ssh -o BatchMode=yes $Server "ls -1d $RemoteDir/daily/20??-??-??_???? | tail -n 1")
if ($LASTEXITCODE -ne 0 -or -not $latest) { Write-Output 'No daily folder found.'; exit 1 }
$latest = $latest.Trim()
$name = Split-Path $latest -Leaf
$target = Join-Path $dailyDest $name

if (Test-Path (Join-Path $target 'SHA256SUMS')) {
  Write-Output "== $name is here already"
} else {
  Write-Output "== Fetching $name"
  & scp -o BatchMode=yes -r "${Server}:$latest" $dailyDest
  if ($LASTEXITCODE -ne 0) { Write-Output 'scp failed.'; exit 1 }
}

Write-Output '== Checking the files against their checksums'
$bad = 0
foreach ($line in Get-Content (Join-Path $target 'SHA256SUMS')) {
  if ($line -notmatch '^([0-9a-f]{64})\s+\*?(.+)$') { continue }
  $file = Join-Path $target $Matches[2]
  if (-not (Test-Path $file)) { Write-Output "  MISSING $($Matches[2])"; $bad++; continue }
  if ((Get-FileHash -Algorithm SHA256 $file).Hash.ToLower() -ne $Matches[1]) { Write-Output "  DAMAGED $($Matches[2])"; $bad++ }
}
if ($bad -gt 0) { Write-Output "FAILED: $bad file(s) do not match. Delete $target and pull again."; exit 1 }
$dump = Get-Item (Join-Path $target 'centre.dump')
Write-Output ("  ok: {0}, centre.dump {1:N1} MB" -f $name, ($dump.Length / 1MB))

if ($Storage) {
  $storageDest = Join-Path $Dest 'storage'
  New-Item -ItemType Directory -Force $storageDest | Out-Null
  $marker = Join-Path $storageDest '.last-pull'
  $newer = ''
  if (Test-Path $marker) {
    $since = (Get-Content $marker -TotalCount 1).Trim()
    if ($since -match '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') { $newer = "-newermt '$since'" }
  }
  $now = (& ssh -o BatchMode=yes $Server 'date -u +%Y-%m-%dT%H:%M:%SZ').Trim()
  if ($newer) { Write-Output "== Uploaded files written since $since" } else { Write-Output '== All uploaded files (first pull: a few GB)' }
  # cmd keeps the pipe binary; PowerShell 5.1 would treat the archive as text.
  $remote = "cd $RemoteDir/storage && find . -type f $newer -print0 | tar --null -T - -cf -"
  $pipe = "ssh -o BatchMode=yes $Server `"$remote`" | tar -xf - -C `"$storageDest`""
  & cmd /c $pipe
  if ($LASTEXITCODE -ne 0) { Write-Output 'The file pull failed; the marker was not moved.'; exit 1 }
  Set-Content -Path $marker -Value $now -Encoding ascii
  $count = (Get-ChildItem $storageDest -Recurse -File | Measure-Object).Count
  Write-Output "  ok: $count files in $storageDest"
}

# Old nights go only after tonight's is checked.
$cutoff = (Get-Date).AddDays(-$KeepDays)
Get-ChildItem $dailyDest -Directory | Where-Object { $_.Name -match '^20\d\d-\d\d-\d\d_\d{4}$' -and $_.Name -ne $name } | ForEach-Object {
  $day = [datetime]::ParseExact($_.Name.Substring(0, 10), 'yyyy-MM-dd', $null)
  if ($day -lt $cutoff) { Remove-Item -Recurse -Force -Confirm:$false $_.FullName }
}
Write-Output "Done. The copy is in $Dest"
