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
    claim "$slug" "$@"
    fetch_main
    ensure_merge_driver
    if ! git -C "$MAIN" worktree add -q -b "task/$slug" "$WORK/$slug" "$BASE_REF"; then
      rm -f "$STATE/lanes/$slug"
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
    rm -f "$STATE/lanes/$slug"
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
    printf '%s %04d %s\n' "$kind" "$next" "$slug" >>"$STATE/numbers"
    printf '%04d\n' "$next"
    ;;
  *)
    sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
    exit 64
    ;;
esac
