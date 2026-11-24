#!/usr/bin/env bash
# The inbox gate (ADR-0242, tools/brain/README.md «The inbox gate»): a second developer's work, from
# another PC and another AI, reaches main only through this PC's one gate (land.sh). They push a
# branch `in/<slug>`; a timer here takes it, checks it and lands it, or writes back why not.
#
#   inbox.sh tick [--dry-run]          take every new head of an in/* branch (the timer bto-brain-inbox)
#                                      --dry-run: say what it would do; change, open or report nothing
#   inbox.sh status                    what waits, what waits for review, the last results
#   inbox.sh approve <branch>          the brain reviewed a GUARDED change: land it
#   inbox.sh reject <branch> <reason>  the brain refuses it: the task is dropped, the reason sent back
#   inbox.sh retry <branch>            forget the result for its head: the next tick tries it again
#   inbox.sh classify <path>…          the rule alone: REFUSE/LIGHT/GUARDED per path, then the whole
#
# A head is handled once. LIGHT (pages, texts, the staff app's screens, documents) lands at once
# through land.sh; GUARDED (the api, packages, migrations, configs) is checked and waits for the
# brain's `approve`; a guard-rail path is refused. Results go back to GitHub as a commit status and
# a commit comment on the branch's head. Exit: 0 done · 1 failed · 2 nothing to approve or reject ·
# 64 usage.
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"
export PATH="$HOME/.local/opt/node/bin:$PATH"
# The gate reads other sessions' checkouts; it never takes their index.lock (as job.sh).
export GIT_OPTIONAL_LOCKS=0

ISTATE="$STATE/inbox"
mkdir -p "$ISTATE/items" "$ISTATE/logs"
REMOTE=${BTO_INBOX_REMOTE:-origin}
GH=${BTO_INBOX_GH:-gh}
CONTEXT=bto/inbox-gate
NS=refs/inbox
DRY=no

usage() {
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
  exit 64
}

# --- the rule (ADR-0242 §3): what is refused, what lands at once, what waits for review ------------

# Prints why a path is refused, or nothing. These stay the owner's: the gate itself, the checks, the
# deploy, the agents' rules, the dependencies, and secrets.
guard_rail() {
  # A name git would quote (a quote, a backslash, a control character, a newline) is never taken:
  # every list of paths here and in task.sh's books is one name a line.
  if [[ "$1" == *[[:cntrl:]]* || "$1" == *'"'* || "$1" == *'\'* ]]; then
    echo "a file name with a quote, a backslash or a control character"
    return 0
  fi
  case "$1" in
    .github/* | deploy/* | tools/brain/* | .claude/* | */.claude/*)
      echo "the gate, the deploy and CI stay the owner's" ;;
    CLAUDE.md | AGENTS.md | */CLAUDE.md | */AGENTS.md | CLAUDE.local.md)
      echo "the agents' rules stay the owner's" ;;
    tools/fast-check/* | tools/lint-guards/* | tools/finance-core/* | eslint.config.* | ci/* | scripts/* | .husky/* | .gitattributes)
      echo "the checks themselves stay the owner's" ;;
    package.json | */package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .npmrc | .nvmrc)
      echo "dependencies and the workspace change only through the owner's brain" ;;
    *.env.example) ;;
    .env | .env.* | */.env | */.env.*)
      echo "secrets never go into the repository" ;;
  esac
}

# Prints light or guarded for one path (a path guard_rail refuses is never asked).
class_of() {
  case "$1" in
    docs/decisions/* | docs/STATUS.md) echo guarded ;;
    docs/* | *.md) echo light ;;
    packages/shared/i18n/*.json) echo light ;;
    apps/web/src/pos/* | apps/web/pos.html) echo guarded ;;
    apps/web/src/* | apps/web/index.html | apps/web/public/*) echo light ;;
    apps/mobile/src/api/* | apps/mobile/src/outbox/* | apps/mobile/src/offline/* | apps/mobile/src/server/* | apps/mobile/src/config/*)
      echo guarded ;;
    apps/mobile/app/* | apps/mobile/src/* | apps/mobile/assets/*) echo light ;;
    *) echo guarded ;;
  esac
}

# classify <path>…: sets REFUSALS (one line a refused path), CLASS (light, guarded) and MIGRATIONS.
classify() {
  local path why
  REFUSALS='' CLASS=light MIGRATIONS=''
  for path in "$@"; do
    why=$(guard_rail "$path")
    if [ -n "$why" ]; then
      REFUSALS+="$path: $why"$'\n'
      continue
    fi
    [ "$(class_of "$path")" = light ] || CLASS=guarded
    case "$path" in
      apps/api/src/db/migrations/*) MIGRATIONS+="$path " ;;
    esac
  done
  REFUSALS=${REFUSALS%$'\n'}
}

# The api's integration suites a reviewer may want (a hint in status, never run by the tick).
suites_of() {
  local path mod integrity=no
  local -A mods=()
  for path in "$@"; do
    case "$path" in
      apps/api/src/modules/*)
        mod=${path#apps/api/src/modules/}
        mods[${mod%%/*}]=1
        ;;
    esac
    case "$path" in
      apps/api/src/db/migrations/* | apps/api/src/finance-core/* | apps/api/src/modules/inventory/* | \
        apps/api/src/modules/finance/* | apps/api/src/modules/fin-bridge/* | apps/api/src/modules/sales/* | \
        apps/api/src/modules/pos/* | apps/api/src/modules/procurement/*) integrity=yes ;;
    esac
  done
  [ "${#mods[@]}" -eq 0 ] || echo "bash tools/brain/int.sh ${!mods[*]}"
  [ "$integrity" = no ] || echo "bash tools/brain/int.sh --integrity"
  return 0
}

# --- the books: $ISTATE/items/<key> (key=value), $ISTATE/log, $ISTATE/logs/<key>-<head>.log ------
#   branch, head, state (WAITING, WAITING-REVIEW, LANDED, REFUSED, WITHDRAWN), class, files, task,
#   reason, landed, started, updated, reported (the state last reported), tries (failed reports)

get() {
  [ -f "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -n 1
}

set_key() {
  local file=$1 key=$2 value
  value=$(printf '%s' "$3" | tr '\n' ' ')
  { grep -v "^$key=" "$file" 2>/dev/null || true; printf '%s=%s\n' "$key" "$value"; } >"$file.tmp"
  mv "$file.tmp" "$file"
}

key_of() {
  printf '%s' "$1" | tr -c 'A-Za-z0-9_-' '_'
}

log_line() {
  printf '%s %s %s %s %s\n' "$(date '+%F %T')" "$1" "$2" "${3:0:8}" "$4" >>"$ISTATE/log"
}

# set_state <item> <state> <reason>: the record and one line in the log.
# set_state <item> <state> <reason> [<public>]: the reason stays on this PC (status, the log); the
# public text (default: the reason) is what GitHub gets, never a local path or a check's output.
# Reaching a state ends the attempt's phase (below).
set_state() {
  local item=$1
  set_key "$item" phase ""
  # The same result again (a WAITING retried every tick) is not a new line.
  if [ "$(get "$item" state)" = "$2" ] && [ "$(get "$item" reason)" = "$(printf '%s' "$3" | tr '\n' ' ')" ]; then
    return 0
  fi
  set_key "$item" state "$2"
  set_key "$item" reason "$3"
  set_key "$item" public "${4:-$3}"
  set_key "$item" updated "$(date +%s)"
  log_line "$2" "$(get "$item" branch)" "$(get "$item" head)" "$3"
}

# --- writing back to GitHub ---------------------------------------------------------------------

repo_of() {
  [ -z "${BTO_INBOX_REPO:-}" ] || { echo "$BTO_INBOX_REPO"; return 0; }
  # ERE has no lazy match: take the path after the host, then drop a trailing «/» and «.git».
  git -C "$MAIN" remote get-url "$REMOTE" 2>/dev/null |
    sed -nE 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+/[^/]+)/?$#\2#p' |
    sed -E 's#\.git$##'
}

# The words of a result: GitHub's state, a short line (≤ 140), the English text and one Mongolian line.
words_of() {
  local item=$1 state reason landed branch
  state=$(get "$item" state) reason=$(get "$item" public) landed=$(get "$item" landed)
  [ -n "$reason" ] || reason=$(get "$item" reason)
  branch=$(get "$item" branch)
  case "$state" in
    LANDED)
      GH_STATE=success
      SHORT="LANDED ${landed:0:8} on main"
      EN="LANDED ${landed:0:8} on main. ${reason}"
      MN="main-д орлоо (${landed:0:8}). $(get "$item" live_mn)"
      ;;
    WAITING-REVIEW)
      GH_STATE=pending
      SHORT="WAITING-REVIEW: checked green; the brain reviews and lands it"
      EN="WAITING-REVIEW: a GUARDED change (the api, packages, a migration or a config). pnpm check:fast is green; the brain on the owner's PC reviews it and lands it, or writes back why not. Nothing to do now; a new push to $branch replaces this one."
      MN="Шалгалт ногоон. GUARDED өөрчлөлт тул тархи хянаад main-д оруулна."
      ;;
    WAITING)
      GH_STATE=pending
      SHORT="WAITING: a task on the owner's PC holds these files"
      EN="WAITING: ${reason}. It goes on by itself when that task lands; nothing to do."
      MN="Эдгээр файлыг өөр ажил барьж байна; тэр дуусмагц өөрөө үргэлжилнэ."
      ;;
    REFUSED)
      GH_STATE=failure
      SHORT="REFUSED: ${reason}"
      EN="REFUSED: ${reason}. Fix it and push again to $branch."
      MN="Татгалзлаа: $(get "$item" reason_mn). Засаад $branch руу дахин push хийнэ үү."
      ;;
    *) return 1 ;;
  esac
  SHORT=${SHORT:0:140}
}

# report <item>: the result as a commit status and a commit comment on the head, once per state.
report() {
  local item=$1 head state repo body tries
  head=$(get "$item" head) state=$(get "$item" state)
  [ "$(get "$item" reported)" != "$state" ] || return 0
  # An attempt still under way (or one a killed tick left) has nothing to say yet.
  [ -z "$(get "$item" phase)" ] || return 0
  words_of "$item" || return 0
  if [ "$DRY" = yes ]; then
    return 0
  fi
  repo=$(repo_of)
  # GitHub refuses a short sha (422): always the full 40-hex one.
  head=$(git -C "$MAIN" rev-parse -q --verify "${head}^{commit}" 2>/dev/null || echo "$head")
  if [ -z "$repo" ]; then
    echo "  not reported: $REMOTE is not a GitHub repository (BTO_INBOX_REPO)" >&2
    set_key "$item" reported "$state"
    return 0
  fi
  body=$(printf '**Bto inbox gate: %s**\n\n%s\n\nМонгол: %s\n\n<sub>%s @ %s · tools/brain/inbox.sh (ADR-0242)</sub>\n' \
    "$state" "$EN" "$MN" "$(get "$item" branch)" "${head:0:8}")
  if timeout 60 "$GH" api -X POST "repos/$repo/statuses/$head" -f state="$GH_STATE" -f context="$CONTEXT" \
    -f description="$SHORT" >/dev/null 2>>"$ISTATE/gh.log" &&
    timeout 60 "$GH" api -X POST "repos/$repo/commits/$head/comments" -f body="$body" >/dev/null 2>>"$ISTATE/gh.log"; then
    set_key "$item" reported "$state"
    set_key "$item" tries 0
  else
    tries=$(get "$item" tries)
    tries=$((${tries:-0} + 1))
    set_key "$item" tries "$tries"
    # Five tries (the next ticks retry), then the gate gives up on writing it; status still shows it.
    [ "$tries" -lt 5 ] || set_key "$item" reported "$state"
    echo "  warning: could not write the result to GitHub (try $tries; $ISTATE/gh.log)" >&2
  fi
}

# Deletes the remote in/ branch, only while it still points at the landed head.
delete_branch() {
  local item=$1 branch head
  branch=$(get "$item" branch) head=$(get "$item" head)
  if timeout 60 git -C "$MAIN" push -q --force-with-lease="refs/heads/$branch:$head" "$REMOTE" ":refs/heads/$branch" 2>>"$ISTATE/gh.log"; then
    git -C "$MAIN" update-ref -d "$NS/${branch#in/}" 2>/dev/null || true
    set_key "$item" deleted yes
  else
    echo "  warning: could not delete $branch on $REMOTE (a newer push?)" >&2
  fi
}

# --- one attempt ---------------------------------------------------------------------------------

# refuse <item> <reason> <Mongolian line> [<public reason>]
refuse() {
  local item=$1 reason=$2 reason_mn=$3
  set_key "$item" reason_mn "$reason_mn"
  set_state "$item" REFUSED "$reason" "${4:-}"
  echo "  REFUSED: $reason"
}

# Drops a task only when the books say the gate opened it (owners/<task>, written by task.sh): a copy
# named in-* that someone else made, with their work in it, is never touched.
drop_task() {
  local task=$1
  [ -n "$task" ] || return 0
  [ "$(cat "$STATE/owners/$task" 2>/dev/null)" = inbox ] || return 0
  bash "$BRAIN_DIR/task.sh" drop "$task" >/dev/null 6>&- || echo "  warning: could not drop $task" >&2
}

# The names of the steps check:fast found red (its «FAIL <time> <step>» lines), for GitHub.
failed_steps() {
  local steps
  steps=$(sed -nE 's/^FAIL +[0-9.]+s +(.*)$/\1/p' "$1" 2>/dev/null | head -n 5 | tr '\n' ',' | sed 's/,$//; s/,/, /g')
  [ -z "$steps" ] || printf ' (%s)' "$steps"
}

# Test hook (brain.test.mjs): the tick dies here, as a kill or a restart would stop it.
die_at() {
  [ "${BTO_INBOX_DIE_AT:-}" != "$1" ] || kill -9 $$
}

# The branch's commits as one commit in the task's copy, on top of origin/main: their messages in the
# body, their author kept, a trailer naming the branch. Returns 3 on a conflict, 4 when nothing is left.
squash_into() {
  local copy=$1 base=$2 head=$3 branch=$4 n first author date
  if ! git -C "$copy" merge -q --squash "$head" >>"$LOG" 2>&1; then
    CONFLICTS=$(git -C "$copy" -c core.quotePath=false diff --name-only --diff-filter=U | tr '\n' ' ')
    git -C "$copy" reset -q --hard HEAD
    return 3
  fi
  git -C "$copy" diff --cached --quiet && return 4
  n=$(git -C "$MAIN" rev-list --count --no-merges "$base..$head")
  first=$(git -C "$MAIN" rev-list --reverse --no-merges "$base..$head" | head -n 1)
  author=$(git -C "$MAIN" log -1 --format='%an <%ae>' "$head")
  date=$(git -C "$MAIN" log -1 --format='%aI' "$head")
  {
    if [ "$n" -le 1 ]; then
      git -C "$MAIN" log -1 --format=%B "${first:-$head}" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
    else
      git -C "$MAIN" log -1 --format=%s "$first"
      printf '\nSquashed from %s (%s commits):\n' "$branch" "$n"
      git -C "$MAIN" log --reverse --no-merges --format='%n* %s%n%n%b' "$base..$head" |
        sed -e 's/^\([^*]\)/  \1/' | cat -s
    fi
    printf '\nInbox-Branch: %s\nInbox-Head: %s\n' "$branch" "$head"
  } | git -C "$copy" commit -q --author="$author" --date="$date" -F - >>"$LOG" 2>&1
}

# land <item>: land.sh for its task; LANDED or REFUSED. Never pushes main itself.
land_item() {
  local item=$1 task out code sha live
  task=$(get "$item" task)
  echo "  landing $task through land.sh"
  set_key "$item" phase land
  set +e
  out=$(bash "$BRAIN_DIR/land.sh" "$task" 6>&- 2>&1)
  code=$?
  set -e
  printf '%s\n' "$out" >>"$LOG"
  die_at landed
  sha=$(printf '%s\n' "$out" | sed -nE 's/^LANDED ([0-9a-f]+) on main.*/\1/p' | tail -n 1)
  if [ -n "$sha" ]; then
    sha=$(git -C "$MAIN" rev-parse "$sha" 2>/dev/null || echo "$sha")
    set_key "$item" landed "$sha"
    case "$out" in
      *"about a minute (pages only)"*)
        live="On app.puljika.site in about a minute (pages only)."
        set_key "$item" live_mn "app.puljika.site дээр ~1 минутад гарна." ;;
      *"about five minutes"*)
        live="On app.puljika.site in about five minutes (a whole update)."
        set_key "$item" live_mn "app.puljika.site дээр ~5 минутад гарна." ;;
      *)
        live="Nothing is rebuilt (documents, tests, tools or the staff app's sources); the staff app reaches phones with its next APK."
        set_key "$item" live_mn "Дахин бүтээх зүйлгүй; утасны апп дараагийн APK-гаар очно." ;;
    esac
    # land.sh cleared the task (copy, branch, lane).
    set_state "$item" LANDED "$live"
    echo "  LANDED ${sha:0:8}"
    delete_branch "$item"
    return 0
  fi
  drop_task "$task"
  case "$code" in
    0) refuse "$item" "nothing new: main already has these changes" "шинэ зүйл алга, main-д аль хэдийн орсон" ;;
    3)
      refuse "$item" "it conflicts with main: rebase onto main ($(printf '%s\n' "$out" | sed -nE 's/^CONFLICT: .*Files: (.*)$/\1/p' | head -c 300))" \
        "main-тай зөрчилдөж байна; main дээр rebase хийгээд" ;;
    4)
      refuse "$item" "pnpm check:fast is red: $(tail -n 15 "$STATE/land-check.log" 2>/dev/null | tr '\n' ' ' | tr -s ' ' | tail -c 600)" \
        "pnpm check:fast улаан" \
        "pnpm check:fast is red$(failed_steps "$STATE/land-check.log"); details in the gate's log on the Bto PC" ;;
    *)
      refuse "$item" "the gate could not land it (land.sh exit $code): $(printf '%s\n' "$out" | tail -n 3 | tr '\n' ' ' | tail -c 300)" \
        "хаалга оруулж чадсангүй" \
        "the gate could not land it (land.sh exit $code); details in the gate's log on the Bto PC" ;;
  esac
  return 0
}

# check_item <item>: a GUARDED change is checked in its copy; green waits for the brain's review.
check_item() {
  local item=$1 task copy
  task=$(get "$item" task)
  copy="$WORK/$task"
  echo "  checking $task (pnpm check:fast)"
  set_key "$item" phase check
  : >"$LOG.check"
  if (cd "$copy" && nice -n 10 node tools/fast-check/check-fast.mjs --base HEAD~1) >"$LOG.check" 2>&1 6>&-; then
    cat "$LOG.check" >>"$LOG"
    rm -f "$LOG.check"
    set_state "$item" WAITING-REVIEW "checked green; waits for the brain's review"
    echo "  WAITING-REVIEW: bash $BRAIN_DIR/inbox.sh approve $(get "$item" branch)"
  else
    cat "$LOG.check" >>"$LOG"
    drop_task "$task"
    refuse "$item" "pnpm check:fast is red: $(tail -n 15 "$LOG.check" | tr '\n' ' ' | tr -s ' ' | tail -c 600)" "pnpm check:fast улаан" \
      "pnpm check:fast is red$(failed_steps "$LOG.check"); details in the gate's log on the Bto PC"
    rm -f "$LOG.check"
  fi
}

# attempt <name> <head>: everything for one head of in/<name>.
attempt() {
  local name=$1 head=$2 key item branch=in/$1 base files n task state old_head code out what
  key=$(key_of "$name")
  item="$ISTATE/items/$key"
  state=$(get "$item" state) old_head=$(get "$item" head)
  if [ "$old_head" = "$head" ] && [ "$DRY" = yes ] && [ "$state" != WAITING ]; then
    echo "$branch @ ${head:0:8}: already handled ($state)"
    return 0
  fi
  if [ "$old_head" = "$head" ]; then
    case "$state" in
      WAITING) ;; # its paths were held: try again
      LANDED) [ "$(get "$item" deleted)" = yes ] || [ "$DRY" = yes ] || delete_branch "$item"; return 0 ;;
      *) return 0 ;;
    esac
  fi
  echo "$branch @ ${head:0:8}"
  task="in-$name"
  if [ "$DRY" = no ]; then
    # A new push replaces the attempt before it (a task waiting for review is dropped).
    if [ -n "$old_head" ] && [ "$old_head" != "$head" ]; then
      [ "$state" != WAITING-REVIEW ] || echo "  replaces ${old_head:0:8}, which waited for review"
      drop_task "$(get "$item" task)"
      rm -f "$item"
    fi
    if [ "$old_head" != "$head" ] || [ ! -f "$item" ]; then
      printf 'branch=%s\nhead=%s\nstarted=%s\nstate=WAITING\nreason=taken by the gate\n' \
        "$branch" "$head" "$(date +%s)" >"$item.tmp"
      mv "$item.tmp" "$item"
    fi
    # Until the attempt reaches a state, a phase says a tick works on it; a tick that finds a phase
    # left over (the one before was killed) recovers it first (recover_stale).
    set_key "$item" phase open
  else
    item="$ISTATE/.dry-$key"
    printf 'branch=%s\nhead=%s\n' "$branch" "$head" >"$item"
  fi
  LOG="$ISTATE/logs/$key-${head:0:8}.log"
  [ "$DRY" = no ] || LOG=/dev/null

  if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]{0,36}$ ]]; then
    [ "$DRY" = no ] && refuse "$item" "the branch is in/<slug>: lower-case letters, digits and dashes, at most 37" "салбарын нэр буруу (in/<slug>: жижиг үсэг, тоо, зураас)"
    [ "$DRY" = no ] || echo "  would REFUSE: a bad branch name"
    report "$item"
    return 0
  fi
  if ! base=$(git -C "$MAIN" merge-base "$BASE_REF" "$head" 2>/dev/null); then
    [ "$DRY" = no ] && refuse "$item" "it is not on top of a commit of main's history: branch from origin/main" "main-ээс салбарлаагүй байна"
    [ "$DRY" = no ] || echo "  would REFUSE: not on top of main's history"
    report "$item"
    return 0
  fi
  if git -C "$MAIN" merge-base --is-ancestor "$head" "$BASE_REF"; then
    [ "$DRY" = no ] && refuse "$item" "nothing new: this head is already on main" "шинэ зүйл алга, main-д аль хэдийн орсон"
    [ "$DRY" = no ] || echo "  would REFUSE: already on main"
    report "$item"
    return 0
  fi
  mapfile -d '' -t files < <(git -C "$MAIN" -c core.quotePath=false diff -z --name-only --no-renames "$base" "$head")
  if [ "${#files[@]}" -eq 0 ]; then
    [ "$DRY" = no ] && refuse "$item" "no file changes" "өөрчлөлт алга"
    [ "$DRY" = no ] || echo "  would REFUSE: no file changes"
    report "$item"
    return 0
  fi
  classify "${files[@]}"
  n=$(git -C "$MAIN" rev-list --count "$base..$head")
  echo "  $n commit(s), ${#files[@]} file(s), from main ${base:0:8}"
  set_key "$item" files "${files[*]}"
  if [ -n "$REFUSALS" ]; then
    if [ "$DRY" = yes ]; then
      echo "  would REFUSE: guard rails:"
      printf '%s\n' "$REFUSALS" | sed 's/^/    /'
      return 0
    fi
    refuse "$item" "it changes the guard rails: $(printf '%s\n' "$REFUSALS" | head -n 5 | tr '\n' ';' | sed 's/;$//; s/;/; /g')" \
      "хамгаалалтын файл өөрчилсөн ($(printf '%s\n' "$REFUSALS" | cut -d: -f1 | head -n 3 | tr '\n' ' '))"
    report "$item"
    return 0
  fi
  set_key "$item" class "$CLASS"
  if [ "$DRY" = yes ]; then
    if [ "$CLASS" = light ]; then what="LIGHT: open task $task, squash, land.sh"; else what="GUARDED: open task $task, squash, check:fast, wait for the brain's approve"; fi
    echo "  would $what"
    printf '    %s\n' "${files[@]}"
    [ -z "$MIGRATIONS" ] || echo "    migration: $MIGRATIONS"
    suites_of "${files[@]}" | sed 's/^/    suites: /'
    return 0
  fi

  # A copy and the paths, through task.sh: refused while a running task holds one of them.
  [ ! -d "$WORK/$task" ] || drop_task "$task"
  set +e
  out=$(BTO_TASK_OWNER=inbox bash "$BRAIN_DIR/task.sh" new "$task" "${files[@]}" 6>&- 2>&1)
  code=$?
  set -e
  printf '%s\n' "$out" >>"$LOG"
  if [ "$code" -ne 0 ]; then
    if [ "$code" -eq 2 ]; then
      set_state "$item" WAITING "$(printf '%s\n' "$out" | grep ' is held by ' | head -n 3 | tr '\n' ';' | sed 's/;$//; s/;/; /g')"
    else
      set_state "$item" WAITING "the gate could not open a task: $(printf '%s\n' "$out" | tail -n 1)" \
        "the gate could not open its task yet; details in the gate's log on the Bto PC"
    fi
    echo "  WAITING: $(get "$item" reason)"
    report "$item"
    return 0
  fi
  set_key "$item" task "$task"
  die_at opened
  set +e
  squash_into "$WORK/$task" "$base" "$head" "$branch"
  code=$?
  set -e
  if [ "$code" -ne 0 ]; then
    drop_task "$task"
    case "$code" in
      3) refuse "$item" "it conflicts with main: rebase onto main (${CONFLICTS% })" "main-тай зөрчилдөж байна; main дээр rebase хийгээд" ;;
      4) refuse "$item" "nothing new: main already has these changes" "шинэ зүйл алга, main-д аль хэдийн орсон" ;;
      *) refuse "$item" "the gate could not make its commit ($LOG)" "хаалга commit хийж чадсангүй" \
        "the gate could not make its commit; details in the gate's log on the Bto PC" ;;
    esac
    report "$item"
    return 0
  fi
  if [ "$CLASS" = light ]; then
    land_item "$item"
  else
    check_item "$item"
  fi
  report "$item"
}

# The in/* branches of the remote into $NS (pruned): the names and heads, oldest push first.
fetch_inbox() {
  timeout 60 git -C "$MAIN" fetch -q --prune --no-tags "$REMOTE" "+refs/heads/in/*:$NS/*" ||
    { echo "warning: could not fetch the in/* branches of $REMOTE" >&2; return 1; }
}

heads() {
  git -C "$MAIN" for-each-ref --sort=committerdate --format='%(refname:lstrip=2) %(objectname)' "$NS/"
}

# A branch deleted on the remote takes its waiting attempt with it.
withdraw_gone() {
  local item branch state name
  for item in "$ISTATE"/items/*; do
    [ -f "$item" ] || continue
    state=$(get "$item" state)
    case "$state" in WAITING | WAITING-REVIEW) ;; *) continue ;; esac
    branch=$(get "$item" branch)
    name=${branch#in/}
    git -C "$MAIN" show-ref -q --verify "$NS/$name" && continue
    drop_task "$(get "$item" task)"
    set_state "$item" WITHDRAWN "$branch was deleted"
    echo "$branch: deleted on $REMOTE; its attempt is withdrawn"
  done
}

# An attempt a killed tick left behind (a phase and no state reached; the lock is ours, so no other
# tick works on it): when its head reached main (a commit with its Inbox-Head trailer), it finishes as
# LANDED; otherwise the gate's own task is dropped and the head is tried again.
recover_stale() {
  local item head name sha waited=no
  for item in "$ISTATE"/items/*; do
    [ -f "$item" ] || continue
    [ -n "$(get "$item" phase)" ] || continue
    head=$(get "$item" head)
    name=$(get "$item" branch)
    name=${name#in/}
    echo "$(get "$item" branch) @ ${head:0:8}: interrupted while «$(get "$item" phase)»; recovering"
    if [ "$waited" = no ]; then
      # A land.sh the killed tick started may still run (KillMode=process): let it finish first.
      exec 5>"$STATE/land.lock"
      flock -w 1800 5 || true
      exec 5>&-
      fetch_main
      waited=yes
    fi
    LOG="$ISTATE/logs/$(basename "$item")-${head:0:8}.log"
    echo "== $(date '+%F %T') recovered after an interrupted tick (phase $(get "$item" phase))" >>"$LOG"
    sha=$(git -C "$MAIN" log -1 --format=%H --grep="^Inbox-Head: $head\$" "$BASE_REF" 2>/dev/null || true)
    drop_task "in-$name"
    if [ -n "$sha" ]; then
      set_key "$item" landed "$sha"
      set_key "$item" live_mn "Шинэчлэлт өөрөө явна."
      set_state "$item" LANDED "On main; the real system takes it by itself (found after an interrupted tick)."
      echo "  LANDED ${sha:0:8}"
      delete_branch "$item"
      report "$item"
    else
      set_key "$item" task ""
      set_state "$item" WAITING "retried after an interrupted tick"
      set_key "$item" phase retry
      echo "  tried again"
    fi
  done
}

# Results not yet written to GitHub (it was offline) are tried again.
report_pending() {
  local item
  for item in "$ISTATE"/items/*; do
    [ -f "$item" ] || continue
    report "$item"
  done
}

lock_inbox() {
  exec 6>"$ISTATE/lock"
  if [ "${1:-}" = now ]; then
    flock -n 6
  else
    flock -w "${BTO_INBOX_LOCK_WAIT:-1800}" 6
  fi
}

# item_of <branch>: the record for in/<name> (or <name>).
item_of() {
  local name=${1#in/}
  [ -n "$name" ] || usage
  ITEM="$ISTATE/items/$(key_of "$name")"
  [ -f "$ITEM" ] || DIE_CODE=2 die "No attempt of in/$name is known (inbox.sh status)."
}

ago() {
  local s=$(($(date +%s) - ${1:-0}))
  if [ "$s" -lt 90 ]; then echo "${s} s"; elif [ "$s" -lt 5400 ]; then echo "$((s / 60)) min"; else echo "$((s / 3600)) h"; fi
}

cmd=${1:-}
shift || true
case "$cmd" in
  tick)
    [ "${1:-}" != --dry-run ] || DRY=yes
    if [ "$DRY" = yes ]; then
      NS=refs/inbox-dry
    elif [ "$REMOTE" != origin ]; then
      # land.sh always pushes to origin: branches from another remote are only ever looked at.
      DIE_CODE=64 die "BTO_INBOX_REMOTE=$REMOTE is for a dry run only (tick --dry-run)."
    elif ! lock_inbox now; then
      echo "another tick is running"
      exit 0
    fi
    fetch_main
    fetch_inbox || exit 0
    [ "$DRY" = yes ] || recover_stale
    while read -r name head; do
      [ -n "$name" ] || continue
      attempt "$name" "$head"
    done < <(heads)
    if [ "$DRY" = yes ]; then
      git -C "$MAIN" for-each-ref --format='%(refname)' "$NS/" | xargs -r -n 1 git -C "$MAIN" update-ref -d
      rm -f "$ISTATE"/.dry-*
      exit 0
    fi
    withdraw_gone
    report_pending
    # The last 50 attempts' logs.
    find "$ISTATE/logs" -name '*.log' -printf '%T@ %p\n' | sort -rn | tail -n +51 | cut -d' ' -f2- | xargs -r rm -f
    ;;
  approve)
    item_of "${1:-}"
    lock_inbox
    recover_stale
    [ "$(get "$ITEM" state)" = WAITING-REVIEW ] ||
      DIE_CODE=2 die "$(get "$ITEM" branch) is $(get "$ITEM" state), not WAITING-REVIEW."
    fetch_inbox || DIE_CODE=1 die "Could not fetch $REMOTE; nothing landed."
    now_head=$(git -C "$MAIN" rev-parse -q --verify "$NS/${1#in/}" || true)
    [ "$now_head" = "$(get "$ITEM" head)" ] ||
      DIE_CODE=2 die "$(get "$ITEM" branch) was pushed again (${now_head:0:8}); the next tick checks that head: review it instead."
    head=$(get "$ITEM" head)
    LOG="$ISTATE/logs/$(basename "$ITEM")-${head:0:8}.log"
    echo "== approved by the brain $(date '+%F %T')" >>"$LOG"
    land_item "$ITEM"
    report "$ITEM"
    [ "$(get "$ITEM" state)" = LANDED ] || exit 1
    ;;
  reject)
    item_of "${1:-}"
    shift
    [ "$#" -gt 0 ] || DIE_CODE=64 die "inbox.sh reject <branch> <reason>"
    lock_inbox
    case "$(get "$ITEM" state)" in
      WAITING | WAITING-REVIEW) ;;
      *) DIE_CODE=2 die "$(get "$ITEM" branch) is $(get "$ITEM" state); nothing to reject." ;;
    esac
    drop_task "$(get "$ITEM" task)"
    set_key "$ITEM" reason_mn "тархи татгалзсан: $*"
    set_state "$ITEM" REFUSED "the brain's review: $*"
    report "$ITEM"
    echo "REFUSED $(get "$ITEM" branch): $*"
    ;;
  retry)
    item_of "${1:-}"
    lock_inbox
    case "$(get "$ITEM" state)" in
      WAITING-REVIEW) DIE_CODE=2 die "$(get "$ITEM" branch) waits for review: approve or reject it." ;;
    esac
    drop_task "$(get "$ITEM" task)"
    rm -f "$ITEM"
    echo "forgotten: the next tick tries ${1} again"
    ;;
  status)
    any=no
    # Is a tick (or approve) running now? Then a phase is work under way; otherwise it was left by a
    # killed tick, and the next tick recovers it.
    running=no
    if ! flock -n "$ISTATE/lock" true 2>/dev/null; then running=yes; fi
    for item in $(ls -t "$ISTATE"/items/* 2>/dev/null); do
      [ -f "$item" ] || continue
      state=$(get "$item" state)
      phase=$(get "$item" phase)
      if [ -n "$phase" ]; then
        any=yes
        if [ "$running" = yes ]; then
          echo "IN PROGRESS  $(get "$item" branch) @ $(get "$item" head | cut -c1-8)  ($phase)"
        else
          echo "INTERRUPTED  $(get "$item" branch) @ $(get "$item" head | cut -c1-8)  (a tick was killed while «$phase»; the next tick recovers it)"
        fi
        continue
      fi
      case "$state" in WAITING | WAITING-REVIEW) ;; *) continue ;; esac
      any=yes
      branch=$(get "$item" branch) task=$(get "$item" task)
      echo "$state  $branch @ $(get "$item" head | cut -c1-8)  $(get "$item" class | tr a-z A-Z)  $(ago "$(get "$item" updated)")"
      echo "  files:  $(get "$item" files)"
      if [ "$state" = WAITING ]; then
        echo "  why:    $(get "$item" reason)"
      else
        echo "  copy:   $WORK/$task  (git -C $WORK/$task show HEAD)"
        mapfile -t f < <(get "$item" files | tr ' ' '\n')
        suites_of "${f[@]}" | sed 's/^/  suites: /'
        echo "  then:   bash $BRAIN_DIR/inbox.sh approve $branch   |   reject $branch \"<reason>\""
      fi
    done
    [ "$any" = yes ] || echo "Nothing waits in the inbox."
    if [ -f "$ISTATE/log" ]; then
      echo "last results:"
      tail -n 10 "$ISTATE/log" | sed 's/^/  /'
    fi
    ;;
  classify)
    [ "$#" -gt 0 ] || usage
    for path in "$@"; do
      why=$(guard_rail "$path")
      if [ -n "$why" ]; then echo "REFUSE  $path: $why"; else echo "$(class_of "$path" | tr a-z A-Z)  $path"; fi
    done
    classify "$@"
    if [ -n "$REFUSALS" ]; then echo "= REFUSED"; else echo "= $(echo "$CLASS" | tr a-z A-Z)"; fi
    ;;
  -h | --help | help | '') usage ;;
  *) usage ;;
esac
