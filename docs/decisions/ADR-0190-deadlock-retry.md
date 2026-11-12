# ADR-0190: A transaction that PostgreSQL ends to break a deadlock is run again

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «Тийм, зас», after the load test's finding), Claude (the direct-mode session) |
| Amends | ADR-0002 #8 (what `inTransaction` promises), architecture §5.3 (lock order is still the rule; this is what happens when two flows nevertheless meet) |

## Context

The load test of 2026-11-13 (a scratch copy of the dev database, documents written through the real HTTP path) moved 20 000 orders from draft to sale with 36 clients over nine api processes, sharing 300 products and 200 customers. 1 128 of them (5.6 %) were answered HTTP 500: PostgreSQL had ended their transaction with `deadlock_detected` (SQLSTATE 40P01), 902 times by the server's log, at the CONFIRM move, the pick and the SALE move. The cycles ran through three kinds of rows that these flows take in different orders: the `warehouse_stock` rows of the order's products, the `customers` row the credit check locks, and the one row of `fin.number_counters` a posting numbers its document from.

Nothing was damaged: a deadlock's victim is rolled back whole, and afterwards no stock was negative and the inventory, receivables and Finance Core reconciles were clean. With one api process and its pool of six, as the real system runs, 330 orders met none. But the user of the losing transaction sees «Internal error» and must press again, and the more people move orders with shared customers and products at once, the likelier it gets. The stock writers' own lock order is tested (`stock-mixed-races.spec.ts`); the order across customer, stock and number counter is not one rule today.

## Decision

1. **`inTransaction` runs its work again when the transaction was ended by a deadlock** (`apps/api/src/common/db/transaction.ts`): only SQLSTATE 40P01, found through the error's `cause` chain; up to four attempts in all, with a short uneven wait between them; every other error, a business refusal included, goes to the caller at once as before. After the last attempt the deadlock is the caller's error, as it was.
2. **So a transaction's work may run more than once, and must be written for it.** It may not count or collect into anything outside itself: it returns its outcome and the caller counts. The 433 transaction callbacks of the api were scanned for it (pushes and adds into outer collections, `+=`, `++`, writes to `this.…`): one counted outside (`WorkforceService.importEmployees`) and now returns what it did; one sets a key in a map, which a second run repeats harmlessly. The rule already in force keeps the rest safe: no HTTP call inside a transaction (TX_GUARD), side effects as jobs enqueued in the same transaction, notifications sent by PostgreSQL at commit.
3. **A nested call is not run again.** Inside another transaction `inTransaction` is a savepoint and a deadlock has ended the outer transaction too; the error passes up to the outermost `inTransaction`, which runs the whole work again.
4. **The retries are counted** (`transactionStats.deadlockRetries`, per process) and PostgreSQL logs each deadlock with its statements: a number that grows is the signal to fix an order of locks, not to raise the attempts.
5. **Lock order stays the rule** (architecture §5.3). One order across the customer's row, the stock rows and the number counter for the order moves is a follow-up of its own; this decision makes the meeting harmless, it does not remove it.
6. **The pool is not enlarged.** The same test showed that more connections per process add concurrent transactions, and with them deadlocks, without adding speed: the api is bound by its one thread, not by the database.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Leave it: the user presses again | A real sale answered «Internal error» is a call to the developer every time, and the retry the user does by hand is the same work. |
| One global advisory lock around every order move | Removes these deadlocks and serialises every move in the company; other writers (receipts, the tills' replay, adjustments) would still meet the same rows. |
| Fix the lock order first, no retry | The right long-term work, but every new flow can bring a new cycle; the retry is the net under all of them. |
| Retry at the HTTP layer | The request's side effects outside the transaction (idempotency keys, rate limits) would run twice. |
| Also retry serialization failures (40001) | Nothing runs above READ COMMITTED on a hot path today; a caller that asks for a stricter level decides its own retry. |

## Consequences

**Positive.** The «Internal error» of a lost deadlock disappears for the user; the same load that failed 5.6 % of its orders finishes them; the fix is in one function that all 424 callers already use.

**Negative.** A transaction's work can run up to four times: a callback that counts outside itself would count wrong, which is now a rule to keep in review (the scan is `tmp/load-test/audit-tx-callbacks.cjs`, not yet a lint). A retried request is slower by the lost attempt and the wait. A real lock-order bug is quieter than before: it shows in the counter and in PostgreSQL's log, not in a user's report.

**Follow-ups.**
- One lock order for the order moves (customer, then stock, then the number counter) and a race suite that covers customer and counter with stock.
- The retry counter on the server panel.
- The scan of outer effects as an ESLint guard.

## Related

ADR-0002, ADR-0120, architecture §5.3 and §12, `apps/api/src/common/db/transaction.ts`, `apps/api/test/integrity/deadlock-retry.spec.ts`, `apps/api/test/integrity/stock-mixed-races.spec.ts`, `docs/STATUS.md` (the load test of 2026-11-13).
