# Six-month local QA history

The existing accepted QA history must be retained. Publishing these tools does not authorize
re-running the generator; this handoff validates only isolated fake unit tests.

This source can land before its optional execution prerequisites. It has no startup hook and does
not import the compiled application until the explicitly enabled runtime is called. Execution
requires the separately delivered expiry commerce and supplier/location pricing features, their
reserved migrations, and an up-to-date compiled application. The runtime checks required visible
schema, including expiry sale allocations, before starting the application or creating business
data; missing prerequisites cause refusal. Source publication and fake unit results do not
establish execution readiness or authorize changing the accepted local history.

This is an isolated, fictional grocery business dataset for a review of Bto. The populated operational
database is never a target. The dedicated target name is
`bto_qa_six_month_20261124`, on `127.0.0.1:15432` only.

The catalogue has exactly 500 SKUs, 60 suppliers in 20 supplier departments and 80 customers.
Fifty products use kilograms; every SKU has distinct valid synthetic product/carton barcodes and
consistent carton factors. Names resemble ordinary groceries; company identities and transactions
are fictional. No real phone, taxpayer, registration or bank account IDs are fabricated.

The business history covers June 1 through November 23, 2026: six calendar month groups, with
November honestly partial. The planned operations use supported business services. A narrowly
scoped process-only logical business clock is needed because stock posting normally takes the
database transaction time. The synthetic business dates are distinct from honest generation/audit
`createdAt` timestamps. PostgreSQL clocks, defaults, schema and guards are not changed. The ordinary
API used to browse the finished dataset runs without the logical clock.

Preview the deterministic catalogue without touching the application or database:

```powershell
& '<node.exe>' tools/qa-six-month/plan.mjs --json
& '<node.exe>' --test tools/qa-six-month/dataset.test.mjs
```

The execution runner requires a fresh properly provisioned and migrated QA database, isolated local
ports and a private durable run manifest. External providers, SMS, email, fiscal submissions,
imports from other systems and background workers are excluded. The parent records migration
count/hash under the migrator; the runner uses only app-visible schema checks, never migration
metadata grants.

The tool must never target the real system, including the Ubuntu host. The same exact loopback
QA URL, client checks, outbound fence and server database/role checks apply on every OS; a different
host, port, database or URL override is refused. The Windows launchers are optional local wrappers,
not installation instructions for the real host.

Execution requires an explicit `--repo` with `--apply`. Pre-provision only the tool-owned
`.data/local-dev/qa-six-month/qa.env`, or supply `BTO_QA_DATABASE_URL` with the exact allowed QA URL.
An explicitly supplied URL is validated before any file is read; a pre-provisioned QA file is read
only after validating the explicit checkout, database and run directory, and its URL is validated
before any directory creation or application bootstrap. The tool never reads `apps/api/.env`.
The QA administrator defaults to `qa-admin`; an existing nondefault QA administrator must be named
by `BTO_QA_ADMIN_LOGIN` in the private QA environment. Publishing this code does not modify that
file or rename any existing account. Changing fictional display names in source does not rewrite
accepted operation payloads or hashes, and is not permission to rerun the accepted dataset.

After independent review and explicit execution approval, use Node and built API dependencies
from the explicit checkout (`--repo`), with the reviewed runner file:

```powershell
$env:BTO_QA_PASSWORD = '<private QA-only password>'
& '<node.exe>' '<reviewed-checkout>/tools/qa-six-month/run.mjs' --repo '<installed-checkout>' --apply --database bto_qa_six_month_20261124 --through 2026-06-01
# Continue the same checkpoint after reviewing first-day evidence:
& '<node.exe>' '<reviewed-checkout>/tools/qa-six-month/run.mjs' --repo '<installed-checkout>' --apply --database bto_qa_six_month_20261124
```

`--catalogue-only` stops after catalogue setup and reports `CATALOGUE_ONLY`, never acceptance.
`--through` permits a partial first-day/month smoke and reports `PARTIAL_PASSED` only when its
independent checks pass. Final acceptance requires all 176 days and all checks, producing
`.data/local-dev/qa-six-month/acceptance.json`. Neither a populated database nor a successful
process exit is evidence of final acceptance unless the report says `accepted: true`.

The workflow creates 360 completed supplier purchase orders and costed receipts, monthly stock
transfers to both stores, 704 wholesale invoices, 1,056 ordinary POS tickets plus weekly and
expiry review records, customer and supplier settlements, 30 operating-expense vouchers, and normal
service-generated daily snapshots. Each month's 15th has a historical expiry review with source
receipt and assigned responsibility. PostgreSQL deliberately gives markdown publication its real
start time, so historical below-cost publication/sales are not fabricated.
Monthly wage vouchers are explicitly expenses; historical staff attendance/payroll is not claimed.

The six-month receipt fixture uses ordinary paid lines: it does not create purchase discounts or
free-goods/bonus quantities. The independently observed receipt-discount and free-goods counts
are zero, so this dataset must not be presented as six-month promotional-purchase coverage.
Those behaviors have separate integration coverage in
`apps/api/test/integration/receipt-discounts.int-spec.ts` (6 assertions) and
`apps/api/test/integration/receipts-prices.int-spec.ts` (12 assertions), including line/note
discount order, discount income, free-goods costing and percentage/amount allocation. All 18
assertions passed in the actual November 24 integration run, recorded in
the private historical integration evidence; these tests are distinct
from the historical fixture. Completed operation payloads are never rewritten to add scenarios.

After historical acceptance, run the separate actual-current-day expiry regression. It removes
the logical clock before any business work, sells three genuinely below-cost units from the
November receipt, then returns one and two units. `expiry-current-acceptance.json` checks exact
employee-loss reversal, zero net cash and global stock/journal consistency. These actual-current-day
facts are clearly outside June 1–November 23 and never claimed as historical transactions:

```powershell
& '<node.exe>' '<reviewed-checkout>/tools/qa-six-month/run-current-expiry.mjs' --repo '<installed-checkout>' --apply --database bto_qa_six_month_20261124
```

The independent SELECT-only report compares ledger quantities with both stock caches and daily
snapshots; every journal's debits/credits; allocations/open items/cache/GL AR and AP; cash/bank
books; source invoice/POS revenue; source stock cost/COGS; expenses/profit; price history; and
expiry allocation reversals. A mismatch stays visible as `FAILED`; the runner never repairs it.

The seed API always closes and restores its logical clock and network fence. Start the ordinary
browse API separately with `qa.env`, without this runner, then Vite5174 with API3301 and
`VITE_QA_LABEL='Туршилтын мэдээлэл · 2026.06–11'`.

Every pending operation durably records its logical business instant before the write. A resumed
day advances to its highest recorded instant before replaying or starting any action, so returning
completed checkpoints cannot move a new stock posting behind an earlier posting.

Cash/bank screens intentionally total live vouchers. Existing policy records owner capital and
supplier payments as separate manual journals; the acceptance report reconciles the voucher book
to live voucher documents, then bridges those totals and the documented manual movements to the
full GL. Price coverage checks accept unchanged prices carried into later months.
