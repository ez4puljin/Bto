# ADR-0207: Price profiles count the supermarket's prices the way Erxes does

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «Erxes дээрхи бараануудын үнийн тохиргоог bto-д хуулж оруулах … erxes посоор зарж буй үнэ bto-edge зарагдах ширхгийн болон бөөний үнэ бөөндөө орох үнэ адилхан байх ёстой»), Claude (Claude Code session) |
| Amends | ADR-0048 #1 and #3 (a profile's values and how they derive the supermarket's prices) |

## Context

The supermarket sells through Erxes' POS today, and the till server (ADR-0067) must sell at the same prices. Erxes prices the till of «Мөрөн-P.O.S» from the product's unit price (Bto's warehouse price: equal for 12,793 of 12,813 matched products on 2026-11-17) with its pricing plans:

- a **priority plan per tag group** adds a percentage (−11 %, −10 %, −7 %) or an amount (−1,000₮) and rounds the result with `floor` or `ceil` to 10₮ or 100₮;
- a **bulk plan per group** takes a percentage off from a quantity on (2 % from 3 pieces, 9 % from 2, 4 % from 8 …), on top of the priority plans' price, and rounds it on its own (mostly `floor` to 10₮, the yoghurt `ceil` to 100₮).

Erxes' percentages are whole tugriks (`Math.floor(price × pct / 100)`), so its `floor` first goes up to a whole tugrik. The engine was copied from Erxes' source and checked against the till's sales of 2026-11-10 … 17 (10,978 lines: every line whose product price had not changed since matched).

A Bto profile could not say that: its rounding is one for all its prices and goes only up, its bulk price is a markup on the warehouse price, and it has no amount.

## Decision

1. **Roundings `DOWN_10`, `DOWN_50`, `DOWN_100`.** Up to a whole tugrik, then down to a multiple of n; the whole tugrik itself when that leaves nothing (as ADR-0159 #7 keeps a price above zero).
2. **Roundings per price.** `rounding` stays the loose price's and the default; `retail_rounding` is the supermarket price's, `retail_bulk_rounding` the bulk price's (null: the one above). Profiles made before keep one rounding for all.
3. **The bulk price as a discount.** `retail_bulk_discount_pct` (0 < % < 100) takes the bulk price off the supermarket price, in place of `retail_bulk_markup_pct`; a threshold has exactly one of the two.
4. **An amount.** `retail_markup_amount` (whole tugriks, default 0) is added to the supermarket price after its percentage, and to a bulk price set by markup.
5. **Where it counts.** `perBasePrices` of `@tugeel/shared/pricing` does it for the api, the web's previews and the till server (whose snapshot carries the new values only when a profile uses them, so other snapshots keep their version); `ai.product_prices_today` repeats it in SQL (migration `0106_price_profiles_erxes`).
6. **Erxes' groups become profiles,** one per group, named as in Erxes; its sales and fixed prices for single products become RETAIL discount programs (`PRICE`, with a step at the bulk quantity where there is one).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A retail price per product, copied from Erxes | Exact today but stale at the next warehouse price; the owner's model is one warehouse price and profiles (ADR-0048). |
| 13,000 `PRICE` programs | The same staleness, and a snapshot that large for every till. |
| Change the meaning of `retail_bulk_markup_pct` | Two profiles in use count with it. |
| Repeat Erxes' floating-point slips | One product of 13,089 (513319: 9,700 × 1.07 counted as 10,380) differs by 10₮; Bto counts exactly. |

## Consequences

**Positive.** The till server's supermarket and bulk prices follow the warehouse price as Erxes' did; the owner keeps editing groups in «Үнийн тохиргоо».

**Negative.** A profile has more to read: the form shows the amount, the bulk mode and the two roundings.

**Follow-ups.** Erxes' plans and Bto's profiles are now kept twice until the supermarket leaves Erxes.

## Related

ADR-0048, ADR-0067, ADR-0098, ADR-0159, ADR-0160, `docs/modules/pricing.md`.
