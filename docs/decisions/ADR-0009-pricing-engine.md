# ADR-0009: Pricing engine: effective-dated, non-overlapping price rules resolved by a pure function and frozen at SUBMIT

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

Multi-tier price lists, per-customer contract prices and quantity breaks must be explainable to shops and immutable for accounting and e-Barimt (`docs/SPEC.md` §6). Price lists live in spreadsheets today. Two concurrent writers (a diff import and a manual edit) can create overlapping active rules; a cart in the customer app can sit for days, so a price frozen at DRAFT may come from a rule that no longer applies when the order is submitted. Gap-free document numbers must not be wasted on abandoned drafts.

## Decision

1. **Prices exist only in the pricing module**; products have no price columns. `price_lists` (`kind` BASE/TIER/CONTRACT/PROMO/RETAIL, `customer_id` for CONTRACT, `channel`, `priority`, validity). `price_rules` (`price_list_id`, `product_id NULL` = list-wide, `product_unit_id NULL` = any unit, `min_qty_base NUMERIC(14,3)`, `price NULL`, `discount_pct NULL`, `applies_to_contract` default false, `valid_from`, `valid_to NULL`, `superseded_by`). Prices are MNT, tax-inclusive, per product unit.
2. **Rules are never updated.** A change sets `valid_to` and `superseded_by` on the old row and inserts a new one. Excel import is a diff with preview (ADR-0015).
3. **Overlap is impossible by constraint.** With `btree_gist` (ADR-0003): `EXCLUDE USING gist (price_list_id WITH =, coalesce(product_id, 0) WITH =, coalesce(product_unit_id, 0) WITH =, min_qty_base WITH =, daterange(valid_from, valid_to, '[)') WITH &&)`. A concurrent import and edit cannot both succeed; the loser gets 409 `PRICE_RULE_OVERLAP`.
4. **Precedence** (resolver in `packages/shared/pricing`, pure, table-tested): CONTRACT > TIER > PROMO > channel default (POS -> RETAIL) > BASE (mandatory for every sellable unit). Within a list: product-specific beats list-wide; unit-specific beats any-unit (`DERIVED` = base-unit price x factor when a unit has no rule); the highest qualifying `min_qty_base` wins, quantities summed per product across the order in base units. Percentage rules compose onto the next fixed price; `applies_to_contract = false` keeps discounts off negotiated prices; at most one discount rule applies (priority, then larger discount). **Fixed-price tie-break** when two rules still qualify: latest `valid_from`, then highest `id`. The resolver returns `{ unitPrice, listPrice, discountPct, ruleId, priceSource, vatRate, cityTaxRate, explanation }`.
5. **Unit prices are rounded HALF_UP to whole MNT** before freezing (ADR-0010).
6. **Freeze at SUBMIT.** Order lines carry a quote during DRAFT but `OrdersService.submit` **re-runs the resolver** and freezes `unit_price`, `list_price`, `discount_pct`, `price_rule_id`, `price_source`, `vat_rate`, `city_tax_rate`. If CONFIRM happens more than 24 hours after SUBMIT the resolver runs again and a changed price sends the order back to SUBMITTED for review. **The SO number is allocated at SUBMIT** (ADR-0007 numbering); drafts carry only the bigint id. Invoice numbers are allocated in the invoice-creating transaction (ADR-0017 for receipts).
7. **Manual discounts** need `sales.discount_manual`, are capped per role, and above the cap flip the order to APPROVAL_PENDING. Clients never compute prices; they call `POST /pricing/quote` with the whole cart.
8. Supersede of a product unit re-creates its active rules on the new unit (ADR-0008).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Price columns on products with ad-hoc discounts | No history, no contract prices, no scheduled changes. |
| Mutable rows with a change log | History reconstructed from logs instead of being the data. |
| Stacking discounts | Unexplainable to shops; contract prices silently eroded. |
| Client-side pricing | Three implementations of one rule set. |
| A rules engine | Another language for the owner; the table-driven resolver covers the requirements. |
| Freeze at DRAFT | Stale prices after days in a cart; SO numbers wasted on abandoned drafts. |
| Application-level overlap check only | Races between import and manual edit. |

## Consequences

**Positive.** Full price history and scheduled changes for free; disputes explained by `explanation`; deterministic resolution under concurrency; no gaps from drafts.

**Negative.** `coalesce(…, 0)` in the exclusion constraint must be mirrored in the resolver's matching logic; the re-quote at CONFIRM can surprise a rep when a price changed overnight (it is shown as a diff, not silently applied). Promotions such as "buy X get Y" are a later stage.

**Follow-ups.** Delivery 2: tables, constraint, resolver with table tests, quote endpoint, SUBMIT freeze, diff import.

## Related

ADR-0003, ADR-0007, ADR-0008, ADR-0010, ADR-0015, ADR-0016, `docs/architecture.md` §5.4, §5.6, `docs/SPEC.md` §6.
