# shellcheck shell=bash
# Shared by task.sh and land.sh (tools/brain/README.md).
#
#   MAIN    the main checkout (~/bto-dev): where the repository's .git directory is
#   WORK    where the tasks' own copies live (~/bto-work/<slug>), and the gate (~/bto-work/_gate)
#   STATE   the brain's small books: who holds which paths, the numbers handed out, the log

BRAIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN="$(dirname "$(git -C "$BRAIN_DIR" rev-parse --path-format=absolute --git-common-dir)")"
WORK="${BTO_WORK:-$HOME/bto-work}"
STATE="$WORK/.brain"
GATE="$WORK/_gate"
# What tasks start from and land on. Only a trial of these tools sets another one; land.sh then never pushes.
BASE_REF="${BTO_BASE_REF:-origin/main}"
mkdir -p "$STATE/lanes"

die() {
  echo "$*" >&2
  exit "${DIE_CODE:-1}"
}

valid_slug() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] || die "A task's name is lower-case letters, digits and dashes: $1"
}

fetch_main() {
  timeout 60 git -C "$MAIN" fetch -q origin main || echo "warning: could not fetch origin/main; using what is here" >&2
}

# Two tasks that add translation keys never conflict (merge-json.mjs); the setting lives in the
# repository's config, which every worktree shares.
ensure_merge_driver() {
  git -C "$MAIN" config merge.bto-json.name "three-way merge of mn.json by key"
  git -C "$MAIN" config merge.bto-json.driver "node tools/brain/merge-json.mjs %O %A %B"
}

# What MAIN's node_modules is now: a copy linked from an older install is linked again.
modules_stamp() {
  stat -c '%Y' "$MAIN/node_modules/.modules.yaml" 2>/dev/null || echo none
}

# Gives a copy MAIN's node_modules without a download and without disk: hard links (three seconds).
# Vite's cache is left out (it is rewritten in place), and pnpm gets its own state file so that
# `pnpm run …` works in the copy.
link_modules() {
  local dir=$1 rel
  if [ -f "$dir/node_modules/.brain-stamp" ] && [ "$(cat "$dir/node_modules/.brain-stamp")" = "$(modules_stamp)" ]; then
    return 0
  fi
  while IFS= read -r rel; do
    rm -rf "${dir:?}/$rel"
    mkdir -p "$(dirname "$dir/$rel")"
    cp -al "$MAIN/$rel" "$dir/$rel"
    rm -rf "$dir/$rel/.vite"
  done < <(cd "$MAIN" && find . -maxdepth 3 -name node_modules -type d -not -path './node_modules/*' | sed 's|^\./||')
  local state="$dir/node_modules/.pnpm-workspace-state-v1.json"
  if [ -f "$state" ]; then
    python3 - "$state" "$MAIN" "$dir" <<'PY'
import json, os, sys, time
path, main, copy = sys.argv[1:4]
text = open(path).read().replace(main, copy)
data = json.loads(text)
data["lastValidatedTimestamp"] = int(time.time() * 1000)
os.remove(path)  # a hard link: never write through it
json.dump(data, open(path, "w"), indent=2)
PY
  fi
  mkdir -p "$dir/node_modules"
  modules_stamp >"$dir/node_modules/.brain-stamp"
}

# The compilers' memory and the packages' dist from the gate, which stands at origin/main: the first
# check in a new copy then takes seconds, not minutes.
seed_cache() {
  local dir=$1 pkg
  [ -d "$GATE/.fastcheck" ] && [ ! -d "$dir/.fastcheck" ] && cp -a "$GATE/.fastcheck" "$dir/.fastcheck"
  for pkg in "$GATE"/packages/*/dist; do
    [ -d "$pkg" ] || continue
    local target="$dir/packages/$(basename "$(dirname "$pkg")")/dist"
    [ -d "$target" ] || cp -a "$pkg" "$target"
  done
  return 0
}

# The development settings a copy needs to run the api's suites (gitignored, so git does not bring them).
copy_env() {
  local dir=$1
  [ ! -f "$MAIN/apps/api/.env" ] || [ -f "$dir/apps/api/.env" ] || cp -p "$MAIN/apps/api/.env" "$dir/apps/api/.env"
}

ensure_gate() {
  if [ ! -d "$GATE" ]; then
    git -C "$MAIN" worktree add -q --detach "$GATE" "$BASE_REF"
  fi
  link_modules "$GATE"
}

# The team board (board.mjs, ADR-0248): this PC speaks there as «brain». Off in a trial of these
# tools (another BASE_REF), with BTO_BOARD=off, and where board.mjs is not beside this file.
BOARD_STATE="$STATE/board"
board_on() {
  [ "${BTO_BOARD:-on}" != off ] && [ "$BASE_REF" = origin/main ] && [ -f "$BRAIN_DIR/board.mjs" ]
}
# board <command> …: exit as board.mjs (2 refused, 3 the board cannot be reached). The fixed options
# come first, so that a caller can end its own with «--» before paths or text it does not control.
# BOARD_TIMEOUT (seconds a git call may take) is short where a lock is held (land.sh, the gate).
board() {
  PATH="$HOME/.local/opt/node/bin:$PATH" node "$BRAIN_DIR/board.mjs" --as brain --state "$BOARD_STATE" \
    --timeout "${BOARD_TIMEOUT:-${BTO_BOARD_TIMEOUT:-20}}" "$@"
}
# True when the board could not be reached less than a minute ago: the gate then leaves it alone.
board_down() {
  [ -n "$(find "$BOARD_STATE/unreachable" -mmin -1 2>/dev/null)" ]
}
# Once: the numbers this PC handed out before the board existed (codex-big was reserved by hand for
# the second developer). Quiet when the board cannot be reached; the next call tries again.
board_import() {
  [ ! -f "$BOARD_STATE/imported" ] || return 0
  [ -f "$STATE/numbers" ] || { mkdir -p "$BOARD_STATE" && touch "$BOARD_STATE/imported"; return 0; }
  if board import "$STATE/numbers" --map codex-big=codex >/dev/null 2>&1; then
    touch "$BOARD_STATE/imported"
  fi
  return 0
}
