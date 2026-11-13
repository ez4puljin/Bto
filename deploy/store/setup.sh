#!/usr/bin/env bash
# The centre on the store's Ubuntu PC, beside the store edge (ADR-0186;
# docs/runbooks/store-install.md). Safe to run again: it keeps deploy/store/.env and the data.
#
#   bash deploy/store/setup.sh           build, provision, migrate; start when the database was
#                                        seeded or started before, otherwise stop and say what is next
#   bash deploy/store/setup.sh --start   the same, and start even with an empty database
#
# Secrets are made here, on the box, into deploy/store/.env (chmod 600) and are never printed.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE_FILE=deploy/store/docker-compose.store.yml
ENV_FILE=deploy/store/.env
START_EMPTY=no
CI_CHECK=yes
for arg in "$@"; do
  case "$arg" in
    --start) START_EMPTY=yes ;;
    # CI has not seen this commit, or its answer is not to be waited for: deploy anyway.
    --no-ci-check) CI_CHECK=no ;;
    *)
      echo "Танигдаагүй сонголт: $arg (--start, --no-ci-check)" >&2
      exit 64
      ;;
  esac
done

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
COMPOSE=("${DOCKER[@]}" compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
# The way back, the rolling of the app replicas and what CI said (ADR-0196); needs DOCKER, COMPOSE.
# shellcheck source=deploy/store/deploy-lib.sh
. "$(dirname "$0")/deploy-lib.sh"

random_hex() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
random_base64() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }

# Adds a variable the file does not have yet; an existing line is never changed or shown.
ensure_var() {
  local name=$1 value=$2
  if ! grep -q "^${name}=" "$ENV_FILE"; then printf '%s=%s\n' "$name" "$value" >>"$ENV_FILE"; fi
}

if [ ! -f "$ENV_FILE" ]; then
  echo "== $ENV_FILE үүсгэж байна (шинэ нууц утгууд, дэлгэцэд гарахгүй)"
  (umask 077 && : >"$ENV_FILE")
else
  echo "== $ENV_FILE байгаа тул хэвээр үлдээлээ"
fi
chmod 600 "$ENV_FILE"
ensure_var STORE_HTTP_PORT 80
ensure_var STORE_PG_PORT 15433
ensure_var STORE_PUBLIC_HOST ""
ensure_var STORE_PUBLIC_COUNTRIES MN
ensure_var LOG_LEVEL info
ensure_var POSTGRES_PASSWORD "$(random_hex 24)"
ensure_var APP_DB_PASSWORD "$(random_hex 24)"
ensure_var MIGRATOR_DB_PASSWORD "$(random_hex 24)"
ensure_var AI_DB_PASSWORD "$(random_hex 24)"
ensure_var JWT_SECRET "$(random_hex 32)"
ensure_var AUTH_PEPPER "$(random_hex 32)"
ensure_var POS_PIN_PEPPER "$(random_hex 32)"
ensure_var AI_KEY_SECRET "$(random_base64 32)"
ensure_var LLM_PROVIDER ""
ensure_var LLM_MODEL ""
ensure_var LLM_API_KEY ""
ensure_var LLM_BASE_URL ""
ensure_var BACKUP_DIR /var/backups/bto
ensure_var BACKUP_KEEP_DAYS 14
ensure_var BACKUP_USB_DIR /mnt/bto-backup
ensure_var BACKUP_USB_KEEP_DAYS 90

setting() { grep -E "^$1=" "$ENV_FILE" | head -n 1 | cut -d= -f2-; }
PORT=$(setting STORE_HTTP_PORT)
PORT=${PORT:-80}

FREE_GB=$(df -BG --output=avail . | tail -n 1 | tr -dc '0-9')
if [ "${FREE_GB:-0}" -lt 15 ]; then
  echo "АНХААР: дискний сул зай ${FREE_GB} GB. Эхлээд: bash deploy/store/housekeeping.sh" >&2
fi

APP_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo local)
export APP_VERSION

if [ "$CI_CHECK" = "yes" ]; then
  case "$(ci_verdict)" in
    success) echo "== CI энэ хувилбарыг шалгасан: ногоон" ;;
    failure)
      echo "ЗОГСЛОО: CI энэ хувилбар дээр алдаа олсон ($APP_VERSION)." >&2
      echo "Засвар хийгээд дахин push хийнэ үү. Заавал тавих бол:  bash deploy/store/setup.sh --no-ci-check" >&2
      exit 1
      ;;
    pending) echo "== АНХААР: CI энэ хувилбарыг шалгаж дуусаагүй байна. Үргэлжлүүлж байна." ;;
    *) echo "== CI-ийн хариу мэдэгдэхгүй (GitHub-д нэвтрээгүй эсвэл ажиллаагүй). Үргэлжлүүлж байна." ;;
  esac
fi

# What runs now is kept as :store-previous, so rollback.sh is a retag instead of a rebuild.
keep_previous_images

echo "== Image-үүдийг бүтээж байна (эхний удаа 10-20 минут) — хувилбар $APP_VERSION"
"${COMPOSE[@]}" build api web

echo "== Өгөгдлийн санг асааж, эрх ба хүснэгтүүдийг бэлтгэж байна"
"${COMPOSE[@]}" up -d --wait postgres
if ! "${COMPOSE[@]}" run --rm provision; then
  echo "Өгөгдлийн санд нэвтэрч чадсангүй. $ENV_FILE-ийг шинээр үүсгэсэн бол хуучин сангийн нууц үг" >&2
  echo "таарахгүй: docs/runbooks/store-install.mn.md-ийн «Алдаа гарвал» хэсгийг үз." >&2
  exit 1
fi
"${COMPOSE[@]}" run --rm migrate

# A database nobody has started holds no permissions yet: the api writes them at its first start.
STARTED=$("${COMPOSE[@]}" exec -T postgres psql -U postgres -d bto -Atc 'SELECT count(*) FROM permissions')
if [ "$STARTED" = "0" ] && [ "$START_EMPTY" = "no" ]; then
  cat <<EOF

Өгөгдлийн сан бэлэн, ХООСОН байна (хэн ч нэвтрээгүй, систем асаагаагүй).
Дараагийн алхам — хоёрын нэг:
  1. Үндсэн өгөгдлийг (бараа, харилцагч, ажилтан, үнэ, данс) хуулах:
     docs/runbooks/store-install.mn.md-ийн 3-р хэсэг. Хуулсны дараа энэ скриптийг дахин ажиллуулна.
  2. Хоосон системээр эхлэх:  bash deploy/store/setup.sh --start
EOF
  exit 0
fi

# The two apps keep answering while the centre is updated (ADR-0196): their processes are
# replaced one at a time, before the rest of the stack restarts together.
echo "== Аппын процессуудыг ээлжлэн солиж байна"
roll_service api-apps
roll_service api-reports

echo "== Төв системийг асааж байна"
"${COMPOSE[@]}" up -d --wait
record_deployed "$APP_VERSION"

if command -v ufw >/dev/null 2>&1 && sudo -n true 2>/dev/null &&
  sudo ufw status 2>/dev/null | grep -q '^Status: active'; then
  sudo ufw allow "$PORT/tcp" >/dev/null
elif command -v ufw >/dev/null 2>&1; then
  echo "Галт хана (ufw) идэвхтэй бол нэг удаа:  sudo ufw allow $PORT/tcp"
fi

# The watchman (ADR-0195): a round every minute as this user's timer; silent until
# alerts-setup.sh has connected the owner's Telegram.
if command -v systemctl >/dev/null 2>&1 && [ "$(id -u)" != "0" ]; then
  bash "$(dirname "$0")/install-watch-timer.sh" >/dev/null 2>&1 ||
    echo "Харуулын timer суусангүй. Гараар:  bash deploy/store/install-watch-timer.sh"
fi

# Old build cache is the one thing on this disk that only grows.
"${DOCKER[@]}" builder prune -f --filter until=168h >/dev/null 2>&1 || true

IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
SUFFIX=""
if [ "$PORT" != "80" ]; then SUFFIX=":$PORT"; fi
cat <<EOF

Бэлэн. Төв систем: http://${IP:-<энэ компьютерийн IP>}$SUFFIX   (хувилбар $APP_VERSION)
Зөвхөн дэлгүүрийн дотоод сүлжээнээс нээгдэнэ. Посын хуудас хэвээр: http://${IP:-<IP>}:7400
Нөөцлөлтийг нэг удаа тохируулна:  sudo bash deploy/store/install-backup-timer.sh
Утас руу сэрэмжлүүлгийг нэг удаа тохируулна:  bash deploy/store/alerts-setup.sh
Ямар нэг зүйл эвдэрвэл өмнөх хувилбар руу буцаах:  bash deploy/store/rollback.sh
Заавар: docs/runbooks/store-install.mn.md
EOF
