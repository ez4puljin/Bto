# ADR-0033: Goods receipts land on their shelf and are costed after posting

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0007 (RECEIPT into RECEIVING; RECEIPT cost = supplier price), `docs/architecture.md` §5.3 (movement and cost tables, flows) |

## Context

The owner interview of 2026-10-11 describes receiving as it happens today:

- warehouse staff count the arriving goods and record them; they do not know the prices and must not see costs;
- the accountant enters the supplier's prices (ex-VAT) separately, usually the same day; corrections happen until the end of the following month;
- goods must be sellable as soon as they are counted, before the accountant has entered anything;
- goods go straight onto their fixed shelf, without a receiving-area wait; suppliers sometimes add free bonus goods;
- a product is stored only in its home wholesale warehouse; receiving it into another wholesale warehouse is refused.

ADR-0007 posted RECEIPT into the RECEIVING bin with the supplier price as `unit_cost`. Neither part fits: the price is unknown when the stock must appear, and RECEIVING is not sellable.

## Decision

1. **Destination bin.** A receipt line names its bin. The default is the product's fixed bin in that warehouse (`product_locations.default_bin_id`), otherwise the warehouse's RECEIVING bin; the scanner flow lets staff switch the bin by scanning a shelf label. RECEIPT posts straight into that bin; no put-away document is created. Put-away (`BM-`, PUTAWAY_OUT/IN) remains for goods left in RECEIVING.
2. **Where receipts are allowed.** Only into WHOLESALE warehouses (the store receives by transfer, SPEC §6.6). A product with a home warehouse may be received, or adjusted upward, only into that warehouse among the wholesale ones (`PRODUCT_NOT_IN_WAREHOUSE`); products without a home warehouse are not restricted. Count corrections are never refused by this rule.
3. **Provisional cost.** The RECEIPT ledger row carries the warehouse's current `avg_cost` as its `unit_cost`, so posting does not move the average. The receipt gets `costing_status = PENDING`; a product with no stock issues at cost 0 until it is costed.
4. **Costing.** A holder of `inventory.costs.manage` costs all lines of a posted receipt in one action: an amount per line (MNT, ex-VAT, two decimals; a price per entered unit is converted with `round(price × entered qty, 2)`) or "bonus" (free goods, amount 0). The request carries the receipt's current `costing_version`; a mismatch is a 409 conflict.
5. **Append-only history.** Posted lines are never updated. Each costing writes one `stock_valuation_adjustments` row per line and version (unique on line and version): amount, free flag, quantity, value before, delta, on-hand at costing, absorbed value, variance, average before and after, user and time. The receipt header keeps only `costing_status`, `costing_version` and `costed_at`. The table has the ledger's guards (REVOKE UPDATE, DELETE; append-only triggers) and only `StockPostingService` writes it.
6. **Coverage rule.** Per product of a costing, Δ = new amount − value before (the first time `round(qty × provisional cost, 2)`, later the previous amount). The part of Δ that belongs to goods still on hand moves the average: absorbed = Δ × min(Q, on_hand) / Q, `avg = round(avg + absorbed / on_hand, 4)`, never below 0; the rest is a recorded variance (cost of goods already gone). With nothing issued since the receipt this equals the exact moving average.
7. **Window.** The first costing is always allowed; a re-costing is allowed until the end of the month after the posting month (Ulaanbaatar dates), afterwards `COSTING_CLOSED`.
8. **Visibility.** Responses for users without `inventory.costs.manage` come from cost-free DTOs; no cost, amount, value or average leaves the API for them.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the receipt in DRAFT until the accountant prices it | Goods would be unsellable for hours; the owner wants them on sale at once. |
| RECEIPT into RECEIVING plus an automatic put-away `BM-` | Three ledger rows per line for no information; the shelf is known at counting. |
| `unit_cost` NULL until costed | Breaks the moving average and every value report in between. |
| Spread Δ over the stock on hand (`avg += Δ / on_hand`) | Pushes the difference of goods already sold onto the few left; overstates value. |
| Update the receipt lines with the final cost | Posted documents are immutable (SPEC §6.13 #3); the history would be lost. |

## Consequences

**Positive.** Stock appears the moment it is counted; the accountant's prices correct the valuation with a full history; warehouse staff never see costs.

**Negative.** Between posting and costing, issues carry the provisional cost; variances need a cost-of-goods report (delivery 10); valuation can no longer be recomputed from the ledger alone (the rebuild keeps existing averages). Ex-VAT costs assume the company is a VAT payer (SPEC §11 #3a).

## Related

ADR-0007, ADR-0010, ADR-0034, `docs/architecture.md` §5.3, `docs/modules/inventory.md`, `docs/SPEC.md` §5.4, §6.13.
