# ADR-0048: One warehouse price per product, central price profiles and whole-pack splits

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Supersedes | ADR-0041 #1 (two lists of unit prices), #3 step 1 and the line result (a line is priced in parts), #6 for prices (a superseded unit's discount programs still stop), #7's `/unit-prices` routes. ADR-0041 #2, #4, #5 and #8 stand |
| Amends | ADR-0044 #3 (completion needs the warehouse price and a profile), #4 (`POST /product-prices`), #9 (the price dialog and the pending list's columns); ADR-0037 #2 (the product list's price and tax columns) |

## Context

On 2026-10-14 the owner described how prices are really set (three rounds of structured questions):

- **One entered price.** Each product gets one price, «Агуулахын үнэ», per base unit (a piece, or a kilogram for weighed goods), VAT included. A box costs the piece price × its count.
- **Central rules.** The other prices come from a named «Үнийн тохиргоо» chosen per product:
  - pieces that do not fill a whole pack pay a loose markup (a percentage);
  - the supermarket adds its own markup;
  - from N pieces of a product the supermarket charges a lower «супермаркет бөөний үнэ».
- **Mixed quantities split.** With a box of 20, 25 pieces are 1 box at the warehouse price and 5 loose pieces.
- **The whole pack** (block or box) is chosen per product. A product without packs always pays the warehouse price.
- **Rounding** is chosen per profile: whole tugriks, or up to a multiple of 10, 50 or 100₮.
- **Changes.** A profile's values change from a chosen day for every product using it, and the old values stay in the history.
- **Who.** Only admins create and change profiles. The price clerk enters the warehouse price and picks the profile and the whole unit.
- **Lists.** The product list keeps two price columns, the warehouse price and the profile. The supermarket price, VAT, city tax, БҮНА and tax code columns go.
- **Later.** Promotions, loyalty cards and vouchers/coupons come in later sessions, each after its own interview.

## Decision

1. **Price profiles** (`price_profiles`, `price_profile_versions`).
   - **Name.** A profile has a name, unique among live profiles.
   - **Dated versions** carry:
     - `loose_markup_pct` and `retail_markup_pct`, each 0–999.99;
     - an optional pair `retail_bulk_min_qty` (base units, > 0) and `retail_bulk_markup_pct`, the latter below the retail markup;
     - `rounding`: `WHOLE`, `UP_10`, `UP_50` or `UP_100`.
   - **Changes** start today or later and follow ADR-0041 #1's dated-row rules:
     - a change closes the version in force and inserts the new one up to the next planned change;
     - a version replaced on its first day is voided;
     - `EXCLUDE` blocks overlaps; a trigger lets only `valid_to` move, and only earlier; `app` may not delete.
   - **Archiving.** An archived profile cannot be chosen (`PRICE_PROFILE_ARCHIVED`). Archiving is refused while a price in force today or planned still uses the profile (`PRICE_PROFILE_IN_USE`).
   - **Access.** `pricing.manage` (admins) creates, changes, renames and archives profiles.
2. **Product price terms** (`product_prices`).
   - **The row.** Each product has dated rows of:
     - `warehouse_price`: whole MNT, VAT included, per base unit;
     - `profile_id`;
     - `whole_uom_id`: the unit of measure counted as whole; null when the product has no pack unit.
   - **Rules.** The rows follow the same dated-row rules and guards.
   - **Setting** (`POST /product-prices`, idempotent, `pricing.prices.manage`):
     - the profile must have a version in force from the chosen day;
     - a product with pack units must name its whole unit.
   - **Why a unit of measure.** The whole unit is kept as a unit of measure and resolved to the product's current unit of it (one per measure: `product_units_current_uom`). A box whose count changes therefore stays the whole unit, with no history rewritten.
3. **Base prices** come from pure functions in `@tugeel/shared/pricing`.
   - **Per base unit,** from the warehouse price W:
     - loose = W × (1 + loose %);
     - supermarket = W × (1 + retail %);
     - supermarket wholesale = W × (1 + bulk %).
   - **Rounding,** per the profile: `WHOLE` rounds HALF_UP to whole MNT; `UP_n` rounds up to a multiple of n.
   - **A unit's price** is the per-base price × its factor, HALF_UP to whole MNT.
   - **`WHOLESALE` channel.** A line's base quantity splits into whole packs (n × the whole unit at W) and the loose rest:
     - a line already in whole packs has no loose part;
     - the loose part stays in the line's unit when it divides evenly, else it is in base units;
     - with no whole unit, or one that is no longer current, everything is priced at W.
   - **`RETAIL` channel** (the supermarket). Every piece is priced at the supermarket price, or at the supermarket wholesale price once the product's quantity in the cart reaches the threshold.
4. **The quote.**
   - **Parts.** A line becomes up to two parts. Each part has a unit, a quantity, a basis (`WAREHOUSE`, `LOOSE`, `RETAIL`, `RETAIL_BULK`), a list price, a unit price, a subtotal, a discount, a total and the programs applied.
   - **Discounts.** ADR-0041 #3 steps 2–4 apply to parts:
     - product programs apply per part: a program for a unit reaches only parts in that unit, and a percentage without a unit reaches every part; thresholds count the product's quantity in the cart;
     - category and order programs work on the parts' amounts.
   - **Totals.** A line's totals are the sums of its parts. Orders will freeze the parts (`sales`).
5. **Completion** (amends ADR-0044 #3). A product can be completed only when:
   - its price terms and a profile version are in force today (Ulaanbaatar date);
   - its whole unit resolves.

   Otherwise the request is refused with `PRICE_MISSING`, naming each SKU.
6. **Migration 0019** (nothing is deployed, ADR-0026):
   - `unit_prices` and its views `ai.prices_today` and `ai.price_history` are dropped. Only test prices existed.
   - Complete products go back to waiting, each with an audited `RETURN` (reason `PRICE_MODEL_ADR_0048`). No placeholder profile is made, because markups are the owner's to set.
   - New views: `ai.price_profiles`, `ai.product_prices_today` and `ai.product_price_history`.
7. **Channels.** `WHOLESALE` / `RETAIL` stay as the sales channel of discount programs and quotes («Бөөний», «Супермаркет»).
8. **Screens** (amends ADR-0037 #2):
   - **Menu.** «Үнэ» holds «Үнийн тохиргоо», «Хямдралын тохиргоо» (the discount programs) and «Үнэ тооцоолох».
   - **Lists.** The product list and the pending list show «Агуулахын үнэ» and «Үнийн тохиргоо». The supermarket price, VAT, city tax, БҮНА code and tax code columns go; that data stays on the product and its e-Barimt card.
9. **API.**
   - `/price-profiles`: list, get, create, `POST :id/versions`, `PATCH :id`, `POST :id/archive`.
   - `/product-prices`: `?productId`, `/current?productIds`, `POST`.
   - `POST /pricing/quote`: each line carries `parts[]`.
   - `/unit-prices` is gone.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep own unit prices beside the profiles | The owner wants one entered price; a cheaper box is a discount program (a new price on the box unit) |
| One blended unit price for a mixed line | It is not whole MNT (ADR-0010); parts are also what e-Barimt lines need |
| Store the whole unit as a unit id | A supersede would have to rewrite history; a unit of measure survives it |
| Markups on each product | A markup change would be edited product by product; the owner wants one place |
| Migrate the test prices into a made-up profile | Percentages are business data only the owner can set |
| Rename `WHOLESALE` / `RETAIL` to a channel field | A rename across tables, API and views with no change in behaviour |

## Consequences

**Positive.**
- One number per product, and markups that change in one place on a chosen day.
- Mixed quantities are priced the way the owner sells.

**Negative.**
- Every product needs its warehouse price and profile again (dev data only).
- A quote line can have two parts, so orders and e-Barimt lines carry parts.
- `UP_100` can double the price of cheap goods; the profile screen previews it.
- A retired whole unit prices everything at the warehouse price until the clerk chooses again. The price card shows the problem and completion refuses.

**Follow-ups.**
- The price sheet import on this model (next session).
- `sales` freezing the parts.
- Promotions, loyalty cards, vouchers and coupons, each after an interview.
- An attention count for products whose whole unit no longer resolves.

## Related

ADR-0010, ADR-0037, ADR-0041, ADR-0044, ADR-0045, SPEC §5.6, §6.1, architecture §5.4, `docs/modules/pricing.md`.
