#!/usr/bin/env bash
# The watchman of the store's Ubuntu PC (ADR-0195): once a minute it looks at the centre and the
# till server from outside their processes and tells the owner's phone when something is wrong,
# once when it starts, again every STORE_ALERT_REMIND_HOURS while it lasts, and once when it is
# over. It also says that the PC has started again and for how long it was away.
#
#   bash deploy/store/watch.sh            one round (the bto-watch timer runs exactly this)
#   bash deploy/store/watch.sh --check    what it sees now; sends nothing, remembers nothing
#   bash deploy/store/watch.sh --test     sends one test message
#
# Messages go to the owner's Telegram chat through the owner's own bot (alerts-setup.sh asks for
# its token on the PC; it is kept in deploy/store/.env and never printed). They carry the state of
# the machine only, never business data. Without a token a round only looks and stays silent.
#
# What it cannot see is the PC being off: for that, STORE_ALERT_HEARTBEAT_URL is called after
# every round, and the service behind it (a "dead man's switch") speaks when the calls stop.
set -uo pipefail
# shellcheck source=deploy/store/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STATE_DIR=${BTO_WATCH_STATE:-$(store_setting STORE_WATCH_STATE_DIR "${XDG_STATE_HOME:-$HOME/.local/state}/bto-watch")}
ALERT_TOKEN=$(store_setting STORE_ALERT_TELEGRAM_TOKEN "")
ALERT_CHAT=$(store_setting STORE_ALERT_TELEGRAM_CHAT "")
ALERT_NAME=$(store_setting STORE_ALERT_NAME "Bto")
HEARTBEAT_URL=$(store_setting STORE_ALERT_HEARTBEAT_URL "")
REMIND_HOURS=$(store_setting STORE_ALERT_REMIND_HOURS 6)
DISK_PERCENT=$(store_setting STORE_ALERT_DISK_PERCENT 85)
BACKUP_HOURS=$(store_setting STORE_ALERT_BACKUP_HOURS 26)
ERROR_COUNT=$(store_setting STORE_ALERT_ERROR_COUNT 10)
LOG_WINDOW_SECONDS=600
# Newest lines read from each process's log; a busier minute than this is a bigger worry than
# the count being exact.
LOG_TAIL=2000
# What is read instead when the long read stops at a hole (see log_recent).
LOG_TAIL_SHORT=200
case "$REMIND_HOURS$DISK_PERCENT$BACKUP_HOURS$ERROR_COUNT" in
  *[!0-9]* | "") echo "the STORE_ALERT_* numbers must be whole numbers" >&2; exit 64 ;;
esac

# What this round found: a short key, the words for the phone, and how many rounds in a row it
# must be seen before the first message (a restart of a minute is not news).
declare -A FOUND_TEXT=() FOUND_NEED=()
found() { FOUND_TEXT[$1]=$3; FOUND_NEED[$1]=$2; }

now() { date +%s; }

# One message to the owner's chat. The token goes to curl on its standard input, so it is on no
# command line. 0 only when Telegram took the message.
send() {
  [ -n "$ALERT_TOKEN" ] && [ -n "$ALERT_CHAT" ] || return 1
  local status
  status=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' --config - \
    --data-urlencode "chat_id=$ALERT_CHAT" --data-urlencode "text=[$ALERT_NAME] $1" 2>/dev/null <<EOF
url = "https://api.telegram.org/bot${ALERT_TOKEN}/sendMessage"
EOF
  ) || return 1
  [ "$status" = "200" ]
}

# «3 цаг 20 минут» for a number of seconds.
span() {
  local minutes=$(($1 / 60))
  if [ "$minutes" -lt 1 ]; then echo "1 минут хүрэхгүй"
  elif [ "$minutes" -lt 60 ]; then echo "$minutes минут"
  elif [ $((minutes % 60)) -eq 0 ]; then echo "$((minutes / 60)) цаг"
  else echo "$((minutes / 60)) цаг $((minutes % 60)) минут"; fi
}

# ---------------------------------------------------------------- what is looked at

check_health() {
  local port body
  port=$(store_setting STORE_HTTP_PORT 80)
  body=$(curl -s -m 8 -H 'Accept: application/json' "http://127.0.0.1:${port}/health" 2>/dev/null || true)
  case "$body" in
    *'"status":"ok"'*) ;;
    *) found health 2 "🔴 Систем хариу өгөхгүй байна (оффисын вэб, апп ажиллахгүй)." ;;
  esac
}

# Running containers of a compose project's service that are not unhealthy.
running_of() {
  printf '%s\n' "$CONTAINERS" | awk -F'|' -v p="$1" -v s="$2" \
    '$1 == p && $2 == s && $3 == "running" && $4 !~ /unhealthy/ { n++ } END { print n + 0 }'
}

check_containers() {
  local missing="" service want have
  if ! CONTAINERS=$(docker ps -a --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Status}}' 2>/dev/null); then
    found docker 2 "🔴 Docker ажиллахгүй байна: системийн аль ч хэсэг асахгүй."
    return
  fi
  for service in postgres api worker web; do
    [ "$(running_of bto-store "$service")" -ge 1 ] || missing="$missing $service"
  done
  for service in api-apps:STORE_APPS_REPLICAS api-reports:STORE_REPORTS_REPLICAS; do
    want=$(store_setting "${service#*:}" 0)
    have=$(running_of bto-store "${service%%:*}")
    case "$want" in *[!0-9]* | "") want=0 ;; esac
    [ "$have" -ge "$want" ] || missing="$missing ${service%%:*}($have/$want)"
  done
  if printf '%s\n' "$CONTAINERS" | grep -q '^bto-edge|'; then
    for service in edge-db edge kiosk; do
      [ "$(running_of bto-edge "$service")" -ge 1 ] || missing="$missing касс:$service"
    done
  fi
  [ -z "$missing" ] || found containers 2 "🔴 Системийн хэсэг ажиллахгүй байна:$missing"
}

check_disk() {
  local path percent free seen=" " device
  for path in / "$(store_setting BACKUP_DIR /var/backups/bto)"; do
    [ -d "$path" ] || continue
    device=$(df -P "$path" 2>/dev/null | awk 'NR == 2 { print $1 }')
    case "$seen" in *" $device "*) continue ;; esac
    seen="$seen$device "
    percent=$(df -P "$path" | awk 'NR == 2 { gsub("%", "", $5); print $5 }')
    free=$(df -BG --output=avail "$path" | tail -n 1 | tr -dc '0-9')
    if [ "${percent:-0}" -ge "$DISK_PERCENT" ]; then
      found "disk$(printf '%s' "$device" | tr -c 'A-Za-z0-9' '_')" 1 \
        "🟠 Диск дүүрч байна: $path ${percent}% (${free} GB үлдсэн)."
    fi
  done
}

check_memory() {
  local total available
  total=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo 2>/dev/null)
  available=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo 2>/dev/null)
  [ -n "$total" ] && [ -n "$available" ] || return 0
  if [ $((available * 100 / total)) -lt 5 ]; then
    found memory 3 "🟠 Санах ой дуусаж байна: $((available / 1024)) MB үлдсэн."
  fi
}

check_backup() {
  local dir status first age
  dir=$(store_setting BACKUP_DIR /var/backups/bto)
  status="$dir/last-run.txt"
  if [ ! -r "$status" ]; then
    found backup 1 "🟠 Нөөцлөлтийн бүртгэл олдсонгүй ($status): нөөцлөлт ажиллаж байгаа эсэхийг шалгана уу."
    return
  fi
  first=$(head -n 1 "$status")
  age=$((($(now) - $(stat -c %Y "$status")) / 3600))
  case "$first" in
    FAILED*) found backup 1 "🔴 Шөнийн нөөцлөлт бүтэлгүйтсэн: $first" ;;
    *)
      if [ "$age" -ge "$BACKUP_HOURS" ]; then
        found backup 1 "🟠 Нөөцлөлт $age цаг хийгдээгүй байна (сүүлийнх: $first)."
      fi
      ;;
  esac
}

# The `"time"` (milliseconds) of the last timestamped line of a read, or 0.
newest_time() {
  printf '%s\n' "$1" | grep -oE '"time":[0-9]+' | tail -n 1 | cut -d: -f2 | grep -E '^[0-9]+$' || echo 0
}

# The end of a container's log, and whether it had to be read short to get there.
#
# The lines are taken from the END (`--tail`), not from a window (`--since`): a power cut leaves a
# hole of unwritten bytes in the log file, and Docker's reader, which parses from the start, stops
# at it. On 2026-11-13 `--since` answered «nothing» for two containers that were serving all the
# while, which would have made this check quietly blind. A read long enough to cross the hole
# degrades the same way, so when the long read brings nothing recent, a short one is tried: if it
# comes back newer, the log has a hole, and what it holds is counted instead of nothing.
# Sets LOG_TEXT and LOG_DAMAGED; not a value to capture, because `$(…)` would lose the second.
LOG_TEXT=""
LOG_DAMAGED=""
read_log() {
  local name=$1 since=$2 short
  LOG_DAMAGED=""
  LOG_TEXT=$(docker logs --tail "$LOG_TAIL" "$name" 2>&1 || true)
  [ "$(newest_time "$LOG_TEXT")" -lt "$since" ] || return 0
  short=$(docker logs --tail "$LOG_TAIL_SHORT" "$name" 2>&1 || true)
  if [ "$(newest_time "$short")" -gt "$(newest_time "$LOG_TEXT")" ]; then
    LOG_DAMAGED=$name
    LOG_TEXT=$short
  fi
}

count_since() {
  printf '%s\n' "$1" | grep -E "$3" |
    awk -v since="$2" -F'"time":' '{ split($2, t, ","); if (t[1] + 0 >= since) n++ } END { print n + 0 }'
}

# The last minutes of the api processes' logs: server errors, and reports the gate refused
# (ADR-0193: a sign that its numbers are too small for the day's work).
check_logs() {
  local names name errors=0 refused=0 since damaged=""
  since=$((($(now) - LOG_WINDOW_SECONDS) * 1000))
  names=$(docker ps --filter label=com.docker.compose.project=bto-store --format '{{.Names}}|{{.Label "com.docker.compose.service"}}' 2>/dev/null) || return 0
  # A here-string, not a pipe: the counts and LOG_DAMAGED are read in this shell.
  while IFS='|' read -r name service; do
    case "$service" in api | api-apps | api-reports | worker) ;; *) continue ;; esac
    read_log "$name" "$since"
    [ -z "$LOG_DAMAGED" ] || damaged="$damaged ${LOG_DAMAGED#bto-store-}"
    errors=$((errors + $(count_since "$LOG_TEXT" "$since" '"level":(50|60)')))
    refused=$((refused + $(count_since "$LOG_TEXT" "$since" 'report refused')))
  done <<<"$names"
  if [ -n "$damaged" ]; then
    found logs 2 "🟡 Логийн файл эвдэрсэн тул бүрэн уншигдахгүй байна:$damaged
Тог тасарсны дараа ийм болдог. Контейнерийг дахин үүсгэвэл засагдана (bash deploy/store/setup.sh)."
  fi
  if [ "$errors" -ge "$ERROR_COUNT" ]; then
    found errors 1 "🟠 Сүүлийн 10 минутад $errors алдаа бүртгэгдлээ. «Системийн төлөв» хуудсыг шалгана уу."
  fi
  if [ "$refused" -ge 1 ]; then
    found reports 1 "🟡 Сүүлийн 10 минутад $refused тайлан «түр хүлээнэ үү» хариу авлаа: олон тайлан зэрэг авагдаж байна."
  fi
}

# ---------------------------------------------------------------- what is remembered and said

# A problem's memory, one file per key: when it was first seen, in how many rounds in a row,
# when the owner was last told (0: not yet), and the words that were sent.
remember() {
  printf '%s\n%s\n%s\n%s\n' "$2" "$3" "$4" "$5" >"$STATE_DIR/problem.$1"
}

settle() {
  local key file first count sent text at
  at=$(now)
  for key in "${!FOUND_TEXT[@]}"; do
    file="$STATE_DIR/problem.$key"
    first=$at count=0 sent=0
    if [ -f "$file" ]; then { read -r first; read -r count; read -r sent; } <"$file"; fi
    count=$((count + 1))
    text=${FOUND_TEXT[$key]}
    if [ "$sent" -eq 0 ] && [ "$count" -ge "${FOUND_NEED[$key]}" ]; then
      if send "$text"; then sent=$at; fi
    elif [ "$sent" -gt 0 ] && [ $((at - sent)) -ge $((REMIND_HOURS * 3600)) ]; then
      if send "$text
Үргэлжилж буй хугацаа: $(span $((at - first)))."; then sent=$at; fi
    fi
    remember "$key" "$first" "$count" "$sent" "$text"
  done
  # Gone since the last round: the owner hears it only if they heard that it began.
  for file in "$STATE_DIR"/problem.*; do
    [ -f "$file" ] || continue
    key=${file##*/problem.}
    [ -z "${FOUND_TEXT[$key]+x}" ] || continue
    { read -r first; read -r count; read -r sent; read -r text; } <"$file"
    if [ "$sent" -gt 0 ]; then
      send "🟢 Зассан ($(span $((at - first))) үргэлжилсэн): ${text#* }" || continue
    fi
    rm -f "$file"
  done
}

# The PC has started again: said once per start, with how long nothing was watching.
greet_boot() {
  local boot last=0 at
  at=$(now)
  boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)
  [ -f "$STATE_DIR/last-round" ] && last=$(cat "$STATE_DIR/last-round")
  if [ -f "$STATE_DIR/boot" ] && [ "$(cat "$STATE_DIR/boot")" != "$boot" ]; then
    if [ "$last" -gt 0 ] && [ $((at - last)) -ge 180 ]; then
      send "🟡 PC дахин аслаа. $(span $((at - last))) орчим унтарсан байсан ($(date -d "@$last" '+%m-%d %H:%M') – $(date -d "@$at" '+%H:%M'))." || return 0
    fi
  fi
  printf '%s\n' "$boot" >"$STATE_DIR/boot"
}

look() {
  CONTAINERS=""
  check_health
  check_containers
  check_disk
  check_memory
  check_backup
  check_logs
}

main() {
  case "${1:-}" in
    --check)
      look
      if [ -n "$ALERT_TOKEN" ] && [ -n "$ALERT_CHAT" ]; then echo "Мэдэгдэл: Telegram тохируулагдсан."
      else echo "Мэдэгдэл: тохируулаагүй (bash deploy/store/alerts-setup.sh)."; fi
      if [ "${#FOUND_TEXT[@]}" -eq 0 ]; then echo "Асуудал олдсонгүй."; return 0; fi
      printf '%s\n' "${FOUND_TEXT[@]}"
      return 0
      ;;
    --test)
      if send "🟢 Туршилтын мэдэгдэл: харуул ажиллаж байна."; then echo "Илгээгдлээ."; return 0; fi
      echo "Илгээж чадсангүй: bash deploy/store/alerts-setup.sh ажиллуулж тохируулна уу." >&2
      return 1
      ;;
    "") ;;
    *) echo "usage: watch.sh [--check | --test]" >&2; return 64 ;;
  esac
  mkdir -p "$STATE_DIR"
  # One round at a time: a slow round is not joined by the next minute's.
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || return 0
  greet_boot
  look
  settle
  now >"$STATE_DIR/last-round"
  if [ -n "$HEARTBEAT_URL" ]; then curl -s -m 10 -o /dev/null "$HEARTBEAT_URL" 2>/dev/null || true; fi
}

# Sourced by watch.test.sh for its functions; run for a round.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
