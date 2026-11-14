#!/usr/bin/env bash
# The deploy library's decisions (deploy-lib.sh, ADR-0196) tried without Docker or GitHub: what CI
# verdict is read from an answer, what is kept as the way back, and which containers would roll.
#   bash deploy/store/deploy-lib.test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
export BTO_DEPLOY_STATE
BTO_DEPLOY_STATE=$(mktemp -d)
DOCKER=(true)
COMPOSE=(true)
# shellcheck source=deploy/store/deploy-lib.sh
. deploy/store/deploy-lib.sh

FAILS=0
expect() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected «$3», got «$2»"; FAILS=$((FAILS + 1)); fi
}

# --- what CI said, from the answer `gh` gives --------------------------------------------------
BIN=$(mktemp -d)
PATH="$BIN:$PATH"
fake_gh() { printf '#!/usr/bin/env bash\n%s\n' "$1" >"$BIN/gh"; chmod +x "$BIN/gh"; }

fake_gh 'echo success'
expect "a green run is green" "$(ci_verdict)" "success"
fake_gh 'echo failure'
expect "a red run is red" "$(ci_verdict)" "failure"
fake_gh 'echo cancelled'
expect "a cancelled run is not a pass" "$(ci_verdict)" "failure"
fake_gh 'echo pending'
expect "a run still going is pending" "$(ci_verdict)" "pending"
fake_gh 'echo none'
expect "no run for this commit is unknown" "$(ci_verdict)" "unknown"
fake_gh 'echo "error: not signed in" >&2; exit 1'
expect "a gh that cannot answer is unknown" "$(ci_verdict)" "unknown"
rm -f "$BIN/gh"
# Only the emptied directory on the path: a PC that has the real gh, signed in, must not answer.
expect "no gh at all is unknown" "$(PATH="$BIN" ci_verdict)" "unknown"

# --- the versions the way back is made of ------------------------------------------------------
expect "nothing deployed yet" "$(deployed_version)" ""
record_deployed aaaaaaa
expect "the first update is the current one" "$(deployed_version)" "aaaaaaa"
expect "and there is nothing to go back to" "$(previous_version)" ""
# The next update keeps what ran before it. (An array cannot be a command prefix: set it first.)
DOCKER=(true)
keep_previous_images
record_deployed bbbbbbb
expect "the second update is current" "$(deployed_version)" "bbbbbbb"
expect "and the first is the way back" "$(previous_version)" "aaaaaaa"
keep_previous_images
record_deployed ccccccc
expect "a third update moves the window" "$(deployed_version)" "ccccccc"
expect "one version back, never two" "$(previous_version)" "bbbbbbb"

# --- which containers roll ---------------------------------------------------------------------
# A fake docker: three containers of api-apps, the first two still on the old image.
docker_fake() {
  case "$1 ${2:-}" in
    "image inspect") echo new-image ;;
    "ps --format") printf 'bto-store-api-apps-1\nbto-store-api-apps-3\nbto-store-api-apps-2\n' ;;
    "inspect bto-store-api-apps-3") echo new-image ;;
    "inspect"*) echo old-image ;;
    "rm -f") echo "removed $3" >>"$BTO_DEPLOY_STATE/rolled" ;;
    *) : ;;
  esac
}
DOCKER=(docker_fake)
COMPOSE=(true)
ROLLED=$(roll_service api-apps)
expect "only the stale containers roll" "$(grep -c removed "$BTO_DEPLOY_STATE/rolled" 2>/dev/null || echo 0)" "2"
expect "oldest first, by name" "$(head -n 1 "$BTO_DEPLOY_STATE/rolled" | awk '{print $2}')" "bto-store-api-apps-1"
expect "and it says how many" "$(printf '%s' "$ROLLED" | tail -n 1 | tr -s ' ')" " api-apps: 2 процесс ээлжлэн солигдлоо"

# A service of one container is left to the plain `up`: rolling it would be the same gap.
docker_one() {
  case "$1 ${2:-}" in
    "image inspect") echo new-image ;;
    "ps --format") echo bto-store-api-reports-1 ;;
    "inspect"*) echo old-image ;;
    "rm -f") echo "removed $3" >>"$BTO_DEPLOY_STATE/rolled-one" ;;
    *) : ;;
  esac
}
DOCKER=(docker_one)
roll_service api-reports >/dev/null
expect "a single container is not rolled" "$([ -f "$BTO_DEPLOY_STATE/rolled-one" ] && echo yes || echo no)" "no"

# --- the door last and alone -------------------------------------------------------------------
# A fake compose that answers `config --services` and writes down every `up`.
compose_fake() {
  case "$1" in
    config) printf 'postgres\napi\napi-apps\napi-reports\nworker\nweb\n' ;;
    up) shift; echo "up $*" >>"$BTO_DEPLOY_STATE/ups" ;;
  esac
}
COMPOSE=(compose_fake)
start_stack
expect "two starts" "$(wc -l <"$BTO_DEPLOY_STATE/ups" | tr -d ' ')" "2"
expect "everything but the door first" "$(sed -n 1p "$BTO_DEPLOY_STATE/ups")" "up -d --wait postgres api api-apps api-reports worker"
expect "then the door alone, without touching what it waits for" "$(sed -n 2p "$BTO_DEPLOY_STATE/ups")" "up -d --no-deps --wait --timeout 2 web"
: >"$BTO_DEPLOY_STATE/ups"
start_stack --force-recreate
expect "the way back starts in the same order" "$(sed -n 2p "$BTO_DEPLOY_STATE/ups")" "up -d --no-deps --wait --timeout 2 --force-recreate web"
# A compose that cannot list its services: one plain start, as before.
compose_mute() { case "$1" in up) shift; echo "up $*" >>"$BTO_DEPLOY_STATE/ups-mute" ;; esac; }
COMPOSE=(compose_mute)
start_stack
expect "no list, one plain start" "$(cat "$BTO_DEPLOY_STATE/ups-mute")" "up -d --wait"

rm -rf -- "${BTO_DEPLOY_STATE:?}" "${BIN:?}"
echo
if [ "$FAILS" -gt 0 ]; then echo "$FAILS failed"; exit 1; fi
echo "all passed"
