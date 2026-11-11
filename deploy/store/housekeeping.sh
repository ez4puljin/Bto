#!/usr/bin/env bash
# Disk housekeeping on the store's Ubuntu PC (ADR-0186 #7): shows what uses the disk and removes
# what Docker no longer needs: build cache older than a week and images no container uses any
# more. It never touches a volume: the databases and the uploaded files stay.
#
#   bash deploy/store/housekeeping.sh          (add --all to drop the whole build cache)
set -euo pipefail

DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then DOCKER=(sudo docker); fi

echo "== Өмнө"
df -h / | tail -n 1
"${DOCKER[@]}" system df

if [ "${1:-}" = "--all" ]; then
  "${DOCKER[@]}" builder prune -af
else
  "${DOCKER[@]}" builder prune -f --filter until=168h
fi
# Dangling images only: the tagged images of the running stacks stay.
"${DOCKER[@]}" image prune -f

echo "== Дараа"
df -h / | tail -n 1
"${DOCKER[@]}" system df
