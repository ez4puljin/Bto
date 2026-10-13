# ADR-0040: Nightly jobs and retention

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Claude (Claude Code session), on the owner's request for the next cut-line items; the owner reviews the retention periods |
| Amends | — (carries out ADR-0007's snapshots and partitions, ADR-0013 #3–#4, ADR-0014 #4 for import sheets and ADR-0030 #4's cleanup job) |

## Context

SPEC §8.2 #5–#6 left the nightly pg-boss schedule (the reconciliation with its daily snapshot, the monthly bin snapshot, the partition upkeep) and the other background jobs below the cut line. Until now the reconciliation ran only by hand (`pnpm inventory:reconcile`); `stock_snapshot_bin_monthly` was never written; migration 0006 created the snapshot partitions for 2026-10 … 2028-09 only, and `app` cannot create or drop tables; nothing deleted old rows — sessions, one-time codes, idempotency keys, abandoned uploads, the rows of imports — and the bytes of deleted files stayed on disk although ADR-0030 #4 promised a cleanup job. The worker already ran pg-boss's cron (`schedule: true`), but nothing was scheduled. Until go-live the "server" is the owner's computer (ADR-0026), which is usually off at night.

## Decision

1. **Schedules in the worker, in Ulaanbaatar time.** A job handler may carry a cron expression; `JobWorkerService.register` writes its schedule every time the worker starts: `boss.schedule(name, cron, null, { tz: 'Asia/Ulaanbaatar', missed: 'once' })`. With `missed: 'once'` an occurrence that came due while no worker ran is sent once when one runs again; pg-boss counts the gap from its last cron pass and from the schedule's creation, so a new schedule owes nothing. Only the worker schedules and runs handlers (ADR-0013 #3).
2. **Four queues** in the job registry (architecture §4): `inventory.reconcile` daily at 03:00, `inventory.snapshotMonthly` at 03:30 on the 1st, `imports.housekeeping` daily at 04:00, `identity.housekeeping` daily at 04:30 (after the imports one, so the sheets it lets go lose their bytes the same night). Each queue: `exclusive` (one queued or running job), one retry after 10 minutes, a 30-minute expiry, a 60-second heartbeat, a job not started within a day dropped (the schedule catches up), 30 days of history. Handlers poll every 10 seconds and log counts only.
3. **inventory.reconcile** runs `StockPostingService.reconcile('NIGHTLY')` (D10): the run and the day's warehouse snapshot as before. A drift is logged as an error and shown to admins by the existing banner; the job itself succeeds (Sentry comes with go-live). The daily snapshot written at 03:00 on day D carries the date D: the balances at the start of D, give or take what moved after midnight.
4. **inventory.snapshotMonthly** first keeps the partitions: `maintain_stock_snapshot_partitions()` (migration `0012_nightly_jobs`) is a SECURITY DEFINER function owned by `migrator`, with a fixed `search_path`, without arguments and executable by `app` alone. It creates the missing monthly partitions of both snapshot tables from this Ulaanbaatar month to 24 months ahead, each refusing `app` DELETE and TRUNCATE like those of 0006, and drops the partitions of months more than 13 months back (ADR-0007: 13 months of history besides the current one). The inventory service holds an advisory lock around the call. Then the bin snapshot: `StockPostingService.snapshotBins(asOf)` writes every bin's balance at the start of the month's first day, summed from the ledger's movements dated before it, so a run days late (a caught-up one) is still exact; running a month again rewrites it, with a balance gone to zero written as 0 (`app` cannot delete snapshot rows).
5. **identity.housekeeping** (`HousekeepingService`, worker only) deletes sessions 90 days after they expired or were revoked (`users.last_login_at` keeps the last sign-in), one-time password codes 30 days after they expired, and idempotency keys 7 days after they were claimed (a key a crash left IN_PROGRESS is released then too). It retires upload slots nobody attached within 24 hours — a row whose bytes never arrived is deleted, one with bytes becomes DELETED — and then removes the bytes of every DELETED file and stamps the new `files.purged_at`; the row stays, because import jobs and product images still name it. Bytes are removed one file at a time outside any transaction (the Spaces driver will delete over HTTP).
6. **imports.housekeeping** (`ImportsHousekeepingService`) deletes the rows of imports refused (INVALID), failed or reverted, 90 days after their last change, and marks the job's summary `rowsPruned`; the import page then says so and keeps the counts. Committed imports keep their rows for the revert (ADR-0036 #7). A year after the upload (ADR-0014 #4) the sheet of a finished import (VALIDATED, INVALID, FAILED, COMMITTED or REVERTED; only the check reads a sheet) is marked DELETED through `StorageService.markDeleted`, and the summary says `sheetDeleted`. Import jobs themselves are never deleted.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Cron in the api process | ADR-0013 rejected it: long jobs block HTTP, a crash loses the schedule. |
| `missed: 'skip'`, pg-boss's default | On the owner's computer, off most nights until go-live, the jobs would almost never run. |
| One job for every missed occurrence | pg-boss sends one: it means "catch up to now", which is all the reconciliation and the housekeeping need. A month missed entirely loses that month's bin snapshot; the ledger still answers. |
| A new migration for partitions every two years | Easy to forget; the function keeps them ahead month by month. |
| Giving `app` CREATE on schema `public` | Widens what a compromised api could do; the definer function does this one thing. |
| A DEFAULT partition | Rows would land there silently and block creating that month's partition later. |
| The bin snapshot from `bin_stock` at run time | Exact only at the stroke of midnight; the ledger sum is exact whenever it runs. |
| Deleting the `files` rows of purged files | Import jobs and product images reference them; the row is small. |
| Keeping everything | Sessions and stored responses hold personal data and only grow. |

## Consequences

**Positive.** The reconciliation and the snapshots run by themselves; the partitions never run out; deleted files leave the disk; the tables of short-lived rows stay small. A night the computer was off is made up when the worker starts.

**Negative.** Until go-live the jobs run only while `pnpm dev` (the worker) runs, so a run often happens in the morning instead of at night. A month missed entirely has no bin snapshot. Four more queues poll every 10 seconds.

**Follow-ups.** Sentry on a drift and on failed jobs, and `backup.pgdump` (go-live, ADR-0026); `inventory.staleReservations` with the reservations (delivery 2); the Spaces driver's delete (go-live).

## Related

SPEC §8.2 #5–#6; ADR-0007, ADR-0013, ADR-0014, ADR-0026, ADR-0030, ADR-0036; architecture §4, §5.3 (D9, D10), §11; `docs/modules/inventory.md`, `docs/modules/identity.md`, `docs/modules/imports.md`.
