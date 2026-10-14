# Module `pricing` — contract

Status: **built** in delivery 2 (first session), 2026-10-13; accepted locally with the rest of delivery 2. Same day (ADR-0044): the price clerk's permission, completing products that wait for their prices, and the «Үнэ хүлээгдэж буй» list. Code: `apps/api/src/modules/pricing/`, the resolver in `packages/shared/src/pricing`, screens in `apps/web/src/features/pricing/`. Decisions: ADR-0041 (one price per list, dated unit prices, stacked discount programs; replaces parts of ADR-0009 and ADR-0008 #4), ADR-0010 (money), architecture §4 (pricing row) and §5.4.

pricing depends on `identity` (audit, access decorators) and `catalog` (products, units, categories, units of measure, the `UNIT_SUPERSEDED_HOOK`). `partners` is not needed while every customer pays the same price. sales (next session) and imports (the price sheet) import its `index.ts`.

## 1. Owner's answers behind the design (interview of 2026-10-13)

- **One price for everyone.** No customer, contract or tier prices; the supermarket has its own (RETAIL). Some products have a separate, cheaper box price, others are "piece × count". No fixed price list today: prices are entered here, or with the price sheet (next session).
- **Discounts.** By the quantity of one product, by a category (boxes counted, or the amount; every box is one, pieces in boxes) and by the order's amount; as a percentage, a new price or tugriks off. All of them stack, in order, each threshold checked on the amount after the earlier discounts. Promotions with dates happen sometimes.
- **Orders.** No manual discounts by staff; a shortfall at confirmation is confirmed in part and delivered later (SPEC §11 #9, #18).
- **VAT.** Whether some prices exclude VAT is for the accountant; until then every price includes VAT and city tax.
- **New products (2026-10-13, ADR-0044).** A registered or imported product waits for its prices. A price clerk («Үнэ оруулах») enters the wholesale and the supermarket price and completes it; only then do orders see it. Discounts stay with the admin.

## 2. Owned tables (migration `0013_pricing`)

| Table | What | Guards |
|---|---|---|
| `unit_prices` | the price of a product unit in a list (`WHOLESALE` / `RETAIL`) from `valid_from` up to `valid_to` | whole MNT > 0 (CHECK); `unit_prices_no_overlap` EXCLUDE (list, unit, daterange); trigger `unit_prices_guard`: only `valid_to` changes, only earlier (23001, the migrator too); `REVOKE DELETE, TRUNCATE` from app; a row closed on its first day never applied |
| `discount_programs` | a named program: list, scope PRODUCT / CATEGORY / ORDER with its target (`product_id`, `product_unit_id`, `threshold_unit_id`, `category_id`, `count_uom_id`), measure QTY / AMOUNT, effect PRICE / PERCENT / AMOUNT, `valid_from` / `valid_to` | CHECK `discount_programs_shape` (the rules of `discountShapeIssue`); partial EXCLUDE `discount_programs_one_price`: one PRICE program per unit and list on a day |
| `discount_steps` | the program's steps: from `threshold` on, `value` | unique (program, threshold); threshold ≥ 0, value > 0; deleted with their program |

## 3. Public API (`modules/pricing/index.ts`)

| Export | Use |
|---|---|
| `PricingModule` / `PricingHttpModule` | the services below; + the controllers (api). `PricingModule` binds catalog's `UNIT_SUPERSEDED_HOOK` to `PricingUnitsHook` |
| `UnitPricesService.view(productId)` → `ProductPrices` | every current unit in both lists: today's price (`UNIT`, or `DERIVED` = base × factor), planned prices, the last 10 ended ones |
| `UnitPricesService.currentOf(productIds)`, `inForce(list, unitIds, date, executor?)` | base unit prices today (list columns); the units' own prices on a date (quotes) |
| `UnitPricesService.set(actor, { productId, validFrom, entries })` | up to 20 units of one product from a day on (today or later), one transaction, an advisory lock per unit; `price: null` returns a non-base unit to its derived price; an unchanged price is skipped; one audit row |
| `UnitPricesService.closeUnitInTx(tx, actor, unitId, today)` | a superseded unit's prices end today, planned ones are voided |
| `DiscountProgramsService.list / get / create / update / stop / remove`, `inForce(list, date, executor?)`, `closeForUnitInTx` | programs; edits and deletes only before the start (`DISCOUNT_PROGRAM_STARTED`), a second PRICE program on a unit and dates → `DISCOUNT_PROGRAM_OVERLAP` |
| `PriceQuoteService.quote({ list, date, lines }, executor?)` → `Quote` | a cart priced as ADR-0041 #3 says; orders call it with their transaction at SUBMIT |
| `SaleReadinessService.complete(actor, productIds)` → `{ completed, alreadyComplete }` | ADR-0044 #3: 1–200 products locked by id (catalog's `ProductLifecycleService`), each ACTIVE (`PRODUCT_INACTIVE`) with a WHOLESALE and a RETAIL base price in force today (`PRICE_MISSING`, `errors[]` naming the SKUs); all or nothing |
| `@tugeel/shared/pricing` | `resolveQuote`, `allocate`, `reachedStep`, `discountShapeIssue`, `discountStepsIssue`, the list, scope, measure and effect codes — the web uses the same checks in its form |

Other modules never read or write pricing tables.

## 4. REST surface (`/api/v1`)

| Route | Access | Notes |
|---|---|---|
| `GET /unit-prices?productId` | authenticated | `{ productId, today, wholesale[], retail[] }` per current unit: `current { price, source, period }`, `scheduled[]`, `history[]` |
| `GET /unit-prices/current?productIds=…` | authenticated | base unit prices in force, both lists (ADR-0037 batch read, up to 200 ids) |
| `POST /unit-prices` | `pricing.prices.manage`, Idempotency-Key | `{ productId, validFrom, entries: [{ list, productUnitId, price \| null }] }` → the product's prices; 200 |
| `POST /pricing/sale-ready` | `pricing.prices.manage`, Idempotency-Key | `{ productIds }` (1–200) → `{ completed, alreadyComplete }`, 200; `PRODUCT_INACTIVE` (409), `PRICE_MISSING` (409) with `params.count` and `errors[]` (`productIds.N`, the SKU) |
| `GET /pricing/attention` | `pricing.prices.manage` | the price clerk's home tile (ADR-0047 #7): `{ productsWaitingForPrices, cap }`, active products without `sale_ready_at`, counted up to 100 through `CatalogService.countWaitingForPrices` |
| `GET /discount-programs?list&scope&status&productId` | authenticated | newest first, keyset; `status` SCHEDULED / ACTIVE / ENDED relative to today |
| `GET /discount-programs/:id` | authenticated | with product, units (name, factor) and steps |
| `POST /discount-programs` | `pricing.manage`, Idempotency-Key | 201; thresholds in canonical units (PRODUCT QTY: base units) |
| `PUT /discount-programs/:id` | `pricing.manage` | before the start only |
| `POST /discount-programs/:id/stop` | `pricing.manage` | in force: ends today; planned: never starts; ended: unchanged |
| `DELETE /discount-programs/:id` | `pricing.manage` | before the start only; 204 |
| `POST /pricing/quote` | authenticated | `{ list = WHOLESALE, date = today, lines: [{ productUnitId, qty }] }` (1–200) → lines with `listPrice`, `priceSource`, `unitPrice`, `subtotal`, `discountAmount`, `total`, `applied[]` or `problem: PRICE_MISSING`; totals over priced lines. `NOT_FOUND`, `UNIT_SUPERSEDED`, `UNIT_FACTOR_INEXACT` for bad lines |

## 5. Rules worth knowing

- **Timeline.** A change on day D closes the price in force on D (`valid_to = D`) and inserts the new one up to that row's old end, or up to the next planned price; a row replaced on its first day is voided, not history. Changes are never backdated.
- **Quote order** (ADR-0041 #3): list price → the product's programs (PRICE, never above the price so far; PERCENT; AMOUNT per unit) → whole MNT → line subtotal → category programs → order programs; a stage's programs are measured on the stage's starting amounts, then percentages and amounts apply by id; a percentage comes off each line in whole MNT, an amount is split in proportion (largest remainder). A product's thresholds count its quantity in the whole cart; a category counts its subtree.
- **Superseded units.** Nothing is copied to the new unit (ADR-0041 #6); its price is derived until set.
- **Taxes.** Not in the quote; prices include VAT (SPEC §6.1 #1) until the accountant answers.
- **Completion (ADR-0044 #3).** Both base prices must be in force on the Ulaanbaatar date of the call; a price from tomorrow does not count. A base price cannot be removed, so nothing changes between the check and the update. Permissions: `pricing.prices.manage` «Үнэ оруулах» sets prices and completes; `pricing.manage` keeps the discount programs.

## 6. Error codes introduced

`DISCOUNT_PROGRAM_STARTED` (409), `DISCOUNT_PROGRAM_OVERLAP` (409), `PRODUCT_INACTIVE` (409, ADR-0044). Also used: `PRICE_MISSING` (per quote line), `UNIT_SUPERSEDED`, `UNIT_FACTOR_INEXACT`, `VALIDATION_FAILED` (paths `validFrom`, `entries.N.price`, `steps.N`, `effect`, …), `NOT_FOUND`, `FORBIDDEN`. SQLSTATE 23P01 (an EXCLUDE) maps to 409 `CONFLICT` everywhere.

## 7. Audit

`unit_prices` UPDATE (entity id = product: the changes with before and after) and CLOSE (a superseded unit, system actor `unit-superseded`); `discount_programs` CREATE, UPDATE, DELETE, STOP (also by `unit-superseded`); `products` COMPLETE (one row per completed product, written through catalog).

## 8. Screens (`apps/web`)

- **Product page** → card «Үнэ» (`features/pricing/product-prices-card.tsx`, every user):
  - each current unit with its wholesale and supermarket price today (a derived one marked «Ширхгийн үнээс»);
  - planned changes («2026-11-01-с 1,100₮»);
  - past prices, folded.

  `pricing.prices.manage` opens «Үнэ тохируулах» (`price-entry-dialog.tsx`): a day (today or later) and a field per unit and list, prefilled with the units' own prices. Only changed fields are sent; an emptied field returns a unit to its derived price; the base unit cannot be emptied. While the product waits for its prices, the card says so with «Бүрэн болгох», and the dialog sets prices from today with «Болих», «Хадгалах» and «Бүрэн болгох» (saves what changed, then completes).
- **«Үнэ хүлээгдэж буй»** (`/catalog/pending`, menu «Бараа», `pricing.prices.manage`; `pending-products-page.tsx`): the waiting products (search, category) with their wholesale and supermarket base price today, «Үнэ оруулах» per row (the dialog above), and the ticked rows completed at once («Сонгосон N барааг бүрэн болгох»); a refusal lists the SKUs without both prices.
- **Product list** → columns «Бөөний үнэ» and «Супермаркетын үнэ» (the base unit's price today), read per page only while shown (ADR-0037).
- **Menu «Үнэ»** (every user):
  - «Хямдрал» (`/pricing/discounts`): programs in force by default, filters Идэвхтэй / Төлөвлөсөн / Дууссан / Бүгд. Each row shows its target, effect, steps in the unit they were typed in (`10 хайрцаг+ → 22,800₮`) and dates (the last day shown inclusive). On one program's page (`/pricing/discounts/:id`): «Засах» and «Устгах» before the start, «Зогсоох» while in force.
  - The form (`/pricing/discounts/new`, `/pricing/discounts/:id/edit`, `pricing.manage`) changes with the scope:
    - a product, found by search, with the unit the program applies to (or every unit) and the unit thresholds are typed in (sent in base units);
    - a category, counted in boxes or by amount;
    - the order.

    Then the effect, the dates and the steps. The form checks them with the shared rules before sending.
  - «Үнэ тооцоолох» (`/pricing/quote`): a test cart (products by search, unit, quantity, list, date) priced through `/pricing/quote`. Each line shows its list price, its unit price, the discounts by name with the tugriks each took, and the totals. Nothing is stored.

Verified in the browser on 2026-10-13 against the dev database, signed in as the supermarket clerk. The product page showed Coca-Cola's prices: pieces 1,000₮ wholesale and 1,200₮ supermarket; the 20-piece box 24,000₮ wholesale (its own price) and 24,000₮ at the supermarket (derived). The clerk saw no change button. The calculator priced 50 boxes as 1,106,028₮ with the three example programs «Жишээ: …», which the admin had created through the API (the owner's example).

## 9. Tests

Shared (Vitest): `pricing` (list and derived prices, PRICE_MISSING, every stage, stacking, rounding, the owner's example, allocation, shapes and steps). Integration: `sale-readiness.int-spec.ts` (both prices today, a future price, all or nothing, already complete, rights), `pricing.int-spec.ts` (the timeline: planned changes slotting in, same-day replacement voided, derived boxes, refusals and rights; list columns; programs: overlap, shape and step checks, edits before the start, stop after, audit; quotes through every stage, RETAIL, a planned price, bad lines; a superseded unit). Integrity: `pricing-guards.spec.ts` (only `valid_to` earlier, no delete even by the migrator for rewrites, no overlapping prices, one PRICE program per unit and day, concurrent changes serialised), `catalog-supersede.spec.ts` (the hook in the supersede transaction). Web: `features/pricing/pricing-pages.test.tsx` (the menu for every user; the product card and its dialog sending only the changed price with an Idempotency-Key; no change button without the right; the programs list in boxes, percentages and tugriks; a product program typed in boxes and sent in pieces; the calculator and its explanation), `features/catalog/catalog-pages.test.tsx` (the price columns, read only while shown).

## 10. Open items

- Next session: the price sheet import (a template pre-filled with the products and units; it may complete the products it prices today); `sales` freezes the quote at SUBMIT and takes only complete products.
- A menu badge with the number of waiting products (ADR-0044 follow-up).
- Delivery 3: how e-Barimt lines carry `discountAmount`; the accountant's VAT answer.
- Delivery 9: RETAIL at the POS.
