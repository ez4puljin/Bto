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
expect "after a rollback the api's code is still to build" \
  "$(left_behind apps/api/src/a.ts apps/web/src/b.tsx docs/c.md | tr '\n' ' ')" "apps/api/src/a.ts "
expect "pages already built leave nothing behind" \
  "$(left_behind apps/web/src/pos/sale.tsx apps/web/src/b.tsx README.md | tr '\n' ' ')" ""
expect "the web's Dockerfile is left behind by a pages-only update" \
  "$(left_behind apps/web/Dockerfile | tr '\n' ' ')" "apps/web/Dockerfile "

# What no image is built from (ADR-0215).
expect "an integration test alone rebuilds nothing" \
  "$(plan_update pending apps/api/test/integration/pos/tills.int-spec.ts)" "docs"
expect "the test harness alone rebuilds nothing" "$(plan_update pending apps/api/test/harness/apps.ts)" "docs"
expect "an api unit test alone rebuilds nothing" \
  "$(plan_update pending apps/api/src/modules/inventory/services/a.service.spec.ts)" "docs"
expect "an api .test.ts would be compiled into the image" \
  "$(plan_update pending apps/api/src/modules/a.test.ts)" "deploy"
expect "an .int-spec.ts under the api's src would be compiled into the image" \
  "$(plan_update pending apps/api/src/modules/a.int-spec.ts)" "deploy"
expect "a test with its source file is the source's update" \
  "$(plan_update pending apps/api/test/integration/a.int-spec.ts apps/api/src/modules/a.service.ts)" "deploy"
expect "a shared package's test alone rebuilds nothing" \
  "$(plan_update pending packages/shared/src/pricing/a.test.ts packages/fin-contract/src/b.test.ts)" "docs"
expect "a shared package's .spec.ts would be compiled" "$(plan_update pending packages/shared/src/a.spec.ts)" "deploy"
expect "tools alone rebuild nothing" "$(plan_update pending tools/brain/land.sh tools/lint-guards/guards.test.mjs)" "docs"
expect "ci alone rebuilds nothing" "$(plan_update pending ci/rehearse.sh)" "docs"
expect "a deploy test alone rebuilds nothing" "$(plan_update pending deploy/store/auto-deploy.test.sh)" "docs"
expect "a deploy script is a whole update" "$(plan_update pending deploy/store/auto-deploy.sh)" "deploy"
expect "red tests still move the checkout" "$(plan_update failure apps/api/test/integration/a.int-spec.ts)" "docs"
expect "a test under the web alone is docs, not web" "$(plan_update pending apps/web/src/features/a.test.tsx)" "docs"
expect "a web test with a page is the pages' update" \
  "$(plan_update pending apps/web/src/features/a.test.tsx apps/web/src/features/a.tsx)" "web"
expect "the web's test setup is a page file" "$(plan_update pending apps/web/src/test/setup.ts)" "web"
expect "the staff app's sources alone rebuild nothing" \
  "$(plan_update pending apps/mobile/src/orders/a.tsx apps/mobile/variants.json apps/mobile/scripts/a.test.mjs)" "docs"
expect "the staff app's package.json is a whole update" "$(plan_update pending apps/mobile/package.json)" "deploy"
expect "the staff app's tsconfig is a whole update" "$(plan_update pending apps/mobile/tsconfig.json)" "deploy"
expect "a package.json under tests is still a whole update" "$(plan_update pending apps/api/test/package.json)" "deploy"
expect "the lockfile is a whole update" "$(plan_update pending pnpm-lock.yaml)" "deploy"
expect "a kiosk test leaves the tills alone" "$(needs_edge apps/web/src/pos/x.test.tsx)" "no"
expect "an api test leaves the tills alone" "$(needs_edge apps/api/test/integration/a.int-spec.ts tools/x.sh)" "no"
expect "the staff app leaves the tills alone" "$(needs_edge apps/mobile/src/a.tsx)" "no"
expect "the staff app's package.json rebuilds the till server" "$(needs_edge apps/mobile/package.json)" "yes"
expect "tests and tools are not left behind" \
  "$(left_behind apps/api/test/a.int-spec.ts tools/x.sh apps/api/src/a.spec.ts apps/mobile/src/a.ts | tr '\n' ' ')" ""

# The images install their dependencies from the manifests alone, before the code is copied (the
# install layer is reused while they stay the same): every workspace package.json must be copied there.
for dockerfile in apps/api/Dockerfile apps/web/Dockerfile; do
  for manifest in $(git ls-files 'package.json' '*/package.json' | grep -v node_modules); do
    dir=$(dirname "$manifest")
    if [ "$dir" = . ]; then want="COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./"
    else want="COPY $manifest $dir/"; fi
    if grep -qxF "$want" "$dockerfile"; then found=yes; else found=no; fi
    expect "$dockerfile copies $manifest before the install" "$found" "yes"
  done
done

if [ "$FAILS" -gt 0 ]; then
  echo "$FAILS failed"
  exit 1
fi
echo "all passed"
