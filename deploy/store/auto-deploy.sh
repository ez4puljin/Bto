#!/usr/bin/env bash
# Puts every push to main on the real system by itself (ADR-0204): a round every minute as the
# checkout owner's timer (install-auto-deploy-timer.sh). Nobody waits for CI or says «yes»:
#
#   - nothing new on origin/main                      → nothing
#   - only docs (docs/, *.md, .claude/, .github/)     → the checkout moves, nothing is rebuilt
#   - a new migration                                 → waits for CI green first (a migration is
#                                                        not undone by rollback.sh), refuses a red one
#   - anything else                                   → setup.sh at once (it still refuses a commit
#                                                        CI has already found red), then the edge
#
# After an update made while CI was still running, the next rounds look at CI's answer: red →
# rollback.sh to the version before (which itself refuses when a migration stands between them).
# Each update writes a log with the time of every line, so the slow step can be seen.
#
#   bash deploy/store/auto-deploy.sh            one round (what the timer runs)
#   bash deploy/store/auto-deploy.sh --check    what a round would do now, without doing it
#
# Logs: $DEPLOY_STATE/auto-deploy.log (one line per decision), $DEPLOY_STATE/runs/<sha>.log.
# Stop it:  systemctl --user disable --now bto-auto-deploy.timer
set -euo pipefail

# --- what a round decides, from the changed files and CI's word (auto-deploy.test.sh) ----------

# Prints one of: none, docs, deploy, wait, refuse.
#   $1: CI's verdict on the target (success, failure, pending, unknown); then the changed files.
plan_update() {
  local verdict=$1
  shift
  [ "$#" -gt 0 ] || { echo none; return 0; }
  local file code=no migration=no
  for file in "$@"; do
    case "$file" in
      apps/api/src/db/migrations/*.sql) migration=yes; code=yes ;;
      docs/* | .claude/* | .github/* | *.md) ;;
      *) code=yes ;;
    esac
  done
  if [ "$code" = no ]; then echo docs; return 0; fi
  if [ "$verdict" = failure ]; then echo refuse; return 0; fi
  if [ "$migration" = yes ] && [ "$verdict" != success ]; then echo wait; return 0; fi
  echo deploy
}

if [ "${1:-}" = "--source-only" ]; then return 0 2>/dev/null || exit 0; fi

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
# A decision that repeats every minute (wait, refuse, a dirty checkout) is written once per target.
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
        say "CI улаан: ${watched:0:8}, БУЦААЖ ЧАДСАНГҮЙ (migration эсвэл өмнөх image алга): runs/${watched:0:8}.log"
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
  wait)
    say_once "wait-$SHORT" "$SHORT: migration-тэй тул CI ногоон болохыг хүлээж байна (одоо $VERDICT)"
    exit 0
    ;;
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

# deploy
RUN="$DEPLOY_STATE/runs/$SHORT.log"
stamp() { while IFS= read -r line; do printf '%s %s\n' "$(date +%T)" "$line"; done; }
started=$(date +%s)
say "$SHORT: тавьж эхэллээ (${#CHANGED[@]} файл, CI $VERDICT)"
git merge --ff-only -q "$TARGET"
if ! bash deploy/store/setup.sh 2>&1 | stamp >"$RUN"; then
  say "$SHORT: төв систем ТАВИГДСАНГҮЙ ($(($(date +%s) - started)) сек): runs/$SHORT.log"
  exit 0
fi
store_done=$(date +%s)
edge_ok=yes
bash deploy/edge/setup.sh 2>&1 | stamp >>"$RUN" || edge_ok=no
finished=$(date +%s)
port=$(grep -E '^STORE_HTTP_PORT=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)
running=$(curl -s --max-time 10 "http://127.0.0.1:${port:-80}/health" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')
note="төв $((store_done - started)) сек, касс $((finished - store_done)) сек"
if [ "$edge_ok" = no ]; then note="$note, КАССЫН СЕРВЕР АЛДААТАЙ"; fi
if [ "$running" = "$SHORT" ]; then
  say "$SHORT: ажиллаж байна ($note)"
else
  say "$SHORT: тавьсан боловч /health «${running:-хариугүй}» гэж хариулж байна ($note): runs/$SHORT.log"
fi
if [ "$VERDICT" != success ]; then printf '%s\n' "$TARGET" >"$DEPLOY_STATE/auto-ci-watch"; fi
