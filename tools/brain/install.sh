#!/usr/bin/env bash
# Puts the brain where every Claude session on this PC finds it (ADR-0213): the workers'
# definitions in ~/.claude/agents, the brain's own rules as the skill `tarhi` in ~/.claude/skills,
# and git's merge of mn.json by key. Run it again after changing anything under tools/brain/.
#   bash tools/brain/install.sh
set -euo pipefail
# shellcheck source=tools/brain/lib.sh
. "$(dirname "$0")/lib.sh"

mkdir -p "$HOME/.claude/agents" "$HOME/.claude/skills/tarhi"
cp "$BRAIN_DIR"/agents/bto-*.md "$HOME/.claude/agents/"
cp "$BRAIN_DIR/skill/SKILL.md" "$HOME/.claude/skills/tarhi/SKILL.md"
ensure_merge_driver
echo "workers: $(ls "$HOME/.claude/agents" | grep '^bto-' | tr '\n' ' ')"
echo "skill:   $HOME/.claude/skills/tarhi/SKILL.md"
echo "tasks:   $WORK (books in $STATE)"
