# ADR-0247: Isolated, auditable six-month local QA history

Status: proposed; execution requires independent review and parent approval.
The existing accepted dataset is preserved during this code handoff; no new generation is authorized.

The owner requested a full review, fixes and realistic testing with exactly 500 grocery SKUs,
60 grouped fictional suppliers and six months of business history. Existing owner data must remain
intact. The dedicated local database is `bto_qa_six_month_20261124` on `127.0.0.1:15432`.
It is provisioned and migrated separately using normal migration tooling. The generator never
resets, drops or migrates a database and requires the normal `app` role. The operational
database, its environment and running services remain unchanged.

The period is June 1 through November 23, 2026: six calendar month groups, with an explicitly
partial November. Suppliers and customers are fictional, emails use `example.invalid` and no
invented real bank, taxpayer or telephone identities are supplied. The interface is visibly
marked as test data and served separately on local API3301/web5174.

All business transactions use normal authenticated HTTP workflows or existing public services
(admin CLI setup and inventory reconciliation). No direct business-table inserts, ledger balance
edits, constraint bypasses or rewritten posting/audit dates are allowed. Read-only independent SQL
reconciles source documents, stock movements/caches, journal entries and subledgers. The accepted
weighted-average costing method and purchase-discount accounting policy are unchanged.

Inventory posting and invoice creation intentionally use the business day rather than a supplied
document date. A dedicated seed process therefore installs a narrow logical-clock adapter after
checking the exact database, loopback host/port, `NODE_ENV=test` and explicit bootstrap flag. Only
default arguments of the shared business-date/year/month helpers and the result of the exact,
read-only `SELECT now() AS now` application-clock query use logical time. Explicit historical
instants retain their normal meaning, including POS sale/return timestamps. Every such SQL query
still executes normally; promise/callback and Drizzle array-row results are supported. All other
SQL, PostgreSQL clocks/defaults/guards and immutable `createdAt` remain real generation time.
The manifest records both this distinction and actual execution timestamps. Installation fails
closed and restores partial patches. Shutdown closes the app, restores adapters in `finally`
and removes the run lock. The later browse API runs with the real clock and no seed adapter.

The generator runs API modules only: no worker, cron processing, fiscal submissions, SMS/email,
printing or LLM calls. Its fresh environment contains no provider, admin or migrator secrets;
an additional process-local socket/fetch fence permits only the QA API and local PostgreSQL.
Operational environment files are never read. Generated QA authentication secrets stay in the private local
QA environment file; passwords and access/edge tokens do not appear in public reports.

Deterministic IDs and payload hashes, persisted pending/completed operations and idempotency keys
make the run resumable. Non-idempotent creations require unique recovery lookups; ambiguous
interrupted writes stop for inspection. Concurrent runs are refused. No broad retry duplicates
financial documents. The runner independently checks exact product/supplier counts, every month
having posted stock/sales/journal activity, balanced entries, stock cache/ledger agreement,
AR/AP/cash totals, price history, returns and normal service-generated daily stock snapshots.
The migrator must provision missing June–September snapshot partitions by normal DDL; these are
storage partitions, never fabricated history rows.

Historical HR salary-assignment guards that use the real PostgreSQL day remain enforced.
Unsupported backdated employee setup is reported honestly; normal current staff/payroll tests
and explicitly described monthly wage expenses can cover that area without claiming six months
of employee attendance or payroll. Expiry markdown loss tests must verify actual below-cost
sales and partial/full returns reverse the exact employee allocation without over-deduction.

The six-month purchase fixture contains ordinary paid receipt lines, without purchase discounts
or free-goods/bonus quantities. This is an explicit coverage limitation, not a claim that those
production workflows are unavailable. The separate receipt-discounts and receipts-prices
integration suites passed 6 and 12 assertions respectively on November 24, including discount
income and free-goods costing. Their native integration report is separate evidence, not synthetic
historical transactions. Completed historical payload hashes are not changed to fill this gap.

Markdown publication's `starts_at` remains PostgreSQL's real default. Consequently historical
expiry records cover review, receipt provenance and responsibility; they do not claim backdated
markdown sales. A separate actual-current-date regression fully restores the logical adapter
before any business operations, sells three below-cost units and returns one then two units.
Its independent loss/share/cash/stock/journal evidence is labelled outside June 1–November 23.
This keeps the database effectiveness guard intact and the historical claims honest.

Evidence includes a deterministic preview, pure guard/clock/checkpoint tests, the run manifest,
independent acceptance report, business-month counts and browseable QA UI. A populated database
alone is not an acceptance result: reconciliation and traces must pass or be reported as failed.


The tool must never run against the real system, on Windows or on the Ubuntu production host.
The allow-list is hard-coded to `127.0.0.1:15432/bto_qa_six_month_20261124` without URL query
or host overrides, reinforced by client/socket guards and server-side `current_database()` and
normal `app` role checks. A non-empty database without this tool's checkpoint is refused. No
platform exception permits another target. `--apply` requires explicit `--repo`; target/run-directory
checks precede any filesystem mutation, and a supplied `BTO_QA_DATABASE_URL` is checked before
reading files. Only a pre-provisioned tool-owned `qa.env` may supply credentials otherwise; the
application's `.env` is never consulted. The public default administrator is `qa-admin`; private
`BTO_QA_ADMIN_LOGIN` can identify an already existing QA account without changing it. Browse-only
startup requires that password-ready account and never creates or resets an administrator.
