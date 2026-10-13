# ADR-0041: One price per list, dated unit prices and stacked discount programs

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Supersedes | ADR-0009 #1 (price lists), #3 (rule overlap), #4 (precedence, one discount), #7 (manual discounts); ADR-0008 #4 (prices re-issued on supersede). ADR-0009 #2 (never updated), #5 (whole MNT), #6 (freeze at SUBMIT) stand |

## Context

ADR-0009 planned BASE, TIER, CONTRACT, PROMO and RETAIL lists, per-customer contract prices, quantity breaks, at most one discount per order line and manual discounts capped per role. Before building pricing (delivery 2), the owner was interviewed on 2026-10-13 (SPEC §11 #5, #9, #18):

- **Prices.** Every customer pays the same price. The supermarket has its own prices. Some products have a separate, cheaper box price, others are simply "piece × count". There is no fixed price list today. Whether some prices exclude VAT is for the accountant; until then every price includes it.
- **Discount triggers.** Discounts come from three things: the quantity of one product, a category's total (counted in boxes for some categories, in tugriks for others) and the order total.
- **Discount forms.** A discount is a percentage, a new price or a tugrik deduction.
- **Stacking.** Every discount that applies stacks. The stacking is sequential: each percentage is taken from the price after the earlier discounts, and every threshold is checked on the amount after them. Every box counts as one, and pieces are counted as boxes. Time-limited promotions happen sometimes.
- **Orders.** No manual discounts by staff (#18). A shortfall at confirmation is confirmed in part and the rest delivered later (#9, the default).

## Decision

1. **Two lists, one price for everyone.**
   - The lists are `WHOLESALE` (every channel but the supermarket) and `RETAIL` (the supermarket; its POS comes in delivery 9). There are no customer, contract or tier lists.
   - `unit_prices` holds a price per list and product unit: whole MNT, VAT included, valid from `valid_from` up to `valid_to`.
   - A unit without its own price in force takes its base unit's price × factor (HALF_UP). The base unit has no fallback: without its price a line is `PRICE_MISSING`.
   - Changes start today or later. A change closes the price in force on its day and inserts the new one up to the next planned change, so a change can slot in between planned ones. A row replaced on its first day is voided (`valid_to = valid_from`) and never applied.
   - The database keeps the history:
     - an `EXCLUDE` constraint rules out two prices of a unit in a list on one day;
     - a trigger lets only `valid_to` change, and only to an earlier date;
     - `app` may not delete.
2. **Discount programs** (`discount_programs` + `discount_steps`). A program has a name, a list, validity dates, a scope, a measure, an effect and ascending steps "from threshold → value" (the highest step reached applies).
   - **Scopes and thresholds:**
     - `PRODUCT`: the product's quantity in the whole cart, in base units, typed in any of its units;
     - `CATEGORY`: the category and every category below it; the threshold is either the boxes counted (`count_uom`, every box is one, pieces in boxes; a product without such a unit does not count) or the amount;
     - `ORDER`: the amount.
   - **Effects:**
     - `PRICE`: a new unit price, for one product unit only; never above the price so far; at most one per unit and list on a day, enforced by a partial `EXCLUDE`;
     - `PERCENT`: below 100, two decimals at most;
     - `AMOUNT`: tugriks per unit for a product, or off the subtotal for a category or the order.
   - Every program in force applies. A promotion is a program with end dates.
   - Before it starts, a program can be edited or deleted. After that it can only be stopped (`valid_to` today; a program stopped on its first day never applied).
3. **The order of a quote.** A pure function in `@tugeel/shared/pricing` (table-tested), wrapped by `PriceQuoteService`, applies:
   1. the list price;
   2. the product's programs: `PRICE`, then `PERCENT`, then `AMOUNT` per unit, on exact values, then the unit price rounded HALF_UP to whole MNT; the line subtotal is unit price × quantity in whole MNT;
   3. category programs, measured on the amounts after step 2;
   4. order programs, measured on the amount after step 3.

   In steps 3 and 4:
   - a percentage comes off each line, rounded to whole MNT per line;
   - an amount is split over the lines in proportion to their amounts (largest remainder), never more than they are worth;
   - every program of a stage is measured on the stage's starting amounts, then the `PERCENT` programs and then the `AMOUNT` programs apply, each by id.

   Each line carries:
   - the list price, its source (`UNIT`/`DERIVED`) and the unit price;
   - the subtotal, the discount amount (steps 3–4) and the total;
   - the programs applied, with their step and, for steps 3–4, the tugriks each took.

   A line without a price is left out of the amounts, but its quantity still counts.
4. **Freezing.** ADR-0009 #6 stands: orders re-run the quote at SUBMIT and freeze each line's prices, discount amount and applied programs. A history of programs is not needed for old orders, which carry their own explanation.
5. **No manual discounts** (SPEC §11 #18): there is no `sales.discount_manual` permission and no cap; `DISCOUNT_OVER_CAP` stays reserved and unused.
6. **A superseded unit** (`UNIT_SUPERSEDED_HOOK`, in the supersede transaction): its prices end today, planned ones are voided, and its programs stop. Nothing is copied to the new unit, whose factor differs. It takes the base unit's price × factor until it gets its own, so a smaller box is never sold at the old box's price. This replaces ADR-0008 #4.
7. **API and access.**
   - `GET /unit-prices?productId`: every current unit in both lists with today's, planned and past prices.
   - `GET /unit-prices/current?productIds`: base unit prices, for list columns.
   - `POST /unit-prices`: idempotent; one date, up to 20 units of one product; `null` returns a unit to its derived price.
   - `/discount-programs`: list, get, create, `PUT` before the start, `POST :id/stop`, `DELETE` before the start.
   - `POST /pricing/quote`: list, date (default today), up to 200 lines.
   - Every signed-in user reads; `pricing.manage` (admin) changes prices and programs. Changes are audited (`unit_prices`, `discount_programs`; a superseded unit as the system actor `unit-superseded`).
8. **Taxes.** The quote carries no VAT or city tax. Prices include them (SPEC §6.1 #1) until the accountant answers. The tax split per line comes with invoices (delivery 3, ADR-0010).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Customer, contract and tier lists (ADR-0009) | The owner sells at one price to everyone; a later ADR can add customer lists without changing these tables. |
| At most one discount per line | The owner chose stacking. |
| Percentages added together | The owner chose sequential (22,800 → −2 % → −1 % = 22,121 per box in the example). |
| Thresholds on list prices | The owner chose the amounts after the earlier discounts. |
| Every percentage on the unit price | Category and order thresholds and tugrik deductions are amounts of lines, not of a unit; only the product's own discounts change the unit price, the rest come off the line in whole MNT. |
| ADR-0009's single `price_rules` table with `min_qty_base` | Programs with steps cover quantity breaks, promotions and category and order thresholds in one form the owner can read. |
| Copying prices to the superseding unit | A box that shrinks from 24 to 20 would be sold at the old box's price. |
| Editing a running program | Orders frozen while it ran would no longer match it; a stopped program and a new one keep the record. |

## Consequences

**Positive.**
- Prices and discounts match how the owner sells.
- Every price of a line is explained by name and step.
- The price history cannot be rewritten.
- Planned price changes slot in by date.

**Negative.**
- Stacked discounts can add up to more than intended; the quote calculator shows the result before a program is created.
- A line's total is not always unit price × quantity once category or order discounts apply: the line keeps a `discountAmount`.
- With many programs, the stacking order must be read from this ADR.

**Follow-ups.**
- **Next session:**
  - the price Excel import: a template pre-filled with the products and their units, empty cells keep a price;
  - `sales`, freezing the quote at SUBMIT.
- **Delivery 3:** how e-Barimt lines carry `discountAmount`; the accountant's VAT answer.
- **Delivery 9:** RETAIL at the POS.

## Related

SPEC §5.6, §6.1, §11 #5, #9, #18; ADR-0008, ADR-0009, ADR-0010, ADR-0015; `docs/modules/pricing.md`; architecture §4, §5.4.
