# ADR-0019: Lot/expiry readiness without implementation

| | |
|---|---|
| Status | Deferred (schema readiness in delivery 1; feature in a later session) |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0024 ("from migration 0001" = from the inventory module's first migration) |

## Context

Lot and expiry tracking is not required now (`docs/SPEC.md` §2), but the owner expects it may become necessary (perishables, FEFO picking, excise-stamped goods with `stockQR` on e-Barimt items). Adding a lot dimension later to a ledger with millions of rows would mean rewriting every unique index, every balance table and every posting path. Nullable columns and `NULLS NOT DISTINCT` indexes (PostgreSQL 15+) make the dimension additive at near-zero cost (ADR-0007).

## Decision

1. From migration `0001`: a `lots` table (`id`, `product_id`, `lot_no`, `expiry_date NULL`, `supplier_ref`, `created_at`), initially empty; a nullable `lot_id` on `stock_ledger`, `bin_stock`, `warehouse_stock`, `stock_reservations`, `stock_snapshot_daily`, `stock_snapshot_bin_monthly` and every document line table (`goods_receipt_lines`, `bin_move_lines`, `transfer_lines`, `adjustment_lines`, `stocktake_lines`, `picking_lines`, `sales_order_lines`, `pos_sale_lines`, `delivery_return_lines`).
2. **All unique indexes that include `lot_id` are declared `NULLS NOT DISTINCT`** (`bin_stock (warehouse_id, bin_id, product_id, lot_id)`, `warehouse_stock (warehouse_id, product_id, lot_id)`, the active-reservation partial unique), so a NULL lot behaves as one "no lot" bucket and balances cannot split. The deterministic lock order in `StockPostingService` already includes `lot_id` (ADR-0007).
3. `products.tracks_lots boolean default false`. Pick-bin selection sits behind a `PickStrategy` interface with one implementation now (FIFO by `pick_sequence`); FEFO (`expiry_date` ascending) is a second implementation later.
4. **Enabling lots** for a product = set `tracks_lots = true`, require a lot on receipts and positive adjustments for that product (validation in `ReceiptsService`/`AdjustmentsService`), switch the strategy, add lot capture to the staff-app receiving screen. **No backfill**: existing stock stays in the NULL lot and is consumed first or re-lotted by an adjustment pair.
5. e-Barimt item `data.lotNo` / `stockQR` fields are populated from `lots` when the product tracks lots (ADR-0017).
6. Reporting views (`v_stock_valuation`, movement history) group by `lot_id` from the start, so enabling lots changes no view definitions; an `expiry_date`-based "expiring stock" report is added in the activation session.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Add lot columns later | Rewrites ledger indexes, balance tables and every posting path under load. |
| `lot_key text NOT NULL DEFAULT ''` | Also viable; a nullable FK with `NULLS NOT DISTINCT` is cleaner for joins to `lots` and reads naturally in SQL. |
| Implement lots now | Scope the owner has not asked for; adds screens and validation to delivery 1. |

## Consequences

**Positive.** Zero cost now beyond one column per table; one later session adds lot capture, FEFO and lot-aware reports; no migration of historical rows.

**Negative.** Every unique index on balances must remember `NULLS NOT DISTINCT` (checked by the integrity suite's idempotent re-post case); a few nullable columns carry no data for a while.

**Follow-ups.** Delivery 1: columns and indexes; `PickStrategy` interface in delivery 2. Later session: FEFO, lot capture, expiry report.

## Related

ADR-0003, ADR-0007, ADR-0017, `docs/architecture.md` §5.3, `docs/SPEC.md` §2, §10.
