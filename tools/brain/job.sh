#!/usr/bin/env bash
# The job desk (ADR-0229, tools/brain/README.md «Jobs that run once»): a job that must run ONCE after
# several sessions' changes (the APKs first of all) runs once, when the last change it waits for has
# landed, in a clean copy of origin/main, and carries every request made until then.
#
#   job.sh request <kind> [--publish] [--by <who>] [--commit <sha>]
#                          your change is on main and you want the job: it starts now, joins the
#                          running one, or waits for the sessions still changing what it builds
#   job.sh want <kind> --by <who> [--note <text>]
#                          a session working directly in ~/bto-dev is changing what it builds
#   job.sh done <kind> --by <who>      that session lets go (a want also lapses after the idle limit)
#   job.sh status [<kind>]             running, waiting, who holds it, the last one
#   job.sh tick                        start every job that is due (land.sh and a one-minute timer)
#   job.sh run <kind> [--publish] [--by <who>]
#                          the owner's override: now, whoever still holds it (one at a time still)
#   job.sh kinds-of <path>…            the kinds these paths are part of
#
# Exit: 0 started, joined, or already built · 3 waiting (it starts by itself later) · 1 failed
# (a publish of an earlier build) · 64 usage. The kinds are tools/brain/jobs/<kind>.job.
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"
export PATH="$HOME/.local/opt/node/bin:$PATH"
# The desk reads other sessions' checkouts (~/bto-dev, the tasks' copies): `git status` there must
# not refresh their index, which takes index.lock and can make their own `git add` fail.
export GIT_OPTIONAL_LOCKS=0

KINDS_DIR="$BRAIN_DIR/jobs"
JSTATE="$STATE/jobs"
mkdir -p "$JSTATE"
SELF="$BRAIN_DIR/job.sh"
TAB=$'\t'

usage() {
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

# --- the books -----------------------------------------------------------------------------------
# $JSTATE/<kind>/requests  waiting requests, one a line: epoch, by, publish, commit, force (tabs)
# $JSTATE/<kind>/running   the running job (key=value): id, pid, group, commit, started, log,
#                          phase (publishing, once it publishes: the job still holds its group)
# $JSTATE/<kind>/carried   the requests the running job carries (lines as in requests)
# $JSTATE/<kind>/last      the last job: status, reason, commit, started, finished, artifact,
#                          published (yes, no, failed), by, log
# $JSTATE/<kind>/wants/<who>  a direct session's want; its time is the file's
# $JSTATE/<kind>/logs/<id>.log, $JSTATE/log (one line a finished job)

lock() {
  exec 7>"$JSTATE/desk.lock"
  flock 7
}
unlock() {
  flock -u 7
  exec 7>&-
}

get() {
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -n 1
}

# set_key <file> <key> <value>: one key of a record, the rest kept.
set_key() {
  local file=$1 key=$2 value=$3
  { grep -v "^$key=" "$file" 2>/dev/null || true; printf '%s=%s\n' "$key" "$value"; } >"$file.tmp"
  mv "$file.tmp" "$file"
}

safe() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9._@-' '_'
}

mtime() {
  stat -c %Y -- "$1" 2>/dev/null || echo 0
}

age() {
  local s=$1
  if [ "$s" -lt 90 ]; then
    echo "${s} s"
  elif [ "$s" -lt 5400 ]; then
    echo "$((s / 60)) min"
  else
    echo "$((s / 3600)) h $(((s % 3600) / 60)) min"
  fi
}

at() {
  if [ -n "${1:-}" ]; then date -d "@$1" '+%F %H:%M'; else echo '?'; fi
}

kinds() {
  local file
  for file in "$KINDS_DIR"/*.job; do
    [ -f "$file" ] && basename "$file" .job
  done
  return 0
}

# Reads a kind's file: its variables are the kind (tools/brain/jobs/apk-staff.job explains them).
load_kind() {
  KIND=${1:-}
  [[ "$KIND" =~ ^[a-z0-9][a-z0-9-]{1,40}$ ]] && [ -f "$KINDS_DIR/$KIND.job" ] ||
    DIE_CODE=64 die "No job kind «$KIND». Kinds: $(kinds | tr '\n' ' ')"
  TITLE=$KIND GROUP='' COMMAND='' ARTIFACT='' PUBLISH='' BUSY_PATTERN='' STORE_STORAGE='' TAKES=''
  CONTRIBUTORS=() SHARED_IMPORTED_BY=() EXCLUDE=() JOB_ENV=() IDLE_HOURS=2 TIME_LIMIT_MINUTES=45
  # shellcheck disable=SC1090
  . "$KINDS_DIR/$KIND.job"
  GROUP=${GROUP:-$KIND}
  # Tests (brain.test.mjs) put a fake build and publish in place of the real ones.
  [ -z "${BTO_JOB_COMMAND:-}" ] || COMMAND=$BTO_JOB_COMMAND
  [ -z "${BTO_JOB_PUBLISH:-}" ] || PUBLISH=$BTO_JOB_PUBLISH
  [ -z "${BTO_JOB_BUSY_PATTERN+set}" ] || BUSY_PATTERN=$BTO_JOB_BUSY_PATTERN
  IDLE=$((IDLE_HOURS * 3600))
  LIMIT=${BTO_JOB_TIME_LIMIT_SECONDS:-$((TIME_LIMIT_MINUTES * 60))}
  KDIR="$JSTATE/$KIND"
  mkdir -p "$KDIR/wants" "$KDIR/logs"
  ROOTS_OF=''
}

# The folders of packages/shared/src that the code under SHARED_IMPORTED_BY uses, on origin/main,
# one line each: «<x> <TAB> how». What it imports as `@tugeel/shared/<x>`; for a bare
# `@tugeel/shared`, what the package's index re-exports (`from './<x>'`); then, in turn, what those
# folders import of each other (`from '../<y>'`, `@tugeel/shared/<y>`).
shared_used() {
  local x how ref=$BASE_REF
  local more
  local -a queue=()
  local -A seen=()
  [ "${#SHARED_IMPORTED_BY[@]}" -gt 0 ] || return 0
  while IFS= read -r x; do
    queue+=("$x${TAB}the app imports @tugeel/shared${x:+/$x}")
  done < <(git -C "$MAIN" grep -hoE "@tugeel/shared(/[a-z0-9-]+)?" "$ref" -- "${SHARED_IMPORTED_BY[@]}" 2>/dev/null |
    sed -E 's|^@tugeel/shared/?||' | sort -u)
  while [ "${#queue[@]}" -gt 0 ]; do
    x=${queue[0]%%"$TAB"*} how=${queue[0]#*"$TAB"}
    queue=("${queue[@]:1}")
    if [ -z "$x" ]; then
      while IFS= read -r more; do
        queue+=("$more${TAB}the app imports @tugeel/shared, whose index re-exports ./$more")
      done < <(git -C "$MAIN" show "$ref:packages/shared/src/index.ts" 2>/dev/null |
        sed -nE "s|.*from '\./([a-z0-9-]+)'.*|\1|p" | sort -u)
      continue
    fi
    [ -z "${seen[$x]:-}" ] || continue
    seen[$x]=1
    git -C "$MAIN" cat-file -e "$ref:packages/shared/src/$x" 2>/dev/null || continue
    printf '%s\t%s\n' "$x" "$how"
    while IFS= read -r more; do
      queue+=("$more${TAB}@tugeel/shared/$x, which the app uses, imports it")
    done < <(git -C "$MAIN" grep -hoE "from '(\.\./[a-z0-9-]+|@tugeel/shared/[a-z0-9-]+)" "$ref" -- "packages/shared/src/$x" 2>/dev/null |
      sed -E "s#^from '(\.\./|@tugeel/shared/)##" | sort -u)
  done
}

# ROOTS and ROOT_WHY: the paths that are part of the kind and why (its CONTRIBUTORS, then the
# shared folders the app uses), read once per kind and command.
load_roots() {
  [ "$ROOTS_OF" != "$KIND" ] || return 0
  local root x how
  ROOTS=()
  declare -gA ROOT_WHY=()
  for root in "${CONTRIBUTORS[@]}"; do
    ROOTS+=("$root")
    ROOT_WHY[$root]="part of the app ($root)"
  done
  while IFS=$'\t' read -r x how; do
    root="packages/shared/src/$x"
    ROOTS+=("$root")
    ROOT_WHY[$root]=$how
  done < <(shared_used)
  ROOTS_OF=$KIND
}

# Is a path (a file, or a folder a task holds) part of what the kind builds? WHY says how.
contributes() {
  local path=${1%/} root pattern
  load_roots
  for root in "${ROOTS[@]}"; do
    if [ "$path" = "$root" ] || [[ "$path" == "$root"/* ]]; then
      for pattern in "${EXCLUDE[@]}"; do
        # shellcheck disable=SC2053
        [[ "$path" == $pattern ]] && return 1
      done
      WHY_PATH="$path: ${ROOT_WHY[$root]}"
      return 0
    fi
    if [[ "$root" == "$path"/* ]]; then
      WHY_PATH="$path: holds $root, ${ROOT_WHY[$root]}"
      return 0
    fi
  done
  return 1
}

changed_files() {
  git -C "$1" status --porcelain=v1 --untracked-files=all 2>/dev/null | cut -c4- | sed 's/^.* -> //; s/^"//; s/"$//'
}

# Who is still changing what the kind builds, one line each: «holding|idle <TAB> seconds idle <TAB>
# who <TAB> why (the matching paths and what makes each part of the kind)».
#   a brain task holding a path that is part of it, until it lands or is dropped (books: lanes/<slug>);
#   ~/bto-dev's own uncommitted files or unpushed commits on such paths (a direct session);
#   a declared want (job.sh want).
# Idle is the time since the last sign of work (a file written, a commit, the claim); past the kind's
# limit a contributor no longer holds the job.
contributors() {
  local now lane slug path newest t file count unpushed copy
  local -a holds files
  load_roots
  now=$(date +%s)
  for lane in "$STATE"/lanes/*; do
    [ -f "$lane" ] || continue
    slug=$(basename "$lane")
    holds=()
    while IFS= read -r path; do
      [ -n "$path" ] && contributes "$path" && holds+=("$WHY_PATH")
    done <"$lane"
    [ "${#holds[@]}" -gt 0 ] || continue
    newest=$(mtime "$lane")
    copy="$WORK/$slug"
    if [ -d "$copy" ]; then
      t=$(git -C "$copy" log -1 --format=%ct 2>/dev/null || echo 0)
      [ "$t" -le "$newest" ] || newest=$t
      while IFS= read -r file; do
        t=$(mtime "$copy/$file")
        [ "$t" -le "$newest" ] || newest=$t
      done < <(changed_files "$copy")
    fi
    emit_contributor "$now" "$newest" "task $slug" "it holds $(join_why "${holds[@]}")"
  done
  count=0
  newest=0
  files=()
  while IFS= read -r file; do
    contributes "$file" || continue
    count=$((count + 1))
    files+=("$WHY_PATH")
    t=$(mtime "$MAIN/$file")
    [ "$t" -le "$newest" ] || newest=$t
  done < <(changed_files "$MAIN")
  unpushed=0
  if [ "$(git -C "$MAIN" rev-list --count "$BASE_REF..HEAD" 2>/dev/null || echo 0)" -gt 0 ]; then
    while IFS= read -r file; do
      contributes "$file" || continue
      unpushed=$((unpushed + 1))
      files+=("$WHY_PATH (committed, not pushed)")
    done < <(git -C "$MAIN" diff --name-only "$BASE_REF...HEAD" 2>/dev/null)
    if [ "$unpushed" -gt 0 ]; then
      t=$(git -C "$MAIN" log -1 --format=%ct HEAD)
      [ "$t" -le "$newest" ] || newest=$t
    fi
  fi
  if [ "$count" -gt 0 ] || [ "$unpushed" -gt 0 ]; then
    local what="~/bto-dev"
    [ "$count" -eq 0 ] || what="$what, $count uncommitted file(s)"
    [ "$unpushed" -eq 0 ] || what="$what, $unpushed file(s) in unpushed commits"
    emit_contributor "$now" "$newest" "$what" "$(join_why "${files[@]}")"
  fi
  for file in "$KDIR"/wants/*; do
    [ -f "$file" ] || continue
    local note
    note=$(head -c 200 "$file" | tr '\n' ' ')
    emit_contributor "$now" "$(mtime "$file")" "want: $(basename "$file")" "declared with job.sh want${note:+: «${note% }»}"
  done
}

# The first three reasons, then how many more.
join_why() {
  local out='' n=0 item
  for item in "$@"; do
    n=$((n + 1))
    [ "$n" -le 3 ] || continue
    out="${out:+$out; }$item"
  done
  [ "$n" -le 3 ] || out="$out; and $((n - 3)) more"
  printf '%s' "$out"
}

emit_contributor() {
  local now=$1 since=$2 who=$3 why=$4 idle
  idle=$((now - since))
  [ "$idle" -ge 0 ] || idle=0
  if [ "$idle" -lt "$IDLE" ]; then
    printf 'holding\t%s\t%s\t%s\n' "$idle" "$who" "$why"
  else
    printf 'idle\t%s\t%s\t%s\n' "$idle" "$who" "$why"
  fi
}

# Does a job run from commit $1 already carry everything of commit $2 that the kind builds? Yes when
# $2 is in $1, or when nothing between them is part of the kind.
carries() {
  local built=$1 wanted=$2 file
  [ -n "$built" ] && [ -n "$wanted" ] || return 1
  git -C "$MAIN" cat-file -e "$built^{commit}" 2>/dev/null || return 1
  git -C "$MAIN" cat-file -e "$wanted^{commit}" 2>/dev/null || return 1
  git -C "$MAIN" merge-base --is-ancestor "$wanted" "$built" && return 0
  while IFS= read -r file; do
    contributes "$file" && return 1
  done < <(git -C "$MAIN" diff --name-only "$built" "$wanted")
  return 0
}

runner_alive() {
  local pid=$1
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || return 1
  [ ! -r "/proc/$pid/cmdline" ] || tr '\0' ' ' <"/proc/$pid/cmdline" | grep -q 'job\.sh _run'
}

running_here() {
  [ -f "$1/running" ] && runner_alive "$(get "$1/running" pid)"
}

bys_of() {
  [ -f "$1" ] || return 0
  awk -F'\t' '{ print $2 ($3 == "yes" ? " (publish)" : "") }' "$1" | sort -u | paste -sd, - | sed 's/,/, /g'
}

wants_publish() {
  [ -f "$1" ] && awk -F'\t' '$3 == "yes" { found = 1 } END { exit !found }' "$1"
}

# Ends the running job of a kind's folder in the books (under the lock): `last` from `running` and
# `carried`, a line in the log. publish: yes, no, or failed.
finish_record() {
  local kdir=$1 status=$2 reason=$3 artifact=$4 publish=$5
  {
    printf 'status=%s\nreason=%s\n' "$status" "$reason"
    printf 'commit=%s\nstarted=%s\nfinished=%s\n' "$(get "$kdir/running" commit)" "$(get "$kdir/running" started)" "$(date +%s)"
    printf 'artifact=%s\npublished=%s\nlog=%s\n' "$artifact" "$publish" "$(get "$kdir/running" log)"
    printf 'by=%s\n' "$(bys_of "$kdir/carried")"
  } >"$kdir/last.tmp"
  mv "$kdir/last.tmp" "$kdir/last"
  rm -f "$kdir/running" "$kdir/carried" "$kdir/died"
  log_line "$kdir"
}

# One line in $JSTATE/log for a finished job.
log_line() {
  local kdir=$1 reason
  reason=$(get "$kdir/last" reason)
  printf '%s %s %s %s %s published=%s by=%s%s\n' "$(date '+%F %T')" "$(basename "$kdir")" \
    "$(get "$kdir/last" status)" "$(get "$kdir/last" commit | cut -c1-8)" \
    "$(basename "$(get "$kdir/last" artifact)")" "$(get "$kdir/last" published)" \
    "$(get "$kdir/last" by | tr ' ' '_')" "${reason:+ ($reason)}" >>"$JSTATE/log"
}

# A running record whose process is gone (the PC restarted, it was killed) is a job that died, not
# one that failed: the first time its requests (--publish included) go back to the queue, ahead of
# newer ones, and the next tick starts it again; a second death in a row is recorded as failed and
# its requests are spent. `died` marks the first; any job that ends by itself clears it.
reap() {
  local file kdir
  for file in "$JSTATE"/*/running; do
    [ -f "$file" ] || continue
    runner_alive "$(get "$file" pid)" && continue
    kdir=$(dirname "$file")
    if [ -f "$kdir/died" ]; then
      finish_record "$kdir" failed "stopped twice in a row before it finished (killed, or the PC restarted); not started again" "" no
      continue
    fi
    { cat "$kdir/carried" 2>/dev/null || true; cat "$kdir/requests" 2>/dev/null || true; } >"$kdir/requests.tmp"
    mv "$kdir/requests.tmp" "$kdir/requests"
    printf 'id=%s\ncommit=%s\nat=%s\n' "$(get "$file" id)" "$(get "$file" commit)" "$(date +%s)" >"$kdir/died"
    printf '%s %s died %s (killed, or the PC restarted): its requests wait again, once\n' "$(date '+%F %T')" \
      "$(basename "$kdir")" "$(get "$file" commit | cut -c1-8)" >>"$JSTATE/log"
    rm -f "$file" "$kdir/carried"
  done
}

# Why the loaded kind cannot start now, one line each in WHY (empty: it can). force: the owner's run.
blockers() {
  local force=$1 other kdir line pids
  WHY=()
  for kdir in "$JSTATE"/*/; do
    kdir=${kdir%/}
    other=$(basename "$kdir")
    running_here "$kdir" || continue
    [ "$(get "$kdir/running" group)" = "$GROUP" ] || continue
    WHY+=("the $other job is running (since $(at "$(get "$kdir/running" started)")); one $GROUP job at a time")
  done
  if [ "${#WHY[@]}" -eq 0 ] && [ -n "$BUSY_PATTERN" ]; then
    pids=$(pgrep -f -- "$BUSY_PATTERN" | tr '\n' ' ' || true)
    [ -z "$pids" ] || WHY+=("a build started by hand outside the desk is running (pid ${pids% })")
  fi
  [ "$force" = yes ] && return 0
  while IFS=$'\t' read -r state idle who why; do
    [ "$state" = holding ] && WHY+=("$who, last change $(age "$idle") ago: $why")
  done < <(contributors)
  return 0
}

# Starts the loaded kind now (under the lock): every waiting request goes with it, from origin/main
# as it is now. The work runs in the background at low priority (_run).
start_job() {
  local id commit log pid
  id=$(date +%Y%m%d-%H%M%S)-$$
  commit=$(git -C "$MAIN" rev-parse "$BASE_REF")
  log="$KDIR/logs/$id.log"
  if [ -f "$KDIR/requests" ]; then mv "$KDIR/requests" "$KDIR/carried"; else : >"$KDIR/carried"; fi
  setsid nohup nice -n 15 bash "$SELF" _run "$KIND" "$id" </dev/null >>"$log" 2>&1 7>&- &
  pid=$!
  printf 'id=%s\npid=%s\ngroup=%s\ncommit=%s\nstarted=%s\nlog=%s\n' "$id" "$pid" "$GROUP" "$commit" "$(date +%s)" "$log" >"$KDIR/running"
  echo "STARTED: $KIND ($TITLE) from ${commit:0:8} ($BASE_REF), in the background at low priority${TAKES:+ ($TAKES)}"
  echo "  carries: $(bys_of "$KDIR/carried")"
  echo "  log:     $log"
  [ -z "$ARTIFACT" ] || echo "  result:  $MAIN/$ARTIFACT (bash $SELF status $KIND)"
}

print_blockers() {
  local line
  for line in "${WHY[@]}"; do echo "  waits for: $line"; done
}

# append_request <file> <by> <publish> <commit> <force>: one request line.
append_request() {
  local file=$1 by=$2 publish=$3 commit=$4 force=$5
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date +%s)" "$by" "$publish" "$commit" "$force" >>"$file"
}

# Runs the kind's PUBLISH for an artifact in ~/bto-dev; its output goes to the job's log.
publish_artifact() {
  local artifact=$1 log=$2 tree="$WORK/_jobs/$GROUP"
  [ -n "$PUBLISH" ] || { echo "this kind has nothing to publish" >>"$log"; return 1; }
  [ -d "$tree" ] || tree=$MAIN
  echo "== $(date '+%F %T') publish $(basename "$artifact")" >>"$log"
  (cd "$tree" && env ARTIFACT="$artifact" STORE_STORAGE="$STORE_STORAGE" bash -c "$PUBLISH") >>"$log" 2>&1
}

default_by() {
  case "$PWD" in
    "$WORK"/*) local rest=${PWD#"$WORK"/}; echo "${rest%%/*}" ;;
    "$MAIN" | "$MAIN"/*) echo bto-dev ;;
    *) id -un ;;
  esac
}

# --- the job itself (in the background) ----------------------------------------------------------
run_job() {
  load_kind "$1"
  local id=$2 commit tree marker artifact='' status=ok reason='' rel code publish=no
  lock
  if [ "$(get "$KDIR/running" id)" != "$id" ]; then
    unlock
    return 0
  fi
  set_key "$KDIR/running" pid "$$"
  commit=$(get "$KDIR/running" commit)
  unlock
  echo "== $(date '+%F %T') $KIND from $commit"
  tree="$WORK/_jobs/$GROUP"
  marker="$KDIR/.started-$id"
  : >"$marker"
  if prepare_tree "$tree" "$commit"; then
    set +e
    # timeout gives the command its own process group and stops all of it (Gradle too).
    (cd "$tree" && env BTO_JOB_DESK=1 "${JOB_ENV[@]}" timeout --kill-after=60 "${LIMIT}s" bash -c "$COMMAND")
    code=$?
    set -e
    if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
      status=failed reason="stopped at the time limit ($(age "$LIMIT")): it hung or ran too long"
    elif [ "$code" -ne 0 ]; then
      status=failed reason="the command failed (exit $code)"
    elif [ -n "$ARTIFACT" ]; then
      # shellcheck disable=SC2086
      artifact=$(cd "$tree" && find $(dirname "$ARTIFACT") -maxdepth 1 -name "$(basename "$ARTIFACT")" -newer "$marker" -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n 1 | cut -d' ' -f2-)
      if [ -z "$artifact" ]; then
        status=failed reason="it finished but made no $ARTIFACT"
      else
        rel=$artifact
        mkdir -p "$MAIN/$(dirname "$rel")"
        cp -p "$tree/$rel" "$MAIN/$rel"
        artifact="$MAIN/$rel"
        echo "== copied to $artifact"
      fi
    fi
  else
    status=failed reason="could not prepare $tree at ${commit:0:8}"
  fi
  rm -f "$marker"
  lock
  if [ "$status" = ok ] && wants_publish "$KDIR/carried"; then
    # The job keeps its record, so nothing else of its group starts (and touches the copy the
    # publish runs from) until the publish is over. A request joining now is published too.
    set_key "$KDIR/running" phase publishing
    unlock
    publish=yes
    publish_artifact "$artifact" "$(get "$KDIR/running" log)" || publish=failed
    echo "== published: $publish"
    lock
  fi
  finish_record "$KDIR" "$status" "$reason" "$artifact" "$publish"
  unlock
  echo "== $(date '+%F %T') $status${reason:+: $reason}"
  # Old logs go; the next due job starts.
  find "$KDIR/logs" -name '*.log' -printf '%T@ %p\n' | sort -rn | tail -n +21 | cut -d' ' -f2- | xargs -r rm -f
  exec bash "$SELF" tick
}

# The desk's own clean copy of a commit: ~/bto-work/_jobs/<group>, never ~/bto-dev.
prepare_tree() {
  local tree=$1 commit=$2
  if [ ! -e "$tree/.git" ]; then
    git -C "$MAIN" worktree prune
    mkdir -p "$(dirname "$tree")"
    git -C "$MAIN" worktree add -q --detach "$tree" "$commit" || return 1
  fi
  git -C "$tree" checkout -q -f --detach "$commit" || return 1
  git -C "$tree" clean -fdq || return 1
  link_modules "$tree" || return 1
  copy_env "$tree"
}

# --- the commands --------------------------------------------------------------------------------
cmd=${1:-}
shift || true

PUBLISH_FLAG=no BY='' BY_GIVEN=no NOTE='' COMMIT=''
parse_options() {
  POSITIONAL=()
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --publish) PUBLISH_FLAG=yes ;;
      --by)
        BY=$(safe "${2:-}") BY_GIVEN=yes
        shift
        ;;
      --note)
        NOTE=${2:-}
        shift
        ;;
      --commit)
        COMMIT=${2:-}
        shift
        ;;
      -*) DIE_CODE=64 die "Unknown option $1" ;;
      *) POSITIONAL+=("$1") ;;
    esac
    shift
  done
  [ -n "$BY" ] || BY=$(safe "$(default_by)")
}

case "$cmd" in
  request)
    parse_options "$@"
    load_kind "${POSITIONAL[0]:-}"
    fetch_main
    wanted=${COMMIT:-$(git -C "$MAIN" rev-parse "$BASE_REF")}
    git -C "$MAIN" cat-file -e "$wanted^{commit}" 2>/dev/null || die "No commit $wanted here."
    wanted=$(git -C "$MAIN" rev-parse "$wanted")
    lock
    reap
    rm -f "$KDIR/wants/$BY"
    if running_here "$KDIR"; then
      built=$(get "$KDIR/running" commit)
      if carries "$built" "$wanted"; then
        # Only this request: one waiting for a later commit stays for the next job.
        append_request "$KDIR/carried" "$BY" "$PUBLISH_FLAG" "$wanted" no
        echo "JOINED: the $KIND job running since $(at "$(get "$KDIR/running" started)") (from ${built:0:8}) already has your change."
        echo "  carries: $(bys_of "$KDIR/carried")"
        echo "  log:     $(get "$KDIR/running" log)"
        exit 0
      fi
      append_request "$KDIR/requests" "$BY" "$PUBLISH_FLAG" "$wanted" no
      echo "QUEUED: the running $KIND job started from ${built:0:8}, before your change (${wanted:0:8}); the next one starts by itself when it ends."
      blockers no
      print_blockers
      exit 3
    fi
    artifact=$(get "$KDIR/last" artifact)
    if [ "$(get "$KDIR/last" status)" = ok ] && { [ -z "$ARTIFACT" ] || [ -f "$artifact" ]; } &&
      carries "$(get "$KDIR/last" commit)" "$wanted"; then
      published=$(get "$KDIR/last" published)
      echo "ALREADY: the last $KIND job ($(at "$(get "$KDIR/last" finished)"), from $(get "$KDIR/last" commit | cut -c1-8)) has your change: ${artifact:-done}"
      if [ "$PUBLISH_FLAG" = no ] || [ "$published" = yes ]; then
        echo "  published: $published"
        exit 0
      fi
      blockers yes
      if [ "${#WHY[@]}" -gt 0 ]; then
        # The publish runs from the group's copy, which another job is using now: the next job
        # carries this request and publishes.
        append_request "$KDIR/requests" "$BY" "$PUBLISH_FLAG" "$wanted" no
        echo "QUEUED: it is not published yet, and the publish waits for:"
        print_blockers
        exit 3
      fi
      if publish_artifact "$artifact" "$(get "$KDIR/last" log)"; then
        set_key "$KDIR/last" published yes
        echo "  published now"
        exit 0
      fi
      set_key "$KDIR/last" published failed
      echo "  the publish FAILED: $(get "$KDIR/last" log)"
      exit 1
    fi
    append_request "$KDIR/requests" "$BY" "$PUBLISH_FLAG" "$wanted" no
    blockers no
    if [ "${#WHY[@]}" -eq 0 ]; then
      start_job
      exit 0
    fi
    echo "QUEUED: $KIND starts by itself when nobody holds it any more (bash $SELF status $KIND)."
    print_blockers
    exit 3
    ;;
  run)
    parse_options "$@"
    load_kind "${POSITIONAL[0]:-}"
    fetch_main
    lock
    reap
    append_request "$KDIR/requests" "$BY" "$PUBLISH_FLAG" "$(git -C "$MAIN" rev-parse "$BASE_REF")" yes
    blockers yes
    if [ "${#WHY[@]}" -eq 0 ]; then
      start_job
      exit 0
    fi
    echo "QUEUED: $KIND starts as soon as this ends:"
    print_blockers
    exit 3
    ;;
  want)
    parse_options "$@"
    load_kind "${POSITIONAL[0]:-}"
    [ "$BY_GIVEN" = yes ] || DIE_CODE=64 die "Say who holds it: job.sh want $KIND --by <who>"
    lock
    printf '%s\n' "$NOTE" >"$KDIR/wants/$BY"
    echo "WANT: $BY holds $KIND until «job.sh done $KIND --by $BY» or $IDLE_HOURS h without a new want."
    ;;
  done)
    parse_options "$@"
    load_kind "${POSITIONAL[0]:-}"
    [ "$BY_GIVEN" = yes ] || DIE_CODE=64 die "Say who lets go: job.sh done $KIND --by <who>"
    lock
    if [ -f "$KDIR/wants/$BY" ]; then
      rm -f "$KDIR/wants/$BY"
      echo "DONE: $BY no longer holds $KIND."
    else
      echo "DONE: $BY did not hold $KIND."
    fi
    unlock
    # A waiting job may be due now.
    bash "$SELF" tick || true
    ;;
  tick)
    lock
    reap
    due=()
    while IFS= read -r kind; do
      [ -s "$JSTATE/$kind/requests" ] || continue
      running_here "$JSTATE/$kind" && continue
      due+=("$kind")
    done < <(kinds)
    [ "${#due[@]}" -gt 0 ] || exit 0
    unlock
    fetch_main
    lock
    reap
    # The oldest request first.
    while IFS= read -r kind; do
      load_kind "$kind"
      [ -s "$KDIR/requests" ] || continue
      running_here "$KDIR" && continue
      force=no
      awk -F'\t' '$5 == "yes" { found = 1 } END { exit !found }' "$KDIR/requests" && force=yes
      blockers "$force"
      if [ "${#WHY[@]}" -eq 0 ]; then
        start_job
      else
        echo "$KIND waits:"
        print_blockers
      fi
    done < <(for kind in "${due[@]}"; do printf '%s %s\n' "$(head -n 1 "$JSTATE/$kind/requests" | cut -f1)" "$kind"; done | sort -n | cut -d' ' -f2)
    ;;
  status)
    mapfile -t list < <(if [ -n "${1:-}" ]; then echo "$1"; else kinds; fi)
    for kind in "${list[@]}"; do
      load_kind "$kind"
      echo "$KIND: $TITLE"
      if running_here "$KDIR"; then
        started=$(get "$KDIR/running" started)
        phase=$(get "$KDIR/running" phase)
        echo "  running:   since $(at "$started") ($(age $(($(date +%s) - started)))), from $(get "$KDIR/running" commit | cut -c1-8); publish: $(wants_publish "$KDIR/carried" && echo yes || echo no)${phase:+; now $phase}; time limit $(age "$LIMIT")"
        echo "             carries: $(bys_of "$KDIR/carried")"
        echo "             log: $(get "$KDIR/running" log)"
      elif [ -f "$KDIR/running" ]; then
        echo "  running:   its process is gone; the next tick records it as failed"
      fi
      if [ -s "$KDIR/requests" ]; then
        echo "  waiting:   $(wc -l <"$KDIR/requests") request(s): $(bys_of "$KDIR/requests")"
      fi
      if [ -f "$KDIR/died" ]; then
        echo "  died:      the job from $(get "$KDIR/died" commit | cut -c1-8) stopped without an exit at $(at "$(get "$KDIR/died" at)"); its requests waited again (a second death fails)"
      fi
      any=no
      while IFS=$'\t' read -r state idle who why; do
        any=yes
        if [ "$state" = holding ]; then
          echo "  holding:   $who, last change $(age "$idle") ago"
        else
          echo "  idle:      $who, last change $(age "$idle") ago (past ${IDLE_HOURS} h: not holding)"
        fi
        echo "             because: $why"
      done < <(contributors)
      [ "$any" = yes ] || echo "  holding:   nobody"
      if [ -f "$KDIR/last" ]; then
        echo "  last:      $(get "$KDIR/last" status) $(at "$(get "$KDIR/last" finished)"), from $(get "$KDIR/last" commit | cut -c1-8), for $(get "$KDIR/last" by)"
        reason=$(get "$KDIR/last" reason)
        [ -z "$reason" ] || echo "             $reason"
        artifact=$(get "$KDIR/last" artifact)
        [ -z "$artifact" ] || echo "             $artifact; published: $(get "$KDIR/last" published)"
        echo "             log: $(get "$KDIR/last" log)"
      fi
    done
    ;;
  kinds-of)
    while IFS= read -r kind; do
      load_kind "$kind"
      for path in "$@"; do
        if contributes "$path"; then
          echo "$kind"
          break
        fi
      done
    done < <(kinds)
    ;;
  _run)
    run_job "$@"
    ;;
  *)
    usage
    ;;
esac
