#!/usr/bin/env bash
# A code graph of origin/main for the brain and its workers (tools/brain/README.md): who calls a
# function, what a change reaches, how two symbols connect, in a few hundred tokens instead of a grep
# and a read. Built locally by Graphify (github.com/Graphify-Labs/graphify, Apache-2.0) from the
# code alone: tree-sitter, no LLM, nothing leaves the PC.
#
#   graph.sh update [--if-idle] [--force]
#                                  snapshot origin/main and rebuild the graph (about three minutes);
#                                  --if-idle exits 0 at once when an update is already running,
#                                  --force lets the graph shrink past graphify's guard
#   graph.sh explain "<symbol>"    the symbol, its file:line, its callers and callees
#   graph.sh affected "<symbol>"   what depends on it (reverse impact), with file:line
#   graph.sh path "<A>" "<B>"      how two symbols connect
#   graph.sh status                the graph's commit, age, how far behind origin/main, size
#
# explain, affected and path exit as graphify does: 0 an answer, 3 an ambiguous name (the candidates
# are printed: retry with one of them), 4 no such node. There is no `query`: its free-text answers are
# noisy (fixtures and test data first).
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"

export PATH="$HOME/.local/bin:$PATH"
# Never an LLM backend (nothing is sent anywhere), never a log of the questions.
export GRAPHIFY_BACKEND=none GRAPHIFY_QUERY_LOG_DISABLE=1 GRAPHIFY_NO_TIPS=1

DIR="$STATE/graph"
SRC="$DIR/src"
GRAPH="$SRC/graphify-out/graph.json"
mkdir -p "$DIR"

usage() {
  die "graph.sh update [--if-idle] [--force] | explain <symbol> | affected <symbol> | path <A> <B> | status"
}

need_graphify() {
  command -v graphify >/dev/null || die "graphify is not installed: uv tool install graphifyy"
}

built() {
  cat "$DIR/commit" 2>/dev/null || true
}

behind() {
  git -C "$MAIN" rev-list --count "$1..origin/main" 2>/dev/null || echo "?"
}

update() {
  local idle=no force=()
  for arg in "$@"; do
    case "$arg" in
      --if-idle) idle=yes ;;
      --force) force=(--force) ;;
      *) usage ;;
    esac
  done
  need_graphify
  exec 9>"$DIR/lock"
  if [ "$idle" = yes ]; then
    flock -n 9 || exit 0
  else
    flock 9
  fi

  fetch_main 2>/dev/null
  local head
  head=$(git -C "$MAIN" rev-parse origin/main)
  if [ -f "$GRAPH" ] && [ "$(built)" = "$head" ]; then
    echo "graph: already at ${head:0:8}"
    return 0
  fi

  # The snapshot is rsynced without its times: an unchanged file keeps its mtime, so graphify's
  # cache knows it; graphify-out is never deleted by the sync.
  SNAP=$(mktemp -d "$DIR/snap.XXXXXX")
  trap 'rm -rf "$SNAP"' EXIT
  git -C "$MAIN" archive "$head" | tar -x -C "$SNAP"
  mkdir -p "$SRC"
  rsync -rlpD --checksum --delete --exclude=/graphify-out/ "$SNAP/" "$SRC/"
  rm -rf "$SNAP"

  local started=$SECONDS
  echo "graph: building ${head:0:8} (about three minutes; log $DIR/update.log)"
  {
    echo "== $(date '+%F %T') ${head:0:8}"
    if (cd "$SRC" && nice -n 10 graphify update . "${force[@]}"); then
      echo "== ok in $((SECONDS - started)) s"
    else
      echo "== FAILED in $((SECONDS - started)) s"
      false
    fi
  } >>"$DIR/update.log" 2>&1 || die "graph: the build of ${head:0:8} failed; see $DIR/update.log (a refused shrink: graph.sh update --force)"
  echo "$head" >"$DIR/commit"
  echo "graph: ${head:0:8} in $((SECONDS - started)) s"
}

ask() {
  local cmd=$1
  shift
  [ "$#" -gt 0 ] || usage
  need_graphify
  [ -f "$GRAPH" ] || die "No graph yet: run «bash ~/bto-dev/tools/brain/graph.sh update» once (about three minutes)."
  local commit head
  commit=$(built)
  head=$(git -C "$MAIN" rev-parse origin/main 2>/dev/null || true)
  if [ -n "$commit" ] && [ "$commit" != "$head" ]; then
    echo "graph of ${commit:0:8} ($(behind "$commit") commits behind origin/main): the newest code may be missing; read the current file." >&2
  fi
  exec graphify "$cmd" "$@" --graph "$GRAPH"
}

status() {
  local commit
  commit=$(built)
  if [ -z "$commit" ] || [ ! -f "$GRAPH" ]; then
    echo "graph: none yet (bash ~/bto-dev/tools/brain/graph.sh update)"
    return 0
  fi
  local age=$(($(date +%s) - $(stat -c %Y "$DIR/commit")))
  echo "commit:  ${commit:0:8} $(git -C "$MAIN" log -1 --format=%s "$commit" 2>/dev/null || true)"
  echo "built:   $(date -d "@$(stat -c %Y "$DIR/commit")" '+%F %T') ($((age / 60)) min ago)"
  echo "behind:  $(behind "$commit") commit(s) behind origin/main"
  echo "size:    $(du -sh "$SRC/graphify-out" | cut -f1) ($(du -h "$GRAPH" | cut -f1) graph.json)"
  if flock -n "$DIR/lock" true 2>/dev/null; then
    echo "update:  idle; last: $(grep '^== ' "$DIR/update.log" 2>/dev/null | tail -n 1 || true)"
  else
    echo "update:  running now (log $DIR/update.log)"
  fi
}

case "${1:-}" in
  update) shift && update "$@" ;;
  explain | affected | path) ask "$@" ;;
  status) status ;;
  *) usage ;;
esac
