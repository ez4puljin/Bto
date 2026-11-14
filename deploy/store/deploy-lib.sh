#!/usr/bin/env bash
# Shared by setup.sh and rollback.sh (ADR-0196). Sourced after DOCKER and COMPOSE are set, never
# run on its own.
#
# What it adds to an update of the centre:
#   - the image that is running is kept as `:store-previous`, so going back is a retag, not a
#     ten-minute rebuild (rollback.sh);
#   - the app replicas are replaced one at a time, so «Bto300» and the staff app keep answering
#     while the centre is updated;
#   - what CI said about this commit is looked up before anything is built.

DEPLOY_STATE=${BTO_DEPLOY_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/bto-deploy}
PROJECT=bto-store
API_IMAGE=bto-api:store-local
WEB_IMAGE=bto-web:store-local
API_PREVIOUS=bto-api:store-previous
WEB_PREVIOUS=bto-web:store-previous

# The version of the last update that finished, and the one before it («» when there is none).
deployed_version() { cat "$DEPLOY_STATE/current" 2>/dev/null || true; }
previous_version() { cat "$DEPLOY_STATE/previous" 2>/dev/null || true; }

# Keeps what is running now as the way back, before the new images replace the tags.
keep_previous_images() {
  local kept=0
  if "${DOCKER[@]}" image inspect "$API_IMAGE" >/dev/null 2>&1; then
    "${DOCKER[@]}" image tag "$API_IMAGE" "$API_PREVIOUS"
    kept=1
  fi
  if "${DOCKER[@]}" image inspect "$WEB_IMAGE" >/dev/null 2>&1; then
    "${DOCKER[@]}" image tag "$WEB_IMAGE" "$WEB_PREVIOUS"
    kept=1
  fi
  mkdir -p "$DEPLOY_STATE"
  if [ "$kept" = "1" ] && [ -f "$DEPLOY_STATE/current" ]; then
    cp "$DEPLOY_STATE/current" "$DEPLOY_STATE/previous"
  fi
}

# Written only when an update has finished: `current` is what runs, `previous` what rollback gives.
record_deployed() {
  mkdir -p "$DEPLOY_STATE"
  printf '%s\n' "$1" >"$DEPLOY_STATE/current"
}

# The containers of one service of this stack, oldest first.
service_containers() {
  "${DOCKER[@]}" ps --format '{{.Names}}' \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | sort
}

# Replaces a service's containers one at a time, so the others keep answering (ADR-0196 #2).
#
# Compose has no rolling update: `up` replaces every stale container of a service together. One is
# removed instead, and `up --no-recreate` then makes good the missing one from the new image and
# leaves the rest alone (it adds the next free number, so the names drift upward — only the
# compose labels matter). A service of one container is left to the plain `up`: removing it would
# be the same gap, without the care.
roll_service() {
  local service=$1 current name count=0 rolled=0
  current=$("${DOCKER[@]}" image inspect "$API_IMAGE" --format '{{.Id}}' 2>/dev/null) || return 0
  count=$(service_containers "$service" | grep -c . || true)
  [ "$count" -ge 2 ] || return 0
  for name in $(service_containers "$service"); do
    if [ "$("${DOCKER[@]}" inspect "$name" --format '{{.Image}}' 2>/dev/null)" = "$current" ]; then
      continue
    fi
    rolled=$((rolled + 1))
    printf '   %s (%s/%s)\n' "$name" "$rolled" "$count"
    "${DOCKER[@]}" rm -f "$name" >/dev/null
    "${COMPOSE[@]}" up -d --no-deps --no-recreate --wait "$service" >/dev/null
  done
  [ "$rolled" = "0" ] || echo "   $service: $rolled процесс ээлжлэн солигдлоо"
}

# Starts the centre with its one door closed as briefly as it can be (ADR-0196 #2, 2026-11-14).
#
# Caddy in `web` is the only way in, to the apps' replicas too, and it waits for a healthy api.
# Started together with the rest, compose takes the old Caddy down at the beginning and brings the
# new one up only when the api answers: on 2026-11-14 that closed the door for 12 s and cut off
# both apps, although their own processes had been rolled without one failed request. So
# everything but the door first, while the old Caddy still hands the apps to their replicas; then
# the door alone, which is the time of its own restart (a second: Caddyfile.store `grace_period`).
# "$@": more flags for `up` (rollback.sh passes --force-recreate).
start_stack() {
  local others=()
  mapfile -t others < <("${COMPOSE[@]}" config --services 2>/dev/null | grep -vx web)
  if [ "${#others[@]}" -eq 0 ]; then
    "${COMPOSE[@]}" up -d --wait "$@"
    return
  fi
  "${COMPOSE[@]}" up -d --wait "$@" "${others[@]}"
  # --timeout: the Caddy that is running may be one started before `grace_period` was in its file
  # (a mounted file changing does not restart a container), and would hold the door for 10 s.
  "${COMPOSE[@]}" up -d --no-deps --wait --timeout 2 "$@" web
}

# What CI says about the commit this checkout stands on: success, failure, pending, unknown.
# Unknown covers everything the box cannot tell (no gh, not signed in, no run for this commit).
ci_verdict() {
  local sha out
  command -v gh >/dev/null 2>&1 || { echo unknown; return 0; }
  sha=$(git rev-parse HEAD 2>/dev/null) || { echo unknown; return 0; }
  out=$(gh run list --limit 30 --json headSha,status,conclusion \
    --jq "[.[] | select(.headSha == \"$sha\")] | first |
          if . == null then \"none\" elif .status != \"completed\" then \"pending\" else .conclusion end" \
    2>/dev/null) || { echo unknown; return 0; }
  case "$out" in
    success) echo success ;;
    pending) echo pending ;;
    none | "" | null) echo unknown ;;
    *) echo failure ;;
  esac
}
