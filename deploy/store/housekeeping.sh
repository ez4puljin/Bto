#!/usr/bin/env bash
# Disk housekeeping on the store's Ubuntu PC (ADR-0186 #7, ADR-0211). Every update leaves behind
# the image it replaced and the build cache of its layers, about 6 GB a full update and 2 GB a
# pages-only one. This removes both and keeps what the next build and the way back need:
#
#   - images without a tag that no container uses. The images of the running stacks and
#     `:store-previous` (rollback.sh, ADR-0196) carry tags and stay: never `image prune -a` here.
#   - build cache above STORE_BUILD_CACHE_GB (deploy/store/.env, default 30), the least recently
#     used first. The base images and pnpm's store are used by every build, so they stay and the
#     next build is as fast as the last. Not by age: a quiet week would empty the cache.
#   - never a volume: the databases and the uploaded files stay.
#
# Run by auto-deploy.sh as the last step of every round (after the till server's build, and after a
# round that failed), by setup.sh before a build when under 15 GB is free, and by backup.sh every
# night. An update by hand is followed by `bash deploy/store/housekeeping.sh` or left to the night.
#
#   bash deploy/store/housekeeping.sh            before and after, in full
#   bash deploy/store/housekeeping.sh --quiet    one line, never fails (what the scripts run)
#   bash deploy/store/housekeeping.sh --all      the whole build cache too (the next build is slow)
set -uo pipefail
# shellcheck source=deploy/store/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

QUIET=no
ALL=no
for arg in "$@"; do
  case "$arg" in
    --quiet) QUIET=yes ;;
    --all) ALL=yes ;;
    *)
      echo "Танигдаагүй сонголт: $arg (--quiet, --all)" >&2
      exit 64
      ;;
  esac
done

CACHE_GB=$(store_setting STORE_BUILD_CACHE_GB 30)
case "$CACHE_GB" in *[!0-9]* | "") CACHE_GB=30 ;; esac

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  # A script's round never waits at a password prompt.
  if [ "$QUIET" = yes ]; then
    echo "Цэвэрлэгээ хийгдсэнгүй: Docker хариу өгөхгүй байна."
    exit 0
  fi
  DOCKER=(sudo docker)
fi

free_gb() { df -BG --output=avail / | tail -n 1 | tr -dc '0-9'; }
run() {
  if [ "$QUIET" = yes ]; then "$@" >/dev/null 2>&1; else "$@"; fi
}

BEFORE=$(free_gb)
if [ "$QUIET" = no ]; then
  echo "== Өмнө"
  df -h / | tail -n 1
  "${DOCKER[@]}" system df
fi

FAILED=""
# Untagged images only: what has a tag stays, the way back included.
run "${DOCKER[@]}" image prune -f || FAILED="$FAILED image"
if [ "$ALL" = yes ]; then
  run "${DOCKER[@]}" builder prune -af || FAILED="$FAILED cache"
else
  run "${DOCKER[@]}" builder prune -f --max-used-space "${CACHE_GB}gb" || FAILED="$FAILED cache"
fi

if [ "$QUIET" = no ]; then
  echo "== Дараа"
  df -h / | tail -n 1
  "${DOCKER[@]}" system df
fi
if [ -n "$FAILED" ]; then
  echo "Цэвэрлэгээ бүрэн хийгдсэнгүй ($(echo $FAILED)): сул зай $(free_gb) GB."
  [ "$QUIET" = yes ] || exit 1
  exit 0
fi
echo "Цэвэрлэгээ: сул зай ${BEFORE} GB → $(free_gb) GB (build cache-ийн дээд хязгаар ${CACHE_GB} GB)."
