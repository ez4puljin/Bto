#!/usr/bin/env bash
# The api's integration suites from a task's copy, one run at a time on this PC: the suites of two
# copies would use the same test databases (their names come from one prefix).
#   bash tools/brain/int.sh <pattern>…     e.g.  bash tools/brain/int.sh receipts vouchers
#   bash tools/brain/int.sh --integrity [<pattern>…]  the integrity suite (--runInBand), or the suites
#                                                   whose path matches a pattern
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="$HOME/.local/opt/node/bin:$PATH"
mkdir -p "${BTO_WORK:-$HOME/bto-work}/.brain"
exec 9>"${BTO_WORK:-$HOME/bto-work}/.brain/int.lock"
flock 9
if [ "${1:-}" = "--integrity" ]; then
  shift
  # With patterns: only the integrity suites whose path matches one of them (ADR-0253).
  if [ "$#" -gt 0 ]; then exec nice -n 10 pnpm --filter @tugeel/api run test:integrity -- "$@"; fi
  exec nice -n 10 pnpm --filter @tugeel/api run test:integrity
fi
exec nice -n 10 pnpm --filter @tugeel/api run test:integration -- "$@"
