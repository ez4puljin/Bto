# ADR-0013: Background jobs with pg-boss, transactional enqueue, separate worker entrypoint

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

e-Barimt submission and monitoring, QPay payment checks, Excel imports, push and SMS, nightly reconciliation and snapshots, materialized-view refreshes and backups must run reliably without adding Redis or a cloud queue. A job that follows a business write must never be lost between the commit and the queue. Long jobs must not slow HTTP. The pg-boss major version was not covered by the stack research, so it is resolved on day 1, not guessed.

## Decision

1. **pg-boss stores jobs in PostgreSQL** (its own `pgboss` schema in the same database). **The major version is pinned on day 1** from the output of `npm view pg-boss version`; the resolved version, the date and the documentation URL for that major are written into CLAUDE.md's pin table. It is upgraded only in a dedicated session.
2. **Transactional enqueue (outbox semantics).** Any job that follows a business write is inserted through pg-boss's transaction-aware API inside the **same Drizzle transaction** as the write (`jobs.enqueue(tx, name, payload)` in `apps/api/src/common/jobs`). If the transaction rolls back, the job does not exist. Jobs that are not consequences of a write (cron) are scheduled by the worker.
3. **Worker entrypoint.** `src/worker.ts` starts pg-boss workers and cron schedules; it runs as a second container of the same image (`ROLE=worker`) from day one (ADR-0002). The `api` process only enqueues; it never runs job handlers. pg-boss pool `max` is 2 per process (ADR-0003).
4. **Job conventions.** Names are `<module>.<verb>`; the canonical registry is the module table in `docs/architecture.md` §4: `inventory.reconcile` (also writes `stock_snapshot_daily` in the same tx), `inventory.snapshotMonthly`, `inventory.staleReservations`, `imports.commit`, `ebarimt.issue`, `ebarimt.sendData`, `ebarimt.monitor`, `ebarimt.refreshReference`, `qpay.check`, `qpay.sweep`, `notifications.push`, `notifications.sms`, `reporting.refresh`, `backup.pgdump`. A new job name is added to that table before its handler is written. Handlers live in `src/modules/<module>/jobs/`. Retries with exponential backoff and explicit limits; singleton keys for per-document jobs (`ebarimt.issue:<receiptId>`); concurrency limits per queue; failures go to Sentry. Handlers are idempotent because pg-boss delivers at least once.
5. **No in-process event emitter** for state changes; cross-module reactions are direct service calls in the tx or enqueued jobs (ADR-0002).
6. Jobs that call external systems (PosAPI, QPay, SMS) do so outside any open database transaction and write results in a fresh, short transaction (ADR-0017).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| BullMQ + Redis | A second stateful service to run, back up and monitor; no transactional enqueue with the business write. |
| Cron inside the API process | Long jobs block HTTP; a crash loses the schedule. |
| Cloud queues (SQS-like) | Usage billing, no transactional enqueue, another credential. |
| `@nestjs/event-emitter` domain events | In-memory; lost on crash; hides ordering. |
| Deciding the pg-boss major now without checking | The research did not cover it; a stale pin would be a day-1 failure. |

## Consequences

**Positive.** No extra stateful service; a receipt or payment check can never be lost between commit and queue; long jobs are isolated from HTTP once the worker container exists.

**Negative.** The jobs table adds write load to the production database (acceptable at this volume); pg-boss polling consumes two of the budgeted connections per process; the worker container must be redeployed with the API.

**Follow-ups.** Day 1: `npm view pg-boss version`, pin, docs URL in CLAUDE.md. Delivery 1: `worker.ts`, `inventory.reconcile` (with the daily snapshot), `inventory.snapshotMonthly`, `backup.pgdump`, `imports.commit`.

## Related

ADR-0002, ADR-0003, ADR-0007, ADR-0015, ADR-0017, ADR-0018, `docs/architecture.md` §2, §3, §10, §11.
