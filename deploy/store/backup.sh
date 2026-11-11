#!/usr/bin/env bash
# Nightly backup of the store's Ubuntu PC (ADR-0186 #7): the centre's and the edge's databases as
# pg_dump archives with their row counts, the uploaded files as a mirror, the two .env files.
# Kept BACKUP_KEEP_DAYS on the box and copied to the USB disk when one is mounted at
# BACKUP_USB_DIR. The box has one disk: a backup that stays on it is not a backup, so the second
# copy is pulled from the owner's PC (tools/store-backup/pull.ps1).
#
#   sudo bash deploy/store/backup.sh        (the bto-backup timer runs exactly this, as root)
#
# The archives hold everything, password hashes and the box's secrets included: the backup folder
# is readable by root and the checkout's owner only, and the USB disk is kept locked away.
set -Eeuo pipefail
# shellcheck source=deploy/store/lib.sh
. "$(dirname "$0")/lib.sh"

BACKUP_DIR=${BACKUP_DIR:-$(store_setting BACKUP_DIR /var/backups/bto)}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-$(store_setting BACKUP_KEEP_DAYS 14)}
USB_DIR=${BACKUP_USB_DIR:-$(store_setting BACKUP_USB_DIR /mnt/bto-backup)}
USB_KEEP_DAYS=${BACKUP_USB_KEEP_DAYS:-$(store_setting BACKUP_USB_KEEP_DAYS 90)}
case "$BACKUP_DIR" in /*) ;; *) echo "BACKUP_DIR must be an absolute path" >&2; exit 64 ;; esac
case "$KEEP_DAYS$USB_KEEP_DAYS" in *[!0-9]*) echo "the KEEP_DAYS settings must be numbers" >&2; exit 64 ;; esac

STAMP=$(date +%Y-%m-%d_%H%M)
OUT="$BACKUP_DIR/daily/$STAMP"
STATUS="$BACKUP_DIR/last-run.txt"
umask 027
mkdir -p "$OUT" "$BACKUP_DIR/storage"

fail() {
  log "FAILED: $*"
  { echo "FAILED $(date '+%Y-%m-%d %H:%M') — $*"; } >"$STATUS" 2>/dev/null || true
  exit 1
}
trap 'fail "backup.sh stopped at line $LINENO"' ERR

log "centre: counting and dumping $CENTRE_DB"
count_tables centre_pg "$CENTRE_USER" "$CENTRE_DB" "'public','fin'" >"$OUT/counts-centre.tsv"
centre_pg pg_dump -U "$CENTRE_USER" -Fc -Z 6 "$CENTRE_DB" >"$OUT/centre.dump"
centre_pg pg_dumpall -U "$CENTRE_USER" --globals-only >"$OUT/globals.sql"
# A dump that cannot list its own contents is not one.
centre_pg pg_restore --list <"$OUT/centre.dump" >/dev/null

EDGE_NOTE="edge: dumped"
if edge_available; then
  log "edge: counting and dumping $EDGE_DB"
  count_tables edge_pg "$EDGE_USER" "$EDGE_DB" "'public'" >"$OUT/counts-edge.tsv"
  edge_pg pg_dump -U "$EDGE_USER" -Fc -Z 6 "$EDGE_DB" >"$OUT/edge.dump"
  edge_pg pg_restore --list <"$OUT/edge.dump" >/dev/null
else
  EDGE_NOTE="edge: NOT dumped (its database is not running)"
  log "WARNING: $EDGE_NOTE"
fi

# What a rebuilt box needs besides the data: the PIN key, the key that seals the AI key, the edge's link.
if [ -f "$STORE_ENV" ]; then cp "$STORE_ENV" "$OUT/store.env"; fi
if [ -f "$EDGE_ENV" ]; then cp "$EDGE_ENV" "$OUT/edge.env"; fi
git -C "$REPO" rev-parse HEAD >"$OUT/commit.txt" 2>/dev/null || true
(cd "$OUT" && sha256sum -- * >SHA256SUMS)

# Uploaded files are written once under a random name and never changed: a mirror is enough.
STORAGE_SRC=${BTO_STORAGE_SRC:-$(docker volume inspect bto-store_storage -f '{{.Mountpoint}}' 2>/dev/null || true)}
STORAGE_NOTE="files: mirrored"
if [ -n "$STORAGE_SRC" ] && [ -d "$STORAGE_SRC" ]; then
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude '.tmp/' "$STORAGE_SRC/" "$BACKUP_DIR/storage/"
  else
    cp -a -u "$STORAGE_SRC/." "$BACKUP_DIR/storage/"
  fi
else
  STORAGE_NOTE="files: NOT mirrored (the storage volume was not found; run as root)"
  log "WARNING: $STORAGE_NOTE"
fi

# Old days go only after today's is safely written. The paths are fixed below BACKUP_DIR.
prune_days() {
  local dir=$1 days=$2
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????' -mtime "+$days" -exec rm -rf -- {} +
}
prune_days "$BACKUP_DIR/daily" "$KEEP_DAYS"

USB_NOTE="USB: copied to $USB_DIR"
if mountpoint -q "$USB_DIR" 2>/dev/null; then
  mkdir -p "$USB_DIR/daily" "$USB_DIR/storage"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a "$OUT" "$USB_DIR/daily/"
    rsync -a "$BACKUP_DIR/storage/" "$USB_DIR/storage/"
  else
    cp -a "$OUT" "$USB_DIR/daily/"
    cp -a -u "$BACKUP_DIR/storage/." "$USB_DIR/storage/"
  fi
  (cd "$USB_DIR/daily/$STAMP" && sha256sum --quiet -c SHA256SUMS)
  prune_days "$USB_DIR/daily" "$USB_KEEP_DAYS"
else
  USB_NOTE="USB: NOT copied (no disk mounted at $USB_DIR)"
  log "WARNING: $USB_NOTE"
fi

FREE_GB=$(df -BG --output=avail "$BACKUP_DIR" | tail -n 1 | tr -dc '0-9')
DISK_NOTE="disk: ${FREE_GB} GB free"
if [ "${FREE_GB:-0}" -lt 20 ]; then DISK_NOTE="$DISK_NOTE — LOW, run deploy/store/housekeeping.sh"; fi

# Sunday: the build cache is the one thing on this disk that only grows.
if [ "$(date +%u)" = "7" ] && [ -z "${BTO_CENTRE_PG:-}" ]; then
  docker builder prune -f --filter until=168h >/dev/null 2>&1 || true
fi

trap - ERR
{
  echo "OK $(date '+%Y-%m-%d %H:%M') — $STAMP"
  echo "centre: $(du -h "$OUT/centre.dump" | cut -f1), $(wc -l <"$OUT/counts-centre.tsv") tables"
  echo "$EDGE_NOTE"
  echo "$STORAGE_NOTE"
  echo "$USB_NOTE"
  echo "$DISK_NOTE"
} >"$STATUS"

# The checkout's owner pulls the copy to the owner's PC over SSH: let that user read, nobody else.
GROUP=$(stat -c %G "$REPO" 2>/dev/null || true)
if [ "$(id -u)" = "0" ] && [ -n "$GROUP" ]; then
  chgrp -R "$GROUP" "$BACKUP_DIR"
  chmod -R g+rX,o-rwx "$BACKUP_DIR"
fi

cat "$STATUS"
