# ADR-0007: Inventory as an append-only ledger with DB-enforced invariants and balance caches

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0024 ("from migration 0001" = from the inventory module's first migration), ADR-0033 (receipts into the shelf bin, costing after posting), ADR-0034 (posting protocol), ADR-0035 (transfers: receiver requests, differences back to the sender, legs 5/6) |

## Context

Stock accuracy under concurrent picking, approvals and stocktakes; auditability; AI-generated code that may be wrong; future lot tracking; goods on trucks and in transit that must stay accountable; stock valuation that must be correct for the supermarket (which only receives transfers) and for opening stock (which enters before procurement exists). Volumes: ~15k ledger rows/day, ~5M/year, 5-10 warehouses and vehicles, 10,000+ products.

## Decision

**Ledger.** `stock_ledger` (bigint identity, `posted_at`, `effective_date`, `warehouse_id`, `bin_id`, `product_id`, `lot_id NULL`, `qty_base NUMERIC(14,3) CHECK (<> 0)`, `unit_cost NUMERIC(14,4)`, `movement_type`, `doc_type NOT NULL`, `doc_id NOT NULL`, `doc_line_id NOT NULL`, `leg smallint`, `entered_qty`, `product_unit_id`, `factor_snapshot`, `created_by`). Append-only: `REVOKE UPDATE, DELETE ON stock_ledger FROM app` plus a `BEFORE UPDATE OR DELETE` trigger that raises. Idempotency: `UNIQUE (doc_type, doc_line_id, movement_type, leg)`. **Every movement belongs to a document**; postings without `doc_type`/`doc_line_id` are rejected. Written only by `StockPostingService.post(tx, doc, movements, options?)` (signature and step order in `docs/architecture.md` §5.3); a lint rule forbids importing the `stockLedger` table symbol outside `inventory/services/stock-posting.service.ts`.

**Balances** updated in the same transaction. `bin_stock` (warehouse, bin, product, lot): `on_hand CHECK (on_hand >= 0)`. `warehouse_stock` (warehouse, product, lot): `on_hand`, `sellable_on_hand`, `reserved`, `avg_cost`, with **only** `CHECK (on_hand >= 0 AND reserved >= 0)`. `available = sellable_on_hand - reserved`. Unique indexes on (…, `lot_id`) use `NULLS NOT DISTINCT` (ADR-0019). Bins have `type` (RECEIVING, STORAGE, PICKING, STAGING, SHIP, DAMAGED, RETURNS, TRANSIT, SALESFLOOR, CARGO), `sellable` (STORAGE/PICKING/SALESFLOOR true) and `status` (ACTIVE / COUNTING).

**Posting.** `post()` status-guards the document (`UPDATE … SET status='POSTED' WHERE id=$1 AND status='DRAFT'` must affect exactly one row), locks `warehouse_stock` rows `FOR UPDATE` ordered by (warehouse_id, product_id, lot_id) then `bin_stock` ordered by (warehouse_id, bin_id, product_id, lot_id), inserts ledger rows, applies deltas, enqueues follow-up jobs in the same tx. READ COMMITTED; no retries needed. Movements into a bin whose `status = 'COUNTING'` are rejected with `BIN_LOCKED_FOR_COUNT`.

**Reservations.** `stock_reservations` (warehouse level; `doc_type`, `doc_line_id`, `qty_base`, `status` ACTIVE/CONSUMED/RELEASED; partial unique on active). `ReservationService.reserve(tx, …)` checks `reserved + qty <= sellable_on_hand` **under the `warehouse_stock` row lock in application code**, not as a table CHECK, so shortages (count corrections, damage moves, transfers out) can still post. When a posting leaves `reserved > sellable_on_hand`, the affected CONFIRMED orders are flagged and listed in a **short/backorder list**. Pick confirmation is **one UPDATE** per `warehouse_stock` row that decrements `sellable_on_hand` and `reserved` together (`post()` accepts `options.reservationConsume`, which applies to the PICK_OUT movements). Pick confirmation consumes `qty_picked` and **releases the remainder** of the reservation; a nightly job releases ACTIVE reservations whose order is no longer in CONFIRMED/PICKING and reports them.

**Documents and movement types.** `goods_receipts` (GR-, RECEIPT into RECEIVING), `bin_moves` (BM-, `PUTAWAY_OUT/IN` and any storage-to-storage move; there is no document-less move), `transfers` (TR-, two-step through the TRANSIT warehouse), `adjustments` (ADJ-), `stocktakes` (ST-, `COUNT_CORRECTION`), pickings (`PICK_OUT` storage + `PICK_IN` STAGING), dispatch (`DISPATCH_OUT` STAGING/SHIP + `DISPATCH_IN` into the vehicle's **CARGO** bin), `DELIVERY_ISSUE` from VEHICLE or STAGING, `POS_SALE` from SALESFLOOR, `RETURN_IN` into RETURNS. Each warehouse auto-creates RECEIVING, STAGING, SHIP, DAMAGED, RETURNS; VEHICLE warehouses add CARGO; STORE adds SALESFLOOR. **Transfer receive** posts `TRANSFER_OUT TRANSIT` for the full shipped quantity and books any shortfall as an `ADJUSTMENT` at the destination RECEIVING bin, so TRANSIT returns to zero per line.

**Stocktake.** Starting a count sets the counted bins to `COUNTING` (movements blocked); expected quantities are frozen at that moment; approval posts `COUNT_CORRECTION = counted - frozen_expected` and returns the bins to ACTIVE in the same tx.

**Cost rules** in `StockPostingService`, per movement type: `RECEIPT` re-averages `avg_cost` (moving average); `TRANSFER_IN`, `DISPATCH_IN`, `RETURN_IN` carry the source row's `avg_cost` as `unit_cost`; positive `ADJUSTMENT` and `COUNT_CORRECTION` **require an explicit `unit_cost`** (default: current `avg_cost`; the opening-stock Excel template has a cost column, ADR-0015); outbound movements record the current `avg_cost`.

**Snapshots and reconciliation.** `stock_snapshot_daily` holds **warehouse-level, non-zero rows** nightly; `stock_snapshot_bin_monthly` holds bin-level rows on the first night of each month; both are **partitioned by month** from migration 0001 with 13 months retention. As-of bin stock = monthly snapshot + ledger delta. The nightly reconciliation (`SUM(ledger) EXCEPT balances`) runs in **one `REPEATABLE READ` transaction** and writes the daily snapshot in the same tx; drift creates a `reconciliation_runs` row, a Sentry alert and a red admin banner. `scripts/rebuild-balances.ts` regenerates caches from the ledger.

**Numbering.** `number_sequences (scope_key, period, last_value)` with a row lock, used by `NumberingService.next(tx, scopeKey, period)`; `scope_key` is a document type (`SO`, `GR`, `BM`, …) or a composite such as `BILLID:<pos_no>` for e-Barimt `billIdSuffix`, `period` a year or a Ulaanbaatar date. Numbers are assigned at SUBMIT/POST inside the posting tx (ADR-0002).

Posted documents are immutable; corrections are reversing documents.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Mutable quantity columns | No history, no idempotency, lost updates under concurrency. |
| Ledger only, SUM on read | O(n) availability on every quote at 5M rows/year. |
| Balances maintained by DB triggers | Hides logic from the agent and the owner; harder to test. |
| Event sourcing | Far more concepts than a non-engineer can maintain. |
| SERIALIZABLE with retries | Deterministic lock order under READ COMMITTED is simpler and sufficient. |
| `CHECK (reserved <= sellable_on_hand)` | Rejects legitimate shortage postings and forces a two-statement pick to violate it mid-transaction (CHECKs are not deferrable). |
| Issuing stock at pick | Truck and dock stock become invisible. |
| Bin-level daily snapshots | 7-15M rows/year, larger than the ledger. |
| Document-less put-away/bin moves | No idempotency key, no audit, double posting on retry. |

## Consequences

**Positive.** Invariants hold even when generated code is wrong; O(1) availability; as-of reports; truck, transit and counted stock are accountable; valuation is defined for every inbound path.

**Negative.** More concepts (no edit screens anywhere; every change is a document); the integrity suite (ADR-0016) is mandatory; `reserved > sellable` must be surfaced operationally rather than prevented.

**Follow-ups.** Delivery 1: ledger, balances, bins with `status`, `bin_moves`, snapshots, reconciliation, rebuild script. Delivery 2: reservations, short/backorder list, single-UPDATE pick, stale-reservation job. Delivery 5: CARGO bin flows.

## Related

ADR-0003, ADR-0008, ADR-0015, ADR-0016, ADR-0019, `docs/architecture.md` §5.1, §5.3, §5.6, §5.7, `docs/SPEC.md` §5, §6.
