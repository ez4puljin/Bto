#!/usr/bin/env bash
# Shared by backup.sh and restore-drill.sh (ADR-0186 #7). Sourced, never run.
#
# The centre's and the edge's PostgreSQL are reached inside their containers (local socket, no
# password travels). BTO_CENTRE_PG and BTO_EDGE_PG replace that prefix in a rehearsal against a
# plain PostgreSQL (docs/runbooks/store-install.md, "Rehearsing the backup scripts").

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
STORE_ENV="$REPO/deploy/store/.env"
EDGE_ENV="$REPO/deploy/edge/.env"
STORE_COMPOSE=(docker compose -f "$REPO/deploy/store/docker-compose.store.yml" --env-file "$STORE_ENV")
EDGE_COMPOSE=(docker compose -f "$REPO/deploy/edge/docker-compose.edge.yml" --env-file "$EDGE_ENV")

CENTRE_DB=${BTO_CENTRE_DB:-bto}
CENTRE_USER=${BTO_CENTRE_USER:-postgres}
EDGE_DB=${BTO_EDGE_DB:-tugeel_edge}
EDGE_USER=${BTO_EDGE_USER:-edge}
DRILL_DB=restore_drill

centre_pg() {
  if [ -n "${BTO_CENTRE_PG:-}" ]; then
    # shellcheck disable=SC2086
    $BTO_CENTRE_PG "$@"
  else
    "${STORE_COMPOSE[@]}" exec -T postgres "$@"
  fi
}

edge_pg() {
  if [ -n "${BTO_EDGE_PG:-}" ]; then
    # shellcheck disable=SC2086
    $BTO_EDGE_PG "$@"
  else
    "${EDGE_COMPOSE[@]}" exec -T edge-db "$@"
  fi
}

edge_available() {
  if [ -n "${BTO_EDGE_PG:-}" ]; then return 0; fi
  [ -f "$EDGE_ENV" ] && "${EDGE_COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx edge-db
}

# A value of deploy/store/.env, or the default. The file is read, never sourced.
store_setting() {
  local name=$1 fallback=$2 value=""
  if [ -f "$STORE_ENV" ]; then
    value=$(grep -E "^${name}=" "$STORE_ENV" | head -n 1 | cut -d= -f2- || true)
  fi
  printf '%s' "${value:-$fallback}"
}

# Every table of the named schemas with its row count, in one statement (one snapshot):
#   count_tables centre_pg "$CENTRE_USER" "$CENTRE_DB" "'public','fin'"
count_tables() {
  local run=$1 user=$2 db=$3 schemas=$4
  "$run" psql -U "$user" -d "$db" -At -F $'\t' -v ON_ERROR_STOP=1 -c "
    SELECT table_schema || '.' || table_name,
           (xpath('/row/n/text()', query_to_xml(
              format('SELECT count(*) AS n FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_type = 'BASE TABLE' AND table_schema IN ($schemas)
    ORDER BY 1"
}

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
