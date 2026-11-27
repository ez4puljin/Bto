#!/usr/bin/env bash
# What housekeeping.sh (ADR-0211) asks of Docker, with a Docker that only writes down what it was
# asked: untagged images only (the way back keeps its tag), the build cache by size, never a volume.
#   bash deploy/store/housekeeping.test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

WORK=$(mktemp -d)
trap 'rm -rf -- "${WORK:?}"' EXIT
mkdir -p "$WORK/bin" "$WORK/repo/deploy/store"
cp deploy/store/housekeeping.sh deploy/store/lib.sh "$WORK/repo/deploy/store/"
cat >"$WORK/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$DOCKER_CALLS"
case "$*" in "$DOCKER_FAILS"*) exit 1 ;; esac
exit 0
EOF
chmod +x "$WORK/bin/docker"
export DOCKER_CALLS="$WORK/calls.txt" DOCKER_FAILS="-"
PATH="$WORK/bin:$PATH"

FAILS=0
expect() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected «$3», got «$2»"; FAILS=$((FAILS + 1)); fi
}
contains() {
  case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: «$2» lacks «$3»"; FAILS=$((FAILS + 1)) ;; esac
}
# One run with the given flags: REMOVED is what Docker was told to remove (on one line), OUT what
# the run said, CODE how it ended. Called plainly, never in `$(…)`, which would lose them.
tidy() {
  : >"$DOCKER_CALLS"
  OUT=$(bash "$WORK/repo/deploy/store/housekeeping.sh" "$@" 2>&1)
  CODE=$?
  REMOVED=$(grep -E 'prune|rm' "$DOCKER_CALLS" | paste -sd'|' -)
}

tidy --quiet
expect "an update removes untagged images and the cache above 30 GB" \
  "$REMOVED" "image prune -f|builder prune -f --max-used-space 30gb"
expect "and says it in one line" "$(printf '%s\n' "$OUT" | wc -l | tr -d ' ')" "1"
contains "with the limit" "$OUT" "30 GB"

printf 'STORE_BUILD_CACHE_GB=25\n' >"$WORK/repo/deploy/store/.env"
tidy --quiet
expect "the limit comes from deploy/store/.env" \
  "$REMOVED" "image prune -f|builder prune -f --max-used-space 25gb"
printf 'STORE_BUILD_CACHE_GB=lots\n' >"$WORK/repo/deploy/store/.env"
tidy --quiet
expect "a limit that is not a number is the default" \
  "$REMOVED" "image prune -f|builder prune -f --max-used-space 30gb"
rm -f "$WORK/repo/deploy/store/.env"

tidy --quiet --all
expect "--all empties the build cache, and still spares tagged images" \
  "$REMOVED" "image prune -f|builder prune -af"

DOCKER_FAILS="builder prune"
tidy --quiet
expect "a step Docker refuses does not fail an update" "$CODE" "0"
contains "and is named" "$OUT" "бүрэн хийгдсэнгүй"
tidy
expect "but fails a run by hand" "$CODE" "1"

DOCKER_FAILS="info"
tidy --quiet
expect "without Docker a script's run removes nothing" "$REMOVED" ""
expect "and does not fail the update" "$CODE" "0"
DOCKER_FAILS="-"

tidy --everything
expect "an unknown flag is refused" "$CODE" "64"

if [ "$FAILS" -gt 0 ]; then
  echo "$FAILS failed"
  exit 1
fi
echo "all passed"
