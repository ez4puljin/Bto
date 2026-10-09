# ADR-0016: Testing strategy: isolated real-Postgres integration tests plus a mandatory integrity suite

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0024 (decision 2: per-worker databases are cloned from one migrated template) |

## Context

The dangerous bugs live in SQL, locks, constraints and rounding, not in TypeScript types. The AI agent needs an objective definition of done that the owner does not have to verify by reading code. Jest runs test files in parallel workers; tests that share one database while deliberately exercising concurrent postings, row locks and gap-free sequences would deadlock or interfere, and a flaky suite trains the agent to weaken tests or add retries. The hand-edited database guards (ADR-0003, ADR-0007) can be lost by a wrong migration without any test noticing unless a test asserts they exist.

## Decision

1. **Frameworks.** Jest + Supertest for `apps/api`; Vitest for `apps/web` and `packages/*`; `jest-expo` smoke tests for `apps/mobile`; Playwright smoke on the admin once sales exists. `pnpm check` runs all of it (ADR-0001).
2. **Isolation rule.** Integration tests run against a freshly migrated `postgres:18` (docker-compose locally, service container in CI; never the managed cluster). **One database per Jest worker**: `globalSetup` creates `${TEST_DB}_w${JEST_WORKER_ID}` and migrates it once; tables are truncated between files. Each database is created with the same ICU UTF-8 collation as production and the harness asserts `lower('ӨҮЁ') = 'өүё'` before any test runs.
3. **Integrity suite** in its own Jest project (`apps/api/test/integrity`), run with `--runInBand` and `statement_timeout = 5s` so deadlocks fail fast and loudly. **It may never be skipped and never retried**: `jest.retryTimes` and `--retries` are banned on this project (CLAUDE.md NEVER list). Cases:
   - two concurrent postings over the same stock rows (deterministic lock order, both succeed, balances correct);
   - overdraw rejection (`on_hand >= 0`);
   - idempotent re-post of the same document line (unique index);
   - bin-move net-zero;
   - **`reserve()` never oversells under concurrency** (N parallel reservations against one `warehouse_stock` row);
   - **concurrent order confirmations never pass the credit check twice** for one customer (row lock on `customers`, `customer_balances` consistent);
   - **stocktake during picking**: a pick against a bin in `COUNTING` fails with `BIN_LOCKED_FOR_COUNT`, and the approved correction equals counted minus frozen expected;
   - short-pick releases the reservation remainder;
   - **ledger guards exist**: as role `app`, `UPDATE stock_ledger` and `DELETE FROM stock_ledger` fail, and the trigger is present (`pg_trigger`);
   - transfer receive zeroes TRANSIT per line;
   - supersede keeps barcode, price and default flag (ADR-0008);
   - Σ payments = document total = Σ sub-receipt totals (ADR-0010);
   - submission log, logger output and Sentry breadcrumbs never contain `lottery` / `qrData` (ADR-0017).
4. **Integration tests** for every service that touches stock or money: the integrity cases above plus service-level tests for every posting, pricing, invoicing and payment path (`docs/architecture.md` §10.4).
5. **Pure unit tests** (table-driven): unit conversion, pricing resolver incl. fixed-price tie-break, state machines, tax split, text normaliser, GTIN normaliser.
6. **Contract tests** against recorded sandbox responses for QPay and PosAPI (fixtures under `apps/api/test/fixtures/<provider>/`, scrubbed of `lottery`/`qrData` before being committed), so provider code can be verified without live credentials.
7. A test that fails is fixed at the cause; weakening an assertion requires an ADR or a comment that cites one.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Mock-heavy unit tests | The bugs are in SQL and locks; mocks cannot find them. |
| Shared test database with parallel workers | Deadlocks and false failures in exactly the tests that matter. |
| Transaction-rollback isolation per test | Cannot exercise real concurrency or `FOR UPDATE` across connections. |
| Retrying flaky tests | Hides the concurrency bugs the suite exists to catch. |
| Exhaustive end-to-end UI tests | Slow, brittle; smoke tests plus service-level integration cover the risk. |
| Manual testing only | Not repeatable across 12+ sessions by an agent. |

## Consequences

**Positive.** Far fewer production incidents; the agent can self-verify; lost guards are detected by CI; concurrency behaviour is specified by executable cases.

**Negative.** CI takes minutes; the per-worker database setup is some harness code in delivery 1; owner-visible "red" runs must be fixed, not ignored.

**Follow-ups.** Delivery 1: harness, first integrity cases (postings, overdraw, idempotency, bin move, guards, stocktake lock). Delivery 2: reservation and credit cases. Delivery 3: totals and lottery-leak tests, contract fixtures.

## Related

ADR-0001, ADR-0003, ADR-0007, ADR-0008, ADR-0009, ADR-0010, ADR-0017, ADR-0018, `docs/architecture.md` §10, §12.
