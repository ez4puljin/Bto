# ADR-0034: The stock posting protocol: lock order, NULL-safe keys, several documents per posting

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0007 (posting steps), `docs/architecture.md` §5.3 (`post()` signature and steps) |
| Amended by | ADR-0035 (transfer legs 5/6, the `TR` document, `allocateNumber`, chunked statements); ADR-0056 (#5: `ExternalPostingDoc` for `SO` / `PK` documents, neither locked nor numbered by `post()`; `reservationConsume` by document lines in the same warehouse UPDATE) |

## Context

Before building `StockPostingService` (delivery 1 week 3) a design review of architecture §5.3 found gaps that would corrupt stock silently or deadlock under load:

- the lock step matches rows with `(warehouse_id, product_id, lot_id) IN (…)`, which matches nothing while `lot_id` is NULL — every row of delivery 1 — so nothing would be locked;
- document lines read before the header is locked can change before the status guard runs, leaving a posted line without a ledger row;
- a stocktake start could freeze expected quantities while a posting into the same bins is in flight;
- the transfer receive of week 4 posts a transfer and its shortfall adjustment together, which one-document `post()` cannot do;
- number allocation holds the sequence row lock until commit.

## Decision

1. **Lock order, one direction everywhere.** (1) the document header: the guarded `UPDATE … SET status = next WHERE id = $1 AND status = expected`, or `SELECT … FOR UPDATE` for actions that do not post; (2) the document lines, read only after that; (3) the bins of the movements, `SELECT … ORDER BY id FOR SHARE`, refusing COUNTING (`BIN_LOCKED_FOR_COUNT`) and archived bins (`BIN_ARCHIVED`); (4) missing cache rows, only for keys that receive stock, in one sorted `INSERT … ON CONFLICT DO NOTHING`; (5) `warehouse_stock` `FOR UPDATE` ordered by warehouse, product, lot; (6) `bin_stock` `FOR UPDATE` ordered by warehouse, bin, product, lot; (7) ledger, valuation and audit inserts; (8) the document number, last. A stocktake start locks its bins `FOR UPDATE` in id order before setting them COUNTING, so it serialises against postings that hold them `FOR SHARE`. Re-costing locks the receipt header, then the `warehouse_stock` rows; it never touches bins or `bin_stock`.
2. **NULL-safe keys.** Cache and ledger keys are matched through a `VALUES` list joined with `IS NOT DISTINCT FROM`; the number of locked rows must equal the number of distinct keys. Unique keys that contain `lot_id` are `UNIQUE NULLS NOT DISTINCT`.
3. **Signature.** `post(tx, { docs: [{ docType, docId, expectedStatus, nextStatus }], movements }, options?)`: one call per transaction, any number of documents, zero movements allowed (a count without differences). Deltas are summed per key before the check; a missing cache row on an outbound key is `STOCK_INSUFFICIENT`. A duplicate on the idempotency index `stock_ledger_idem` is `ALREADY_POSTED`. A transfer's receive uses legs 3 and 4 so ship and receive never share a key.
4. **Time.** `posted_at`, `effective_date` and the number period come from one `now()` per posting, converted to the Ulaanbaatar date and year; no back-dating.
5. **Documents of other modules.** The status guard covers inventory's own documents only. A module that owns a stock document (sales pickings, POS sales, delivery trips) runs its own guarded UPDATE in the same transaction and then calls `post()` with its movements.
6. **Ledger reads live with the writer.** Movement history, reconciliation and the cache rebuild sit in `stock-posting.service.ts`, the only file that may import `stockLedger` (ESLint G2). The ledger, the valuation history and the partitioned snapshot tables have hand-written DDL; their Drizzle objects live in `modules/inventory/ledger.schema.ts`, which the schema aggregator does not export, so G2 needs no exception.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep `IN (…)` with a sentinel lot id instead of NULL | Spreads a magic value through every table and the reservations of delivery 2. |
| SERIALIZABLE with retries | ADR-0007 already rejected it; one deterministic order is simpler. |
| One `post()` call per document in a transaction | Two calls can insert cache rows in different orders and deadlock; a transfer receive needs one. |
| Export `stockLedger` from the aggregator and exempt it from G2 | Weakens a guard that CLAUDE.md forbids weakening. |

## Consequences

**Positive.** Every posting path takes locks in one order; NULL lots behave as one bucket; transfers and their adjustments post atomically.

**Negative.** Hand-written DDL for the ledger, valuation and snapshot tables must be kept in step with their Drizzle objects (integration tests write and read every column); drizzle-kit does not see those tables.

## Related

ADR-0007, ADR-0016, ADR-0019, ADR-0024, ADR-0033, `docs/architecture.md` §5.3, `docs/modules/inventory.md`.
