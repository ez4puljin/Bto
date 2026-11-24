#!/usr/bin/env bash
# A task's own copy of the code, and the books that keep two tasks off the same file (ADR-0213,
# tools/brain/README.md). Used by the brain, never by a worker.
#
#   task.sh new <slug> <path>…     a copy at ~/bto-work/<slug> on branch task/<slug>, from origin/main;
#                                  <path>… is what the task may change (files or folders). Refused
#                                  (exit 2) when another task holds one of them.
#   task.sh claim <slug> <path>…   more paths for a running task (same refusal)
#   task.sh list                   the running tasks, what they hold, how far they are
#   task.sh drop <slug>            throw a task away: its copy, its branch, its claims
#   task.sh number adr|migration <slug>
#                                  the next free ADR or migration number, never handed out twice
#
# The team board (board.mjs, ADR-0248): new/claim also refuse (exit 2) a path another developer's AI
# holds there and publish the task's paths as «brain»'s claim; drop releases it; number takes the
# number from the board's one sequence. A board that cannot be reached never blocks: a warning, and
# the books here decide (a number then comes from these books alone, with a loud warning).
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"

# Every task may touch these: git merges them by key (mn.json) or the brain writes them itself.
SHARED_PATHS=("packages/shared/i18n/mn.json")

clean_path() {
  local path=${1#./}
  path=${path%/}
  case "$path" in
    /* | *..*) die "A path is inside the repository: $1" ;;
  esac
  printf '%s\n' "$path"
}

# Prints «<path> is held by <slug>» for every clash of the given paths with another task's.
clashes() {
  local slug=$1 path other held
  shift
  for path in "$@"; do
    for other in "$STATE"/lanes/*; do
      [ -f "$other" ] || continue
      [ "$(basename "$other")" != "$slug" ] || continue
      while IFS= read -r held; do
        [ -n "$held" ] || continue
        if [ "$path" = "$held" ] || [[ "$path" == "$held"/* ]] || [[ "$held" == "$path"/* ]]; then
          echo "$path is held by $(basename "$other") ($held)"
        fi
      done <"$other"
    done
  done
}

claim() {
  local slug=$1 path shared found
  shift
  local paths=()
  for path in "$@"; do
    path=$(clean_path "$path")
    shared=no
    for found in "${SHARED_PATHS[@]}"; do [ "$path" = "$found" ] && shared=yes; done
    [ "$shared" = yes ] || paths+=("$path")
  done
  [ "${#paths[@]}" -gt 0 ] || return 0
  found=$(clashes "$slug" "${paths[@]}")
  if [ -n "$found" ]; then
    echo "$found" >&2
    DIE_CODE=2 die "Refused: give these to the task that holds them, or wait for it to land."
  fi
  # The gate's own in-* tasks are the other developer's work, held on the board by its own side.
  if [ "${BTO_TASK_OWNER:-}" != inbox ] && board_on; then
    board_import
    local out code
    set +e
    out=$(board claim "$slug" --what "brain task $slug" -- "${paths[@]}" 2>&1)
    code=$?
    set -e
    case "$code" in
      0) ;;
      2)
        printf '%s\n' "$out" | grep ' is held by ' >&2 || printf '%s\n' "$out" >&2
        DIE_CODE=2 die "Refused: the other developer holds these on the team board (board.mjs status); wait for it to land, or ask: node tools/brain/board.mjs say <who> \"…\"."
        ;;
      *) echo "warning: the team board was not reached; $slug's paths are not published there ($(printf '%s' "$out" | tail -n 1))" >&2 ;;
    esac
  fi
  printf '%s\n' "${paths[@]}" >>"$STATE/lanes/$slug"
  sort -u -o "$STATE/lanes/$slug" "$STATE/lanes/$slug"
}

cmd=${1:-}
shift || true
exec 8>"$STATE/books.lock"
flock 8

case "$cmd" in
  new)
    slug=${1:-}
    shift || true
    valid_slug "$slug"
    [ "$#" -gt 0 ] || die "Say what the task may change: task.sh new $slug <path>…"
    [ ! -e "$WORK/$slug" ] || die "A task named $slug is already running ($WORK/$slug)."
    # The in-* names are the inbox gate's (ADR-0242): only it opens one, and the books say so
    # (owners/<slug>), so that it never drops a copy it did not make.
    case "$slug" in
      in-*) [ "${BTO_TASK_OWNER:-}" = inbox ] || die "The task names in-* are the inbox gate's (inbox.sh); choose another name." ;;
    esac
    claim "$slug" "$@"
    if [ -n "${BTO_TASK_OWNER:-}" ]; then
      mkdir -p "$STATE/owners"
      printf '%s\n' "$BTO_TASK_OWNER" >"$STATE/owners/$slug"
    fi
    fetch_main
    ensure_merge_driver
    if ! git -C "$MAIN" worktree add -q -b "task/$slug" "$WORK/$slug" "$BASE_REF"; then
      [ "${BTO_TASK_OWNER:-}" = inbox ] || ! board_on || board release "$slug" >/dev/null 2>&1 || true
      rm -f "$STATE/lanes/$slug" "$STATE/owners/$slug"
      die "Could not make the copy for $slug."
    fi
    link_modules "$WORK/$slug"
    seed_cache "$WORK/$slug"
    copy_env "$WORK/$slug"
    echo "copy:   $WORK/$slug"
    echo "branch: task/$slug (from $BASE_REF $(git -C "$MAIN" rev-parse --short "$BASE_REF"))"
    echo "holds:  $(tr '\n' ' ' <"$STATE/lanes/$slug")"
    ;;
  claim)
    slug=${1:-}
    shift || true
    valid_slug "$slug"
    [ -d "$WORK/$slug" ] || die "No task named $slug."
    claim "$slug" "$@"
    echo "holds:  $(tr '\n' ' ' <"$STATE/lanes/$slug")"
    ;;
  list)
    any=no
    for lane in "$STATE"/lanes/*; do
      [ -f "$lane" ] || continue
      any=yes
      slug=$(basename "$lane")
      if [ -d "$WORK/$slug" ]; then
        ahead=$(git -C "$MAIN" rev-list --count "$BASE_REF..task/$slug" 2>/dev/null || echo "?")
        dirty=$(git -C "$WORK/$slug" status --porcelain | wc -l)
        echo "$slug: $ahead commit(s), $dirty uncommitted file(s); holds $(tr '\n' ' ' <"$lane")"
      else
        echo "$slug: its copy is gone; holds $(tr '\n' ' ' <"$lane") (task.sh drop $slug)"
      fi
    done
    [ "$any" = yes ] || echo "No task is running."
    ;;
  drop)
    slug=${1:-}
    valid_slug "$slug"
    [ ! -d "$WORK/$slug" ] || git -C "$MAIN" worktree remove --force "$WORK/$slug"
    git -C "$MAIN" branch -q -D "task/$slug" 2>/dev/null || true
    if [ "$(cat "$STATE/owners/$slug" 2>/dev/null)" != inbox ] && board_on; then
      board release "$slug" >/dev/null 2>&1 ||
        echo "warning: the team board was not reached; release it later: node tools/brain/board.mjs release $slug --as brain" >&2
    fi
    # A number this task took and never used stays on the board; board.mjs status leaves it out of
    # «not yet on main» once the books say the task was dropped (ADR-0249).
    if [ -f "$STATE/numbers" ] && grep -q " $slug\$" "$STATE/numbers"; then
      mkdir -p "$BOARD_STATE"
      grep -qx "$slug" "$BOARD_STATE/dropped" 2>/dev/null || echo "$slug" >>"$BOARD_STATE/dropped"
    fi
    rm -f "$STATE/lanes/$slug" "$STATE/owners/$slug"
    [ ! -f "$STATE/numbers" ] || sed -i "/ $slug\$/d" "$STATE/numbers"
    echo "dropped $slug"
    ;;
  number)
    kind=${1:-}
    slug=${2:-}
    valid_slug "$slug"
    case "$kind" in
      adr) dir=docs/decisions pattern='ADR-([0-9]{4})-.*\.md' ;;
      migration) dir=apps/api/src/db/migrations pattern='([0-9]{4})_.*\.sql' ;;
      *) die "task.sh number adr|migration <slug>" ;;
    esac
    fetch_main
    touch "$STATE/numbers"
    # Taken: on origin/main, in the main checkout and every task's copy (uncommitted files too), and
    # the numbers already handed out here.
    last=$(
      {
        git -C "$MAIN" ls-tree --name-only origin/main "$dir/"
        for copy in "$MAIN" "$WORK"/*/; do ls "$copy/$dir" 2>/dev/null || true; done
      } | sed -E 's|.*/||' | sed -nE "s/^$pattern\$/\1/p" | sort -n | tail -n 1
    )
    held=$(awk -v kind="$kind" '$1 == kind { print $2 }' "$STATE/numbers" | sort -n | tail -n 1)
    next=$((10#${last:-0} + 1))
    [ -z "$held" ] || [ "$((10#$held + 1))" -le "$next" ] || next=$((10#$held + 1))
    # One sequence with the other developer: the board hands it out, at least what these books say.
    if board_on; then
      board_import
      set +e
      out=$(board number "$kind" "$slug" --floor "$next" 2>"$STATE/board-number.err")
      code=$?
      set -e
      if [ "$code" -eq 0 ] && [[ "$out" =~ ^[0-9]{4}$ ]]; then
        next=$((10#$out))
      else
        {
          echo "WARNING: the team board could not hand out this number ($(tail -n 1 "$STATE/board-number.err"))."
          echo "WARNING: $kind $(printf '%04d' "$next") comes from this PC's books alone; the other developer may take it too."
          echo "WARNING: once the board is back, tell them: node tools/brain/board.mjs say codex \"$kind $(printf '%04d' "$next") is $slug's\"."
        } >&2
      fi
    fi
    printf '%s %04d %s\n' "$kind" "$next" "$slug" >>"$STATE/numbers"
    # A slug taken again is no longer a dropped task.
    [ ! -f "$BOARD_STATE/dropped" ] || sed -i "/^$slug\$/d" "$BOARD_STATE/dropped"
    printf '%04d\n' "$next"
    ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 64
    ;;
esac
