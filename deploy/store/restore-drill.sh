#!/usr/bin/env bash
# Restore drill (ADR-0186 #7): proves a backup can be read back. Restores the centre's dump (and
# the edge's, when the folder has one) into a scratch database named restore_drill beside the live
# one, compares every table's row count with the counts written at backup time, then drops the
# scratch database. The live databases are only read.
#
#   sudo bash deploy/store/restore-drill.sh                       the newest backup on the box
#   sudo bash deploy/store/restore-drill.sh /mnt/bto-backup/daily/2026-11-20_0230
#
# A table may hold MORE rows in the restored copy than were counted (the count is taken just
# before the dump, and work goes on in between). FEWER rows fail the drill, except in the few
# tables the system itself prunes.
set -Eeuo pipefail
# shellcheck source=deploy/store/lib.sh
. "$(dirname "$0")/lib.sh"

# Sessions, one-time codes and replay keys are deleted by the system as they expire.
PRUNED=" public.auth_sessions public.password_resets public.idempotency_keys public.customer_password_codes "

BACKUP_DIR=${BACKUP_DIR:-$(store_setting BACKUP_DIR /var/backups/bto)}
DIR=${1:-}
if [ -z "$DIR" ]; then
  DIR=$(find "$BACKUP_DIR/daily" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??_????' 2>/dev/null | sort | tail -n 1)
fi
if [ -z "$DIR" ] || [ ! -f "$DIR/centre.dump" ]; then
  echo "No backup found (looked for centre.dump in '${DIR:-$BACKUP_DIR/daily}')." >&2
  exit 1
fi
log "drill on $DIR"
(cd "$DIR" && sha256sum --quiet -c SHA256SUMS)
log "checksums: ok"

FAILED=0

# drill <name> <runner> <user> <dump> <counts> <schemas> <createdb options...>
drill() {
  local name=$1 run=$2 user=$3 dump=$4 counts=$5 schemas=$6
  shift 6
  local started restored
  started=$(date +%s)
  "$run" dropdb -U "$user" --if-exists "$DRILL_DB"
  "$run" createdb -U "$user" "$@" "$DRILL_DB"
  "$run" pg_restore -U "$user" -d "$DRILL_DB" --exit-on-error <"$dump"
  restored=$(mktemp)
  count_tables "$run" "$user" "$DRILL_DB" "$schemas" >"$restored"
  local missing=0 fewer=0 more=0 same=0 table expected actual
  while IFS=$'\t' read -r table expected; do
    actual=$(awk -F'\t' -v t="$table" '$1 == t { print $2 }' "$restored")
    if [ -z "$actual" ]; then
      echo "  MISSING  $table (counted $expected at backup time)"
      missing=$((missing + 1))
    elif [ "$actual" -lt "$expected" ]; then
      case "$PRUNED" in
        *" $table "*) same=$((same + 1)) ;;
        *)
          echo "  FEWER    $table: $actual restored, $expected counted"
          fewer=$((fewer + 1))
          ;;
      esac
    elif [ "$actual" -gt "$expected" ]; then
      more=$((more + 1))
    else
      same=$((same + 1))
    fi
  done <"$counts"
  rm -f "$restored"
  "$run" dropdb -U "$user" --if-exists "$DRILL_DB"
  log "$name: $same tables equal, $more with rows written after the count, $fewer with fewer rows, $missing missing ($(($(date +%s) - started)) s)"
  if [ "$fewer" -gt 0 ] || [ "$missing" -gt 0 ]; then FAILED=1; fi
}

drill centre centre_pg "$CENTRE_USER" "$DIR/centre.dump" "$DIR/counts-centre.tsv" "'public','fin'" \
  -T template0 -E UTF8 --locale-provider=icu --icu-locale=und

if [ -f "$DIR/edge.dump" ]; then
  if edge_available; then
    drill edge edge_pg "$EDGE_USER" "$DIR/edge.dump" "$DIR/counts-edge.tsv" "'public'" -T template0 -E UTF8
  else
    log "edge: its database is not running here, the edge dump was not drilled"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  log "DRILL FAILED"
  exit 1
fi
log "DRILL OK: the backup restores and holds what was counted"
