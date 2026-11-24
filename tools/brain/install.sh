#!/usr/bin/env bash
# Puts the brain where every Claude session on this PC finds it (ADR-0213): the workers' and the
# reviewer's definitions in ~/.claude/agents, the brain's own rules as the skill `tarhi` in
# ~/.claude/skills, the guard as a PreToolUse hook in ~/.claude/settings.json, the team board's
# messages as a UserPromptSubmit hook (ADR-0248), git's merge of mn.json by key, the monitor's page as the user service bto-brain-monitor, the job desk's
# one-minute timer bto-brain-jobs (ADR-0229), the inbox gate's timer bto-brain-inbox (ADR-0242) and
# its automatic review's timer bto-brain-review (ADR-0249).
# Run it again after changing anything under tools/brain/.
#   bash tools/brain/install.sh
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"

mkdir -p "$HOME/.claude/agents" "$HOME/.claude/skills/tarhi"
cp "$BRAIN_DIR"/agents/bto-*.md "$HOME/.claude/agents/"
cp "$BRAIN_DIR/skill/SKILL.md" "$HOME/.claude/skills/tarhi/SKILL.md"
ensure_merge_driver

# The guard (guard.mjs) runs before every Bash command of every session. It points at the main
# checkout's copy, not a task's, so a task's copy can be thrown away. One entry however often this
# runs; every other setting is kept.
GUARD="$MAIN/tools/brain/guard.mjs"
node - "$HOME/.claude/settings.json" "$(command -v node) $GUARD" <<'JS'
const fs = require('node:fs');
const [file, command] = process.argv.slice(2);
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
settings.hooks ??= {};
const groups = (settings.hooks.PreToolUse ?? []).flatMap((group) => {
  const hooks = (group.hooks ?? []).filter((hook) => !String(hook.command ?? '').endsWith('tools/brain/guard.mjs'));
  return hooks.length === 0 && (group.hooks ?? []).length > 0 ? [] : [{ ...group, hooks }];
});
groups.push({ matcher: 'Bash', hooks: [{ type: 'command', command }] });
settings.hooks.PreToolUse = groups;
fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`);
fs.renameSync(`${file}.tmp`, file);
JS
# The team board (board.mjs, ADR-0248): every prompt of a Claude session here first shows the
# messages the other developer's AI left for «brain» (nothing when there are none or the board cannot
# be reached; at most a few seconds). One entry however often this runs.
BOARD="$MAIN/tools/brain/board.mjs"
node - "$HOME/.claude/settings.json" "$(command -v node) $BOARD inbox --hook --as brain --state $STATE/board" <<'JS'
const fs = require('node:fs');
const [file, command] = process.argv.slice(2);
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
settings.hooks ??= {};
const groups = (settings.hooks.UserPromptSubmit ?? []).flatMap((group) => {
  const hooks = (group.hooks ?? []).filter((hook) => !String(hook.command ?? '').includes('tools/brain/board.mjs'));
  return hooks.length === 0 && (group.hooks ?? []).length > 0 ? [] : [{ ...group, hooks }];
});
groups.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
settings.hooks.UserPromptSubmit = groups;
fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 2)}\n`);
fs.renameSync(`${file}.tmp`, file);
JS
[ -f "$STATE/board/me" ] || node "$BOARD" join brain --state "$STATE/board" >/dev/null
echo "workers: $(ls "$HOME/.claude/agents" | grep '^bto-' | tr '\n' ' ')"
echo "skill:   $HOME/.claude/skills/tarhi/SKILL.md"
echo "guard:   PreToolUse Bash → $GUARD (in $HOME/.claude/settings.json)"
echo "board:   UserPromptSubmit → board.mjs inbox --hook --as brain (node $BOARD status)"
echo "tasks:   $WORK (books in $STATE)"
# The monitor (monitor/serve.mjs): a read-only page of the brain's work on the LAN, port 3310.
# Restarted when already running, so that a changed serve.mjs is taken.
UNIT=bto-brain-monitor.service
mkdir -p "$HOME/.config/systemd/user"
cp "$BRAIN_DIR/monitor/$UNIT" "$HOME/.config/systemd/user/$UNIT"
if command -v systemctl >/dev/null && systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable -q "$UNIT" 2>/dev/null || echo "warning: could not enable $UNIT" >&2
  systemctl --user restart "$UNIT" 2>/dev/null || echo "warning: could not start $UNIT (journalctl --user -u $UNIT)" >&2
else
  echo "warning: systemctl --user is not available; start the monitor by hand: node tools/brain/monitor/serve.mjs" >&2
fi
LAN=$(hostname -I 2>/dev/null | awk '{ print $1 }')
echo "monitor: http://${LAN:-localhost}:3310"
# The job desk (job.sh, ADR-0229): a timer runs «job.sh tick» every minute, so a job that waits for
# a direct session's push or a `done` starts by itself. tick returns at once; a build it starts runs
# on in the background (KillMode=process).
mkdir -p "$HOME/.config/systemd/user"
for unit in bto-brain-jobs.service bto-brain-jobs.timer; do
  cp "$BRAIN_DIR/jobs/$unit" "$HOME/.config/systemd/user/$unit"
done
if command -v systemctl >/dev/null && systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable -q --now bto-brain-jobs.timer 2>/dev/null ||
    echo "warning: could not enable bto-brain-jobs.timer" >&2
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
    echo "warning: the timer runs only while you are signed in; once: sudo loginctl enable-linger $(id -un)" >&2
  fi
else
  echo "warning: systemctl --user is not available; run «bash tools/brain/job.sh tick» after a push" >&2
fi
echo "jobs:    bash tools/brain/job.sh status (timer bto-brain-jobs, every minute)"
# The inbox gate (inbox.sh, ADR-0242): a timer runs «inbox.sh tick» every 20 seconds, so a branch
# in/<slug> the second developer pushes is checked and landed (or written back) by itself.
for unit in bto-brain-inbox.service bto-brain-inbox.timer; do
  cp "$BRAIN_DIR/inbox/$unit" "$HOME/.config/systemd/user/$unit"
done
if command -v systemctl >/dev/null && systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable -q --now bto-brain-inbox.timer 2>/dev/null ||
    echo "warning: could not enable bto-brain-inbox.timer" >&2
else
  echo "warning: systemctl --user is not available; run «bash tools/brain/inbox.sh tick» by hand" >&2
fi
gh auth status >/dev/null 2>&1 || echo "warning: gh is not signed in; the inbox gate cannot write its results to GitHub" >&2
echo "inbox:   bash tools/brain/inbox.sh status (timer bto-brain-inbox, every 20 seconds)"
# The automatic review (inbox.sh review, ADR-0249): its own timer, every minute, one review at a time;
# never inside the tick. On unless turned off (inbox.sh auto off), which this leaves as it is.
for unit in bto-brain-review.service bto-brain-review.timer; do
  cp "$BRAIN_DIR/inbox/$unit" "$HOME/.config/systemd/user/$unit"
done
if command -v systemctl >/dev/null && systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable -q --now bto-brain-review.timer 2>/dev/null ||
    echo "warning: could not enable bto-brain-review.timer" >&2
else
  echo "warning: systemctl --user is not available; run «bash tools/brain/inbox.sh review» by hand" >&2
fi
echo "review:  bash tools/brain/inbox.sh auto status (timer bto-brain-review, every minute; $(bash "$BRAIN_DIR/inbox.sh" auto status 2>/dev/null | head -n 1))"
# The code graph (graph.sh): never installed or built from here; the build takes three minutes.
if ! command -v graphify >/dev/null && [ ! -x "$HOME/.local/bin/graphify" ]; then
  echo "graph:   graphify is missing; install it once with «uv tool install graphifyy»"
elif [ ! -f "$STATE/graph/src/graphify-out/graph.json" ]; then
  echo "graph:   no graph yet; build it once with «bash tools/brain/graph.sh update» (about three minutes)"
else
  echo "graph:   $STATE/graph (bash tools/brain/graph.sh status)"
fi
