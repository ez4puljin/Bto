# Starts the apps' download page (serve.mjs, port 3302) hidden, unless something already listens there.
# Called by start.bat; stop.bat stops it with the repository's other node processes.
# Exit 0 = listening, 1 = it did not start (the reason is in tmp\apk-share.err.log).
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$port = if ($env:APK_SHARE_PORT) { [int]$env:APK_SHARE_PORT } else { 3302 }

function Test-Listening {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (Test-Listening) { exit 0 }

$logs = Join-Path $repo 'tmp'
New-Item -ItemType Directory -Force $logs | Out-Null
Start-Process -FilePath 'node' `
  -ArgumentList ('"{0}"' -f (Join-Path $PSScriptRoot 'serve.mjs')) `
  -WorkingDirectory $repo -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs 'apk-share.log') `
  -RedirectStandardError (Join-Path $logs 'apk-share.err.log')

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 250
  if (Test-Listening) { exit 0 }
}
exit 1
