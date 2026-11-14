#!/usr/bin/env bash
# Back to the version that ran before the last update (ADR-0196), in about half a minute: the
# images kept as `:store-previous` are put back under the tags the stack runs, and the centre is
# started on them. No rebuild, no network.
#
#   bash deploy/store/rollback.sh            go back, after saying what will change
#   bash deploy/store/rollback.sh --force    go back although a migration stands between them
#
# This moves the RUNNING SYSTEM only; the checkout stays where it is, so the next
# `bash deploy/store/setup.sh` builds the newer code again. Going back for good is §8 of
# docs/runbooks/store-install.md (a commit of main that undoes the change).
#
# A migration the newer version applied is NOT undone, and the older code may not fit the changed
# tables: then the way back is the night's backup (§9), not this script.
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE_FILE=deploy/store/docker-compose.store.yml
ENV_FILE=deploy/store/.env
FORCE=no
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=yes ;;
    *)
      echo "Танигдаагүй сонголт: $arg (зөвхөн --force)" >&2
      exit 64
      ;;
  esac
done

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then DOCKER=(sudo docker); fi
COMPOSE=("${DOCKER[@]}" compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
# shellcheck source=deploy/store/deploy-lib.sh
. "$(dirname "$0")/deploy-lib.sh"

if ! "${DOCKER[@]}" image inspect "$API_PREVIOUS" >/dev/null 2>&1; then
  echo "Буцах image алга ($API_PREVIOUS): энэ компьютер дээр ганцхан удаа шинэчлэлт хийгдсэн байна." >&2
  echo "Гараар буцаах: docs/runbooks/store-install.mn.md-ийн 8-р хэсэг." >&2
  exit 1
fi

NOW=$(deployed_version)
BACK=$(previous_version)
echo "Одоо ажиллаж буй: ${NOW:-тодорхойгүй}"
echo "Буцах хувилбар:   ${BACK:-тодорхойгүй (image хадгалагдсан боловч дугаар нь бүртгэгдээгүй)}"

# A migration between the two means the older code would meet tables it does not know.
if [ -n "$NOW" ] && [ -n "$BACK" ] && git rev-parse --verify -q "$BACK" >/dev/null &&
  git rev-parse --verify -q "$NOW" >/dev/null; then
  MIGRATIONS=$(git diff --name-only "$BACK" "$NOW" -- apps/api/src/db/migrations | grep -c '\.sql$' || true)
  if [ "$MIGRATIONS" != "0" ]; then
    echo
    echo "АНХААР: энэ хоёрын хооронд $MIGRATIONS өгөгдлийн сангийн шилжилт хийгдсэн байна."
    echo "Хуучин код шинэ хүснэгтүүдтэй тохирохгүй байж магадгүй. Ийм тохиолдолд шөнийн нөөцлөлтөөс"
    echo "сэргээх нь зөв (docs/runbooks/store-install.mn.md, 9-р хэсэг)."
    if [ "$FORCE" != "yes" ]; then
      echo "Мэдсээр байж буцаах бол:  bash deploy/store/rollback.sh --force" >&2
      exit 1
    fi
    echo "--force өгсөн тул үргэлжлүүлж байна."
  fi
fi

echo
echo "== Өмнөх image-үүдийг буцаан тавьж байна"
"${DOCKER[@]}" image tag "$API_PREVIOUS" "$API_IMAGE"
if "${DOCKER[@]}" image inspect "$WEB_PREVIOUS" >/dev/null 2>&1; then
  "${DOCKER[@]}" image tag "$WEB_PREVIOUS" "$WEB_IMAGE"
fi

# The version the containers report comes from the environment, not the image.
APP_VERSION=${BACK:-rollback}
export APP_VERSION
echo "== Төв системийг өмнөх хувилбар дээр асааж байна"
start_stack --force-recreate

# What runs is the older one again; the newer stays as the way forward.
if [ -n "$BACK" ]; then record_deployed "$BACK"; fi

cat <<EOF

Буцаалаа. Одоо ажиллаж буй хувилбар: ${BACK:-rollback}
Шалгах:  curl -s http://127.0.0.1/health

Энэ нь зөвхөн АЖИЛЛАЖ БУЙ системийг буцаасан. Кодын хуулбар хэвээрээ (${NOW:-шинэ хувилбар}) тул
дараагийн  bash deploy/store/setup.sh  шинэ кодыг дахин бүтээнэ. Эвдрэлийг олж засаад push хийнэ үү.
EOF
