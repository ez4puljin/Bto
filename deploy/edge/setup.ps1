# The store edge on a Windows PC (ADR-0067, ADR-0136; docs/runbooks/edge-install.md).
# Needs Docker Desktop running. Writes deploy\edge\.env with fresh local secrets (never the
# centre's: the kiosk links the edge with an admin's code), builds and starts the three containers
# and prints the kiosk's address. Run again to update after `git pull`; an existing .env is kept.
#
#   deploy\edge\setup-windows.bat   (double-click), or
#   powershell -ExecutionPolicy Bypass -File deploy\edge\setup.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root

$composeFile = 'deploy/edge/docker-compose.edge.yml'
$envFile = Join-Path $root 'deploy\edge\.env'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Docker Desktop олдсонгүй. https://www.docker.com/products/docker-desktop/ -оос суулгаад асаана уу (эсвэл: winget install -e --id Docker.DockerDesktop).' -ForegroundColor Yellow
  exit 1
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Docker Desktop асаагүй байна. Асаагаад (халим дүрс ногоон болтол хүлээгээд) дахин ажиллуулна уу.' -ForegroundColor Yellow
  exit 1
}

function New-Hex([int]$bytes) {
  $buffer = New-Object byte[] $bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

if (-not (Test-Path $envFile)) {
  Write-Host "== $envFile үүсгэж байна (шинэ нууц утгууд)"
  $lines = @(
    'KIOSK_PORT=7400',
    "EDGE_DB_PASSWORD=$(New-Hex 24)",
    "EDGE_JWT_SECRET=$(New-Hex 32)",
    'CENTRAL_API_URL=',
    'EDGE_NODE_TOKEN=',
    'POS_PIN_PEPPER=',
    'EBARIMT_PROVIDER=fake',
    'POSAPI_URL=',
    'EBARIMT_BRANCH_NO=',
    'EBARIMT_LOOKUP_URL=https://api.ebarimt.mn'
  )
  # UTF-8 without a BOM and LF: Docker reads the first key wrong after a BOM.
  [System.IO.File]::WriteAllText($envFile, ($lines -join "`n") + "`n", (New-Object System.Text.UTF8Encoding $false))
} else {
  Write-Host "== $envFile байгаа тул хэвээр үлдээлээ"
}

$port = '7400'
$portLine = Get-Content $envFile | Where-Object { $_ -match '^KIOSK_PORT=(\d+)' } | Select-Object -First 1
if ($portLine -match '^KIOSK_PORT=(\d+)') { $port = $Matches[1] }

Write-Host '== Edge-ийг бүтээж асааж байна (эхний удаа 10-20 минут)'
docker compose -f $composeFile --env-file $envFile up -d --build --wait
if ($LASTEXITCODE -ne 0) { throw 'docker compose up амжилтгүй боллоо' }

# The tills on other PCs reach the kiosk port; the rule needs an administrator's window.
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
  if (-not (Get-NetFirewallRule -DisplayName "Bto kiosk $port" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Bto kiosk $port" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Private,Domain | Out-Null
  }
} else {
  Write-Host "Санамж: бусад кассын компьютерээс нээгдэхгүй бол энэ скриптийг 'Run as administrator'-аар нэг удаа ажиллуулж $port портыг нээнэ үү." -ForegroundColor Yellow
}

$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.InterfaceAlias -notlike 'vEthernet*' -and $_.InterfaceAlias -notlike '*WSL*' } |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $ip) { $ip = '<энэ компьютерийн IP>' }
Write-Host ''
Write-Host "Бэлэн. Кассын хуудас: http://${ip}:$port" -ForegroundColor Green
Write-Host 'Анх удаа нээхэд «Төв системтэй холбох» дэлгэц гарна: төвийн хаяг, edge-ийн код,'
Write-Host '«Супермаркет → Касс» хуудаснаас авсан «Холбох код»-ыг оруулна.'
