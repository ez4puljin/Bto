#!/usr/bin/env bash
# The watchman's memory (deploy/store/watch.sh, ADR-0195) tried without Docker, a network or a
# clock: what is said when a problem starts, lasts, ends, and when a message cannot be sent.
#   bash deploy/store/watch.test.sh
set -uo pipefail
export BTO_WATCH_STATE
BTO_WATCH_STATE=$(mktemp -d)
trap 'rm -rf -- "${BTO_WATCH_STATE:?}"' EXIT
# shellcheck source=deploy/store/watch.sh
. "$(dirname "$0")/watch.sh"

SENT="$BTO_WATCH_STATE/sent.txt"
CLOCK=1000000
ONLINE=1
now() { echo "$CLOCK"; }
# One line per message, whatever its own lines.
send() { [ "$ONLINE" = 1 ] || return 1; printf '%s\n' "${1//$'\n'/ | }" >>"$SENT"; }
# One round at the given minute with the given problems ("key need text" each).
round() {
  CLOCK=$((1000000 + $1 * 60))
  shift
  FOUND_TEXT=() FOUND_NEED=()
  local item
  for item in "$@"; do found "${item%% *}" "$(echo "$item" | cut -d' ' -f2)" "$(echo "$item" | cut -d' ' -f3-)"; done
  settle
}
sent() { [ -f "$SENT" ] && wc -l <"$SENT" | tr -d ' ' || echo 0; }
last() { tail -n 1 "$SENT" 2>/dev/null; }
FAILS=0
expect() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected «$3», got «$2»"; FAILS=$((FAILS + 1)); fi
}
contains() {
  case "$2" in *"$3"*) echo "ok   $1" ;; *) echo "FAIL $1: «$2» lacks «$3»"; FAILS=$((FAILS + 1)) ;; esac
}

round 0 "health 2 🔴 Систем хариу өгөхгүй байна."
expect "a problem that needs two rounds is not said at the first" "$(sent)" 0
round 1 "health 2 🔴 Систем хариу өгөхгүй байна."
expect "it is said at the second" "$(sent)" 1
contains "with its words" "$(last)" "Систем хариу өгөхгүй байна."
round 2 "health 2 🔴 Систем хариу өгөхгүй байна."
round 60 "health 2 🔴 Систем хариу өгөхгүй байна."
expect "it is not repeated every round" "$(sent)" 1
round 361 "health 2 🔴 Систем хариу өгөхгүй байна."
expect "it is said again after the reminder hours" "$(sent)" 2
contains "with how long it has lasted" "$(last)" "6 цаг 1 минут"
round 365
expect "its end is said once" "$(sent)" 3
contains "as mended, without the first sign" "$(last)" "🟢 Зассан (6 цаг 5 минут үргэлжилсэн): Систем хариу өгөхгүй байна."
round 366
expect "and nothing more" "$(sent)" 3

round 400 "containers 2 🔴 Системийн хэсэг ажиллахгүй байна: api"
round 401
expect "a blip that never reached the owner ends silently" "$(sent)" 3
expect "and is forgotten" "$(ls "$BTO_WATCH_STATE" | grep -c '^problem\.')" 0

ONLINE=0
round 500 "disk 1 🟠 Диск дүүрч байна."
expect "a message that cannot be sent is not counted as said" "$(sent)" 3
ONLINE=1
round 501 "disk 1 🟠 Диск дүүрч байна."
expect "it goes out when the network is back" "$(sent)" 4
ONLINE=0
round 502
expect "an end that cannot be said is kept" "$(ls "$BTO_WATCH_STATE" | grep -c '^problem\.')" 1
ONLINE=1
round 503
expect "and said at the next round" "$(sent)" 5
contains "as mended" "$(last)" "🟢 Зассан"

round 600 "backup 1 🟠 Нөөцлөлт хийгдээгүй." "reports 1 🟡 Тайлан татгалзсан."
expect "two problems are two messages" "$(sent)" 7

expect "a span under an hour" "$(span 1500)" "25 минут"
expect "a span of whole hours" "$(span 7200)" "2 цаг"
expect "a short span" "$(span 20)" "1 минут хүрэхгүй"

# The PC started again: said once, with how long nothing was watching.
: >"$SENT"
CLOCK=2000000
echo old-boot >"$BTO_WATCH_STATE/boot"
echo $((CLOCK - 6840)) >"$BTO_WATCH_STATE/last-round"
greet_boot
expect "a new start is said" "$(sent)" 1
contains "with the time away" "$(last)" "1 цаг 54 минут орчим унтарсан"
greet_boot
expect "once" "$(sent)" 1

echo
if [ "$FAILS" -gt 0 ]; then echo "$FAILS failed"; exit 1; fi
echo "all passed"
