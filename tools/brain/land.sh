#!/usr/bin/env bash
# The one gate (ADR-0213, tools/brain/README.md): puts finished tasks on main together. Each task
# becomes one commit on top of origin/main, the whole is checked once (pnpm check:fast), pushed, and
# the tasks' copies are cleared. A push to main goes onto the real system by itself (ADR-0204).
# Used by the brain, never by a worker.
#
#   land.sh <slug>…            land these tasks, in this order
#   land.sh --no-push <slug>…  merge and check only; nothing is pushed or cleared
#
# Exit: 0 landed · 3 a task conflicts with main or with a task before it (it is named, nothing is
# pushed) · 4 the check is red (its output is printed, nothing is pushed) · 5 a task is not ready
# (uncommitted files, or nothing committed).
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"

PUSH=yes
if [ "${1:-}" = "--no-push" ]; then
  PUSH=no
  shift
fi
[ "$#" -gt 0 ] || die "land.sh [--no-push] <slug>…"
[ "$BASE_REF" = origin/main ] || PUSH=no
for slug in "$@"; do
  valid_slug "$slug"
  [ -d "$WORK/$slug" ] || DIE_CODE=5 die "No task named $slug."
  dirty=$(git -C "$WORK/$slug" status --porcelain)
  [ -z "$dirty" ] || DIE_CODE=5 die "$slug has uncommitted files; the worker commits before it reports:
$dirty"
done

# One landing at a time: it takes a minute, and the next one builds on its result.
exec 9>"$STATE/land.lock"
flock 9
export PATH="$HOME/.local/opt/node/bin:$PATH"
ensure_merge_driver
ensure_gate

# One commit message for a task: its first commit's, the later ones as a list.
message_of() {
  local base=$1 branch=$2 first rest
  first=$(git -C "$MAIN" rev-list --reverse "$base..$branch" | head -n 1)
  git -C "$MAIN" log -1 --format=%B "$first"
  rest=$(git -C "$MAIN" log --reverse --format='- %s' "$first..$branch")
  [ -z "$rest" ] || printf '\nAlso:\n%s\n' "$rest"
}

for attempt in 1 2 3; do
  fetch_main
  base=$(git -C "$MAIN" rev-parse "$BASE_REF")
  git -C "$GATE" checkout -q -f --detach "$base"
  git -C "$GATE" clean -fdq
  for slug in "$@"; do
    fork=$(git -C "$MAIN" merge-base "$base" "task/$slug")
    [ "$(git -C "$MAIN" rev-list --count "$fork..task/$slug")" -gt 0 ] ||
      DIE_CODE=5 die "$slug has committed nothing."
    before=$(git -C "$GATE" rev-parse HEAD)
    if ! git -C "$GATE" merge -q --squash "task/$slug" >"$STATE/land-merge.log" 2>&1; then
      files=$(git -C "$GATE" diff --name-only --diff-filter=U | tr '\n' ' ')
      git -C "$GATE" reset -q --hard "$before"
      echo "CONFLICT: $slug no longer fits on main. Files: ${files:-see $STATE/land-merge.log}"
      echo "Send it back: in $WORK/$slug run «git fetch origin main && git rebase origin/main», resolve, check, commit."
      exit 3
    fi
    if git -C "$GATE" diff --cached --quiet; then
      echo "$slug: already on main, nothing to add"
      continue
    fi
    message_of "$fork" "task/$slug" | git -C "$GATE" commit -q -F -
  done
  if [ "$(git -C "$GATE" rev-parse HEAD)" = "$base" ]; then
    echo "Nothing to land."
    break
  fi

  echo "== checking $(git -C "$GATE" diff --name-only "$base" HEAD | wc -l) changed file(s) on top of ${base:0:8}"
  if ! (cd "$GATE" && node tools/fast-check/check-fast.mjs --base "$base") >"$STATE/land-check.log" 2>&1; then
    cat "$STATE/land-check.log"
    echo "RED: nothing was pushed. Send the failing part back to its task."
    exit 4
  fi
  tail -n 1 "$STATE/land-check.log"

  if [ "$PUSH" = no ]; then
    echo "Checked, not pushed (--no-push): $GATE holds the result."
    exit 0
  fi
  if git -C "$GATE" push -q origin HEAD:main 2>"$STATE/land-push.log"; then
    head=$(git -C "$GATE" rev-parse HEAD)
    changed=$(git -C "$GATE" diff --name-only "$base" "$head")
    echo "LANDED ${head:0:8} on main ($(printf '%s\n' "$changed" | wc -l) file(s)): $*"
    printf '%s %s %s\n' "$(date '+%F %T')" "${head:0:8}" "$*" >>"$STATE/log"
    # The code graph follows main in the background; it never delays or fails a landing (and does
    # not keep the landing's lock, fd 9).
    nohup bash "$BRAIN_DIR/graph.sh" update --if-idle &>/dev/null 9>&- &
    echo "The code graph is being rebuilt in the background (about three minutes; graph.sh status)."
    # The shared checkout follows when nothing of its own stands in the way; else it stays as it is.
    if [ "$(git -C "$MAIN" branch --show-current)" = main ] &&
      git -C "$MAIN" merge -q --ff-only origin/main 2>/dev/null; then
      echo "~/bto-dev follows (the development server shows it)."
    else
      echo "~/bto-dev was not moved (its own commits or files are in the way); the real system gets it all the same."
    fi
    if printf '%s\n' "$changed" | grep -q '^apps/api/src/db/migrations/.*\.sql$'; then
      echo "MIGRATION landed: run «pnpm db:migrate» in ~/bto-dev for the development database."
    fi
    # The real system's own rule decides (ADR-0215): the two can never disagree.
    mapfile -t files < <(printf '%s\n' "$changed")
    plan=$(
      # shellcheck source=deploy/store/auto-deploy.sh
      . "$GATE/deploy/store/auto-deploy.sh" --source-only
      plan_update pending "${files[@]}"
    )
    case "$plan" in
      deploy) echo "On the real system in about five minutes (a whole update)." ;;
      web) echo "On the real system in about a minute (pages only)." ;;
      *) echo "Nothing is rebuilt (documents, tests, tools or the staff app's sources only)." ;;
    esac
    for slug in "$@"; do
      git -C "$MAIN" worktree remove --force "$WORK/$slug"
      git -C "$MAIN" branch -q -D "task/$slug" 2>/dev/null || true
      rm -f "$STATE/lanes/$slug"
      [ ! -f "$STATE/numbers" ] || sed -i "/ $slug\$/d" "$STATE/numbers"
    done
    # The job desk (ADR-0229): these tasks no longer hold a job, so one that waited for them may
    # start now. In the background; it never delays or fails a landing.
    nohup bash "$BRAIN_DIR/job.sh" tick &>/dev/null 9>&- &
    kinds=$(bash "$BRAIN_DIR/job.sh" kinds-of "${files[@]}" 2>/dev/null | tr '\n' ' ' || true)
    if [ -n "$kinds" ]; then
      echo "JOBS: this changes ${kinds% }. Ask for each: bash $BRAIN_DIR/job.sh request <kind> [--publish] (one build for every change that waits)."
    fi
    exit 0
  fi
  echo "main moved while landing (try $attempt); starting again on the new main"
done
[ "$(git -C "$GATE" rev-parse HEAD)" = "$base" ] && exit 0
cat "$STATE/land-push.log" >&2
die "Could not push after three tries."
