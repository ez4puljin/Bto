#!/usr/bin/env bash
# The store edge on an Ubuntu PC (ADR-0067, ADR-0136; docs/runbooks/edge-install.md).
# Installs Docker when it is missing, writes deploy/edge/.env with fresh local secrets (never the
# centre's: the kiosk links the edge with an admin's code), builds and starts the three containers
# and prints the kiosk's address. Run again to update after `git pull`; an existing .env is kept.
#
#   bash deploy/edge/setup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE_FILE=deploy/edge/docker-compose.edge.yml
ENV_FILE=deploy/edge/.env

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "== Docker суулгаж байна (sudo нууц үг асууж магадгүй)"
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER" || true
fi

# Until the user logs in again after joining the docker group, docker needs sudo.
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then DOCKER=(sudo docker); fi

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

if [ ! -f "$ENV_FILE" ]; then
  echo "== $ENV_FILE үүсгэж байна (шинэ нууц утгууд)"
  umask 077
  cat >"$ENV_FILE" <<EOF
KIOSK_PORT=7400
EDGE_DB_PASSWORD=$(random_hex 24)
EDGE_JWT_SECRET=$(random_hex 32)
CENTRAL_API_URL=
EDGE_NODE_TOKEN=
POS_PIN_PEPPER=
EBARIMT_PROVIDER=fake
POSAPI_URL=
EBARIMT_BRANCH_NO=
EBARIMT_LOOKUP_URL=https://api.ebarimt.mn
EOF
else
  echo "== $ENV_FILE байгаа тул хэвээр үлдээлээ"
fi

PORT=$(grep -E '^KIOSK_PORT=' "$ENV_FILE" | cut -d= -f2)
PORT=${PORT:-7400}

echo "== Edge-ийг бүтээж асааж байна (эхний удаа 10-20 минут)"
"${DOCKER[@]}" compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --wait

if command -v ufw >/dev/null 2>&1 && sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow "$PORT/tcp" >/dev/null
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "Бэлэн. Кассын хуудас: http://${IP:-<энэ компьютерийн IP>}:$PORT"
echo "Анх удаа нээхэд «Төв системтэй холбох» дэлгэц гарна: төвийн хаяг, edge-ийн код,"
echo "«Супермаркет → Касс» хуудаснаас авсан «Холбох код»-ыг оруулна."
