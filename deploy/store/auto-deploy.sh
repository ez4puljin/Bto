#!/usr/bin/env bash
# Puts every push to main on the real system by itself (ADR-0204): a round every minute as the
# checkout owner's timer (install-auto-deploy-timer.sh). Nobody waits for CI or says «yes»:
#
#   - nothing new on origin/main                      → nothing
#   - only docs (docs/, *.md, .claude/, .github/)     → the checkout moves, nothing is rebuilt
#   - only the office's pages (apps/web)              → only the web image and its door (about a minute)
#   - anything else, a new migration included         → setup.sh at once (it still refuses a commit
#                                                        CI has already found red), then the edge;
#                                                        nothing waits for CI (ADR-0206)
#   - the till server is rebuilt only when what it is built from changed (the api, packages, the
#     kiosk's pos.html and src/pos, deploy/edge): otherwise the tills do not pause
#
# After an update made while CI was still running, the next rounds look at CI's answer: red →
# rollback.sh to the version before. rollback.sh refuses when a migration stands between them: then the
# red version stays until a fix is pushed, and the log says so (the owner's choice, ADR-0206).
# Each update writes a log with the time of every line, so the slow step can be seen.
#
#   bash deploy/store/auto-deploy.sh            one round (what the timer runs)
#   bash deploy/store/auto-deploy.sh --check    what a round would do now, without doing it
#
# Logs: $DEPLOY_STATE/auto-deploy.log (one line per decision), $DEPLOY_STATE/runs/<sha>.log.
# Stop it:  systemctl --user disable --now bto-auto-deploy.timer
set -euo pipefail

# --- what a round decides, from the changed files and CI's word (auto-deploy.test.sh) ----------

# Prints one of: none, docs, web, deploy, refuse.
#   $1: CI's verdict on the target (success, failure, pending, cancelled, unknown); then the changed
#   files. Only a verdict already red holds code back; a migration does not wait for CI (ADR-0206).
# `web`: only the office's pages changed, so only the web image is built and only its door
# restarts (setup.sh --only-web: about a minute instead of four or five); the api is left running.
plan_update() {
  local verdict=$1
  shift
  [ "$#" -gt 0 ] || { echo none; return 0; }
  local file code=no other=no
  for file in "$@"; do
    case "$file" in
      docs/* | .claude/* | .github/* | *.md) ;;
      apps/web/Dockerfile | apps/web/package.json) code=yes; other=yes ;;
      apps/web/*) code=yes ;;
      *) code=yes; other=yes ;;
    esac
  done
  if [ "$code" = no ]; then echo docs; return 0; fi
  if [ "$verdict" = failure ]; then echo refuse; return 0; fi
  if [ "$other" = no ]; then echo web; return 0; fi
  echo deploy
}

# Prints yes when the till server (deploy/edge) is built from something that changed: its api is
# the api image and its kiosk the web's pos.html. Only then does an update pause the tills.
needs_edge() {
  local file
  for file in "$@"; do
    case "$file" in
      docs/* | .claude/* | .github/* | *.md) ;;
      apps/web/src/pos/* | apps/web/pos.html | apps/web/Dockerfile | apps/web/package.json) echo yes; return 0 ;;
      apps/web/*) ;;
      *) echo yes; return 0 ;;
    esac
  done
  echo no
}

if [ "${1:-}" = "--source-only" ]; then return 0 2>/dev/null || exit 0; fi

# The round moves this checkout, this file included, while it runs: bash reads a script as it goes,
# so the whole round is one block, read to its end before the first line of it runs.
{

# --- one round -----------------------------------------------------------------------------------

CHECK=no
case "${1:-}" in
  "") ;;
  --check) CHECK=yes ;;
  *)
    echo "Танигдаагүй сонголт: $1 (зөвхөн --check)" >&2
    exit 64
    ;;
esac

cd "$(dirname "$0")/../.."
COMPOSE_FILE=deploy/store/docker-compose.store.yml
ENV_FILE=deploy/store/.env
DOCKER=(docker)
COMPOSE=("${DOCKER[@]}" compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
# shellcheck source=deploy/store/deploy-lib.sh
. "$(dirname "$0")/deploy-lib.sh"
mkdir -p "$DEPLOY_STATE/runs"
LOG="$DEPLOY_STATE/auto-deploy.log"

say() {
  local line
  line="$(date '+%F %T') $*"
  echo "$line"
  [ "$CHECK" = yes ] || echo "$line" >>"$LOG"
}
# A decision that repeats every round (refuse, a dirty checkout) is written once per target.
say_once() {
  local key=$1
  shift
  if [ "$(cat "$DEPLOY_STATE/auto-noted" 2>/dev/null)" != "$key" ]; then
    say "$@"
    [ "$CHECK" = yes ] || printf '%s\n' "$key" >"$DEPLOY_STATE/auto-noted"
  elif [ "$CHECK" = yes ]; then
    say "$@"
  fi
}

# One round at a time: an update outlasts the minute.
exec 9>"$DEPLOY_STATE/auto-deploy.lock"
if ! flock -n 9; then
  [ "$CHECK" = yes ] && echo "Шинэчлэлт яг одоо явж байна."
  exit 0
fi

# CI's late answer on an update made before it came (see the head of this file).
follow_ci() {
  local watched verdict now
  watched=$(cat "$DEPLOY_STATE/auto-ci-watch" 2>/dev/null || true)
  [ -n "$watched" ] || return 0
  verdict=$(ci_verdict "$watched")
  case "$verdict" in
    success)
      say "CI ногоон: ${watched:0:8}"
      [ "$CHECK" = yes ] || rm -f "$DEPLOY_STATE/auto-ci-watch"
      ;;
    cancelled)
      # A newer push stopped this run; that push's own run is the one to follow.
      say "CI ${watched:0:8}-ийг шинэ push-ийн улмаас зогсоосон: буцаахгүй"
      [ "$CHECK" = yes ] || rm -f "$DEPLOY_STATE/auto-ci-watch"
      ;;
    failure)
      now=$(deployed_version)
      if [ "$CHECK" = yes ]; then
        say "CI улаан: ${watched:0:8}; ажиллаж буй ${now:-?} бол буцаана"
        return 0
      fi
      rm -f "$DEPLOY_STATE/auto-ci-watch"
      if [ "$now" != "${watched:0:8}" ]; then
        say "CI улаан: ${watched:0:8}, гэхдээ одоо ${now:-?} ажиллаж байгаа тул буцаахгүй"
      elif bash deploy/store/rollback.sh >>"$DEPLOY_STATE/runs/${watched:0:8}.log" 2>&1; then
        say "CI улаан: ${watched:0:8} → өмнөх хувилбар руу буцаалаа ($(deployed_version))"
      else
        say "CI улаан: ${watched:0:8}, БУЦААЖ ЧАДСАНГҮЙ (migration эсвэл өмнөх image алга), засвар push хийтэл энэ хувилбар ажиллана: runs/${watched:0:8}.log"
      fi
      ;;
  esac
}
follow_ci

timeout 60 git fetch -q origin main || {
  say_once "fetch" "GitHub-ээс татаж чадсангүй; дараагийн минутад дахин оролдоно"
  exit 0
}
HEAD_SHA=$(git rev-parse HEAD)
TARGET=$(git rev-parse origin/main)
[ "$HEAD_SHA" != "$TARGET" ] || exit 0
SHORT=${TARGET:0:8}

if ! git merge-base --is-ancestor HEAD "$TARGET"; then
  say_once "diverged-$SHORT" "ЗОГСЛОО: ~/bto нь origin/main-ээс салбарласан тул $SHORT руу шууд шилжих боломжгүй"
  exit 0
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  say_once "dirty-$SHORT" "ЗОГСЛОО: ~/bto-д хадгалаагүй өөрчлөлт байна; $SHORT тавигдсангүй (git status)"
  exit 0
fi

mapfile -t CHANGED < <(git diff --name-only HEAD "$TARGET")
VERDICT=$(ci_verdict "$TARGET")
PLAN=$(plan_update "$VERDICT" "${CHANGED[@]}")

if [ "$CHECK" = yes ]; then
  say "$SHORT: ${#CHANGED[@]} файл өөрчлөгдсөн, CI $VERDICT → $PLAN"
  exit 0
fi

case "$PLAN" in
  none) exit 0 ;;
  refuse)
    say_once "refuse-$SHORT" "$SHORT: CI улаан тул тавихгүй. Засвар push хийхэд түүнийг тавина"
    exit 0
    ;;
  docs)
    git merge --ff-only -q "$TARGET"
    say "$SHORT: зөвхөн баримт бичиг өөрчлөгдсөн тул шилжүүлээд, дахин бүтээсэнгүй"
    exit 0
    ;;
esac

# web or deploy
RUN="$DEPLOY_STATE/runs/$SHORT.log"
stamp() { while IFS= read -r line; do printf '%s %s\n' "$(date +%T)" "$line"; done; }
EDGE=$(needs_edge "${CHANGED[@]}")
started=$(date +%s)
say "$SHORT: тавьж эхэллээ ($PLAN, ${#CHANGED[@]} файл, касс: $EDGE, CI $VERDICT)"
git merge --ff-only -q "$TARGET"
SETUP=(bash deploy/store/setup.sh)
if [ "$PLAN" = web ]; then SETUP+=(--only-web); fi
if ! "${SETUP[@]}" 2>&1 | stamp >"$RUN"; then
  say "$SHORT: төв систем ТАВИГДСАНГҮЙ ($(($(date +%s) - started)) сек): runs/$SHORT.log"
  exit 0
fi
store_done=$(date +%s)
edge_ok=yes
if [ "$EDGE" = yes ]; then bash deploy/edge/setup.sh 2>&1 | stamp >>"$RUN" || edge_ok=no; fi
finished=$(date +%s)
port=$(grep -E '^STORE_HTTP_PORT=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)
health=$(curl -s --max-time 10 "http://127.0.0.1:${port:-80}/health" || true)
running=$(printf '%s' "$health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
note="төв $((store_done - started)) сек"
if [ "$EDGE" = yes ]; then note="$note, касс $((finished - store_done)) сек"; fi
if [ "$edge_ok" = no ]; then note="$note, КАССЫН СЕРВЕР АЛДААТАЙ"; fi
# After --only-web the api keeps the version it was built at: then the answer only has to be ok.
if [ "$running" = "$SHORT" ] || { [ "$PLAN" = web ] && printf '%s' "$health" | grep -q '"status":"ok"'; }; then
  say "$SHORT: ажиллаж байна ($note)"
else
  say "$SHORT: тавьсан боловч /health «${running:-хариугүй}» гэж хариулж байна ($note): runs/$SHORT.log"
fi
if [ "$VERDICT" != success ]; then printf '%s\n' "$TARGET" >"$DEPLOY_STATE/auto-ci-watch"; fi
exit 0
}
