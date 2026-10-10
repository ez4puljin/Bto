# ADR-0008: Base-unit storage with factor snapshots and a single supersede service

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0029 (#1: `barcode_type` moves to each barcode, plus a primary barcode per unit) |

## Context

Products are sold as piece, block and box with per-unit barcodes and prices (`docs/SPEC.md` §6). Unit-conversion mistakes are the classic inventory failure. A unit's factor can change (the supplier re-packs 24 to 20 per box), and a changed factor must not rewrite history. Barcodes, default-unit flags and price rules are attached to a `product_units` row; if superseding a unit orphans them, barcode lookups resolve to a dead unit and the new unit has no price (`PRICE_MISSING`). Weight-based items may come later.

## Decision

1. **Exactly one base unit per product** (`product_units.is_base = true`, usually "ш" piece). Other units carry `factor_to_base NUMERIC(18,6)`, `is_default_sales`, `is_default_purchase`, e-Barimt `measure_unit`, `barcode_type`, `superseded_by`, `superseded_at`.
2. **Ledger, balances, reservations and price breaks are in base units** (`NUMERIC(14,3)`). Every document line stores `entered_qty`, `product_unit_id`, `factor_snapshot` and the derived `qty_base`. History is self-describing even after a factor changes.
3. **Conversion is a pure function** in `packages/shared/units` (`toBase(enteredQty, factor)`, `fromBase(qtyBase, factor)`), used identically by API, web and mobile; it never reads the database.
4. **Factors are never edited.** A factor change goes through **one service**, `UnitSupersedeService.supersede(tx, unitId, { factorToBase, … })`, which in a single transaction: inserts the new unit row; sets `superseded_by`/`superseded_at` on the old row; **re-points every active barcode** in `product_barcodes` to the new row; **moves `is_default_sales` / `is_default_purchase`** to the new row; and calls `PriceRulesService.reissueForUnit(tx, oldUnitId, newUnitId)`, which for every ACTIVE `price_rules` row keyed on the old `product_unit_id` closes it (`valid_to = now`, `superseded_by`) and inserts an identical rule on the new unit (ADR-0009). Import re-runs keyed on SKU + unit code resolve to the active row.
5. **`BarcodeService.resolve(code)` excludes superseded units** and returns `{ product, unit }` for the active row only; GTIN-8/12/13/14 inputs are normalised before lookup (ADR-0006).
6. Open documents that reference a superseded unit keep their `factor_snapshot`; new lines use the active unit. A superseded unit cannot be chosen in any picker.
7. The test "supersede keeps barcode, price and default flag" is a case of the integrity suite (ADR-0016, `docs/architecture.md` §10.4).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| INTEGER base quantities | Blocks fractional and weight-based items later. |
| Store quantities in the entered unit | Every aggregation needs a join and a conversion; availability becomes ambiguous. |
| Editable factors with a change log | History silently reinterpreted; past documents change meaning. |
| Keep unit ids stable and version only the factor in a `product_unit_factors` table | Viable, but every line would still need the factor snapshot and two tables would need to agree; superseding the row is simpler to explain. |
| Let each dependent (barcodes, prices) handle supersede on its own | The orphaning bug this ADR exists to prevent. |

## Consequences

**Positive.** Exact conversions for integer pack factors; fractional units possible later; superseding is one call with one test.

**Negative.** Four quantity columns per line; the supersede service touches three modules' tables through their services (catalog owns units and barcodes, pricing owns rules), so it is coordinated by catalog calling `PriceRulesService.reissueForUnit(tx, oldUnitId, newUnitId)` rather than touching `price_rules` directly (ADR-0002 boundary rule).

**Follow-ups.** Delivery 1: units, barcodes, `supersede` without the pricing step; delivery 2: pricing step added, test extended.

## Related

ADR-0006, ADR-0007, ADR-0009, ADR-0010, ADR-0015, ADR-0016, `docs/architecture.md` §4 (catalog), §5.2.
