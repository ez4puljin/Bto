#!/usr/bin/env bash
# What auto-deploy.sh (ADR-0204) decides from the changed files and CI's word, without Git,
# Docker or GitHub.
#   bash deploy/store/auto-deploy.test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=deploy/store/auto-deploy.sh
. deploy/store/auto-deploy.sh --source-only

FAILS=0
expect() {
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected «$3», got «$2»"; FAILS=$((FAILS + 1)); fi
}

expect "nothing changed is nothing to do" "$(plan_update pending)" "none"
expect "docs alone move the checkout only" \
  "$(plan_update pending docs/ui.md CLAUDE.md .github/workflows/ci.yml)" "docs"
expect "code goes at once while CI runs" \
  "$(plan_update pending docs/ui.md apps/api/src/main.ts)" "deploy"
expect "code goes at once when CI cannot be asked" "$(plan_update unknown apps/api/src/main.ts)" "deploy"
expect "code CI found red is not put" "$(plan_update failure apps/web/src/main.tsx)" "refuse"
expect "a migration goes at once while CI runs (ADR-0206)" \
  "$(plan_update pending apps/api/src/db/migrations/0105_x.sql apps/api/src/db/schema.ts)" "deploy"
expect "a migration goes at once when CI cannot be asked" \
  "$(plan_update unknown apps/api/src/db/migrations/0105_x.sql)" "deploy"
expect "a migration goes when CI is green" \
  "$(plan_update success apps/api/src/db/migrations/0105_x.sql)" "deploy"
expect "a red migration is not put" "$(plan_update failure apps/api/src/db/migrations/0105_x.sql)" "refuse"
expect "the migrations' journal alone is code, not a migration" \
  "$(plan_update pending apps/api/src/db/migrations/meta/_journal.json)" "deploy"
expect "red docs still move the checkout" "$(plan_update failure docs/STATUS.md)" "docs"
expect "a run stopped by a newer push does not hold code back" "$(plan_update cancelled apps/api/src/a.ts)" "deploy"
expect "a migration whose run was stopped goes at once" \
  "$(plan_update cancelled apps/api/src/db/migrations/0105_x.sql)" "deploy"
expect "the office's pages alone build the web only" \
  "$(plan_update pending apps/web/src/features/finance/a.tsx docs/ui.md)" "web"
expect "the web with the shared package is a whole update" \
  "$(plan_update pending apps/web/src/a.tsx packages/shared/i18n/mn.json)" "deploy"
expect "the web's Dockerfile is a whole update" "$(plan_update pending apps/web/Dockerfile)" "deploy"
expect "red web pages are not put" "$(plan_update failure apps/web/src/a.tsx)" "refuse"
expect "the office's pages leave the tills alone" "$(needs_edge apps/web/src/features/a.tsx docs/x.md)" "no"
expect "the kiosk's pages rebuild the till server" "$(needs_edge apps/web/src/pos/sale.tsx)" "yes"
expect "the api rebuilds the till server" "$(needs_edge apps/api/src/main.ts)" "yes"
expect "docs leave the tills alone" "$(needs_edge docs/ui.md)" "no"

if [ "$FAILS" -gt 0 ]; then
  echo "$FAILS failed"
  exit 1
fi
echo "all passed"
