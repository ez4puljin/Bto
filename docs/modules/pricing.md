# Module `pricing` — contract

Status: **built** in delivery 2 (first session), 2026-10-13; accepted locally with the rest of delivery 2. Same day (ADR-0044): the price clerk's permission, completing products that wait for their prices, and the «Үнэ хүлээгдэж буй» list. On 2026-10-14 (ADR-0048) the price model changed: one warehouse price per product and named price profiles that derive the other prices replace the per-unit prices of both lists. Code: `apps/api/src/modules/pricing/`, the shared rules in `packages/shared/src/pricing` (`profile.ts`, `cart.ts`, `discounts.ts`), screens in `apps/web/src/features/pricing/`. On 2026-10-15 (ADR-0054) the price sheet import writes many products' terms at once. Decisions: ADR-0054 (bulk terms for the import), ADR-0048 (warehouse price and price profiles; supersedes ADR-0041 #1, #6 for prices and #7, the price step of #3), ADR-0041 (discount programs and their order, still in force), ADR-0044 (sale readiness, amended by ADR-0048), ADR-0010 (money), architecture §4 (pricing row) and §5.4.

pricing depends on `identity` (audit, access decorators) and `catalog` (products, units, categories, units of measure, the `UNIT_SUPERSEDED_HOOK`). `partners` is not needed while every customer pays the same price. sales (next) and imports (the price sheet) import its `index.ts`.

## 1. Owner's answers behind the design

Interview of 2026-10-13:

- **One price for everyone.** No customer, contract or tier prices; the supermarket has its own. No fixed price list today: prices are entered here, or with the price sheet (next session).
- **Discounts.** By the quantity of one product, by a category (boxes counted, or the amount; every box is one, pieces in boxes) and by the order's amount; as a percentage, a new price or tugriks off. All of them stack, in order, each threshold checked on the amount after the earlier discounts. Promotions with dates happen sometimes.
- **Orders.** No manual discounts by staff; a shortfall at confirmation is confirmed in part and delivered later (SPEC §11 #9, #18).
- **VAT.** Whether some prices exclude VAT is for the accountant; until then every price includes VAT and city tax.
- **New products (ADR-0044).** A registered or imported product waits for its prices; a price clerk («Үнэ оруулах») enters them and completes it; only then do orders see it. Discounts stay with the admin.

Interview of 2026-10-14 (ADR-0048):

- **One warehouse price per product**, per base unit (a piece, a kilogram); a box costs the piece price × its count.
- **Loose pieces** cost a profile's percentage more. A quantity is split by itself: with 20 in a box, 25 pieces are 1 box at the warehouse price and 5 loose pieces.
- **The supermarket** adds its own percentage; from a number of pieces of one product in the cart, a lower percentage (the «супермаркет бөөний үнэ»).
- **Rounding** is chosen per profile: whole tugriks (half up), or up to 10₮, 50₮ or 100₮.
- **A profile change** applies from the chosen day (today or later) to every product using it; earlier values stay in the history.
- **The pack counted whole** is chosen per product (a block or a box; the box is proposed); a product without packs always sells at the warehouse price.
- **Rights.** Only admins (`pricing.manage`) create and change profiles; the price clerk (`pricing.prices.manage`) enters the warehouse price and chooses the profile and the whole pack.
- Promotions, loyalty cards, vouchers and coupons (the «Үнэ» menu's items 3–5) come in later sessions, each after its own interview.

## 2. Owned tables

| Table | What | Guards |
|---|---|---|
| `price_profiles` (`0019_price_profiles`) | a named profile: `name`, `name_key` (search-normalised), `archived_at`, created and updated stamps | CHECK name 1–80 characters; unique live name (`price_profiles_live_name` on `name_key` where `archived_at IS NULL`); `REVOKE DELETE, TRUNCATE` from app |
| `price_profile_versions` (`0019`) | a profile's values from `valid_from` up to `valid_to`: `loose_markup_pct`, `retail_markup_pct`, `retail_bulk_min_qty` (base units) and `retail_bulk_markup_pct` (both or neither), `rounding` WHOLE / UP_10 / UP_50 / UP_100 | CHECKs: markups 0–999.99, the bulk pair, a bulk quantity > 0, the bulk markup below the supermarket one; EXCLUDE no overlap per profile; trigger `pricing_dated_row_guard`: only `valid_to` changes, only earlier (23001, the migrator too); `REVOKE DELETE, TRUNCATE` |
| `product_prices` (`0019`) | a product's price terms from `valid_from` up to `valid_to`: `warehouse_price` (whole MNT per base unit, VAT included), `profile_id`, `whole_uom_id` (the unit of measure counted whole; NULL for a product without packs) | CHECK whole MNT > 0; EXCLUDE no overlap per product; the same guard trigger; `REVOKE DELETE, TRUNCATE` |
| `discount_programs` (`0013_pricing`) | a named program: list (the sales channel), scope PRODUCT / CATEGORY / ORDER with its target (`product_id`, `product_unit_id`, `threshold_unit_id`, `category_id`, `count_uom_id`), measure QTY / AMOUNT, effect PRICE / PERCENT / AMOUNT, `valid_from` / `valid_to` | CHECK `discount_programs_shape` (the rules of `discountShapeIssue`); partial EXCLUDE `discount_programs_one_price`: one PRICE program per unit and list on a day |
| `discount_steps` (`0013`) | the program's steps: from `threshold` on, `value` | unique (program, threshold); threshold ≥ 0, value > 0; deleted with their program |

`unit_prices` (0013) was dropped by 0019 with its guard function; its audit rows keep the entity name («Нэгжийн үнэ (хуучин)» on the audit page). 0019 returned the products completed under the old prices to the waiting list (`sale_ready_at` NULL), each with an audit row (`RETURN`, actor `migration-0019`, reason `PRICE_MODEL_ADR_0048`); it created no profile. The whole unit is stored as a unit of measure and read as the product's current unit of it (`product_units_current_uom` keeps one), so a box that changes its count (24 → 20) needs no copy.

## 3. Public API (`modules/pricing/index.ts`)

| Export | Use |
|---|---|
| `PricingModule` / `PricingHttpModule` | the services below; + the controllers (api). `PricingModule` binds catalog's `UNIT_SUPERSEDED_HOOK` to `PricingUnitsHook` (a superseded unit's discount programs stop; price terms need nothing, ADR-0048 #2) |
| `PriceProfilesService.list / get / create / rename / setVersion / archive` | profiles with today's values, the planned and the last 20 ended ones, and `productsToday`; `setVersion` from a day on (today or later) closes the version in force that day, voids one planned for the same day and stops before the next planned one; values equal to those in force change nothing; `archive` is refused while terms in force today or later use the profile (`PRICE_PROFILE_IN_USE`) |
| `PriceProfilesService.versionsInForce(ids, date, executor?)`, `lockForPricesInTx(tx, id)`, `namesOf(ids)` | the values on a date (quotes, the views); the profile locked FOR SHARE while a product's terms take it; names, archived ones included |
| `ProductPricesService.view(productId)` → `ProductPriceView` | the product's current units, today's terms, the profile with today's values, the whole unit, `problems` (NO_TERMS, NO_PROFILE_VERSION, NOT_CHOSEN, GONE), one unit of each current unit priced (`unitPriceTable`), planned and ended terms |
| `ProductPricesService.currentOf(productIds)`, `inForce(productIds, date, executor?)` | today's terms with the profile's name (list columns); the terms on a date (quotes, sale readiness) |
| `ProductPricesService.tablesOf(productIds, date?, executor?)` → `Map<productId, UnitPrices[]>` (2026-10-15, ADR-0061 #7) | the unit table `view()` gives one product, for many on a day (the sales-rep app's shop): one of each current unit on both lists, without discount programs; products without terms, or whose profile has no values that day, are left out |
| `ProductPricesService.shopPricesOf(productIds, date?, executor?)` → `Map<productId, { basePrice, units }>`, `orderedByBasePrice(productIds, { direction, after, limit, date })` (2026-10-16, ADR-0066) | the rep shop's price: `tablesOf` with the warehouse price of one base unit (whole packs), the same products left out; and a keyset page of a set of products by that price in force (terms and a profile version that day), unpriced last either way. The in-force predicate is one helper, `inForceSql` |
| `ProductPricesService.set(actor, { productId, validFrom, warehousePrice, profileId, wholeUomId })` | from a day on (today or later), one transaction: the product's advisory lock (72_030_002), then the profile FOR SHARE; the profile live with values from that day; a product with packs names one of them as whole; the same dated-row rules as profiles; one audit row |
| `ProductPricesService.productIdsWhere(condition, date)` (2026-10-14, ADR-0049 #3) | pricing's answers to segment conditions on the terms in force that day: a price profile (`IN`, `ANY`) or a warehouse price within whole-tugrik bounds (`BETWEEN`, both included) |
| `ProductPricesService.setProfileMany(actor, { productIds, profileId, validFrom })` → `{ changed, unchanged, skipped }` (ADR-0051) | the bulk profile change below; `currentOf(productIds, executor?)` takes the export's transaction |
| `ProductPricesService.setManyInTx(tx, actor, inputs)` → `WrittenTerms[]`, `restoreManyInTx(tx, actor, entries)` (ADR-0054) | the price sheet import, inside its transaction: `product_prices` locked SHARE ROW EXCLUSIVE instead of per-product advisory locks, then the profiles FOR SHARE in id order; `set`'s checks and dated-row rule per product, closes and inserts many per statement, one audit row per changed product; each written row with the terms it replaced. The restore writes the replaced terms forward from today for rows that still hold |
| `PriceProfilesService.forImport(executor?)` | every profile with its name key, archived flag, first applied day and today's values (the import's lookups and its template) |
| `PriceQuoteService.quote({ list, date, lines }, executor?)` → `Quote` | a cart priced as ADR-0048 #4 says; orders call it with their transaction at SUBMIT |
| `SaleReadinessService.complete(actor, productIds)` → `{ completed, alreadyComplete }` | ADR-0044 #3 as amended: 1–200 products locked by id, each ACTIVE (`PRODUCT_INACTIVE`) with terms in force today, its profile's values today and a working whole unit (`PRICE_MISSING`, `errors[]` naming the SKUs, constraint `priced` or `wholeUnit`); all or nothing |
| `SaleReadinessService.completeManyInTx(tx, actor, productIds)` → `{ completed, at }` (ADR-0054 #5) | in the caller's transaction and without the 200 limit: completes the waiting ACTIVE products that pass `complete`'s checks and leaves the others; `at` is the transaction's moment, for the import's revert |
| `DiscountProgramsService.list / get / create / update / stop / remove`, `inForce(list, date, executor?)`, `closeForUnitInTx` | programs; edits and deletes only before the start (`DISCOUNT_PROGRAM_STARTED`), a second PRICE program on a unit and dates → `DISCOUNT_PROGRAM_OVERLAP` |
| `@tugeel/shared/pricing` | `profile.ts`: `PRICE_ROUNDINGS`, `MAX_PRICE_PROFILE_NAME`, `priceProfileIssue`, `roundPrice`, `perBasePrices`, `unitPriceOf`, `wholeUnitProblem`, `defaultWholeUomId`; `cart.ts`: `splitWholesale`, `unitPriceTable`, `resolveQuote`; `discounts.ts`: `allocate`, `reachedStep`, `discountShapeIssue`, `discountStepsIssue` and the codes — the web's previews and forms use the same functions |

Other modules never read or write pricing tables.

## 4. REST surface (`/api/v1`)

| Route | Access | Notes |
|---|---|---|
| `GET /price-profiles?archived&cursor&limit` | authenticated | live (default) or archived profiles, by id, keyset |
| `GET /price-profiles/:id` | authenticated | one profile: `current`, `scheduled[]`, `history[]`, `productsToday` |
| `POST /price-profiles` | `pricing.manage`, Idempotency-Key | `{ name, looseMarkupPct, retailMarkupPct, retailBulkMinQty?, retailBulkMarkupPct?, rounding, validFrom }` → 201; a live name taken → `DUPLICATE_VALUE` |
| `POST /price-profiles/:id/versions` | `pricing.manage`, Idempotency-Key | the values and `validFrom` → the profile, 200; archived → `PRICE_PROFILE_ARCHIVED` |
| `PATCH /price-profiles/:id` | `pricing.manage` | `{ name }` |
| `POST /price-profiles/:id/archive` | `pricing.manage` | 200; in use → `PRICE_PROFILE_IN_USE` (409, `params.count`) |
| `GET /product-prices?productId` | authenticated | the `ProductPriceView` above |
| `GET /product-prices/current?productIds=…` | authenticated | today's terms with the profile name (ADR-0037 batch read, up to 200 ids) |
| `POST /product-prices` | `pricing.prices.manage`, Idempotency-Key | `{ productId, validFrom, warehousePrice, profileId, wholeUomId }` → the product's view, 200 |
| `POST /product-prices/bulk/profile` | `pricing.prices.manage`, Idempotency-Key | `{ productIds (1–500), profileId, validFrom }` → `{ changed, unchanged, skipped: [{ productId, reason: NO_TERMS }] }`, 200 (ADR-0051): today or later; the products' advisory locks in id order, then the profile FOR SHARE; the terms in force that day and every planned row after them are written again with the new profile, the same warehouse price and whole unit, under the timeline's rules; rows already naming the profile change nothing |
| `POST /pricing/sale-ready` | `pricing.prices.manage`, Idempotency-Key | `{ productIds }` (1–200) → `{ completed, alreadyComplete }`, 200; `PRODUCT_INACTIVE` (409), `PRICE_MISSING` (422) with `params.count` and `errors[]` |
| `GET /pricing/attention` | `pricing.prices.manage` | the price clerk's home tile (ADR-0047 #7): `{ productsWaitingForPrices, cap }` |
| `GET /discount-programs?list&scope&status&productId`, `GET /discount-programs/:id` | authenticated | newest first, keyset; `status` SCHEDULED / ACTIVE / ENDED relative to today |
| `POST /discount-programs`, `PUT /discount-programs/:id`, `POST /discount-programs/:id/stop`, `DELETE /discount-programs/:id` | `pricing.manage` | as in ADR-0041: thresholds in canonical units; edits and deletes before the start only |
| `POST /pricing/quote` | authenticated | `{ list = WHOLESALE, date = today, lines: [{ productUnitId, qty }] }` (1–200) → each line with `parts[]` (`productUnitId`, `uomName`, `factorSnapshot`, `qty`, `qtyBase`, `basis` WAREHOUSE / LOOSE / RETAIL / RETAIL_BULK, `listPrice`, `unitPrice`, `subtotal`, `discountAmount`, `total`, `applied[]`) and the line's sums, or `problem: PRICE_MISSING`; totals over priced lines |

## 5. Rules worth knowing

- **Timeline** (`services/timeline.ts`, `planChange`). A change on day D closes the row in force on D (`valid_to = D`) and inserts the new one up to that row's old end, or up to the next planned row; a row replaced on its first day is voided, not history; a change equal to the row in force that day does nothing. Never backdated.
- **Prices** (ADR-0048 #3). For a warehouse price W per base unit: loose = W × (100 + loose %) / 100, supermarket = W × (100 + supermarket %) / 100, supermarket bulk likewise, each rounded as the profile says (WHOLE: half up; UP_n: up to the next multiple of n). A unit's price is the base price × its factor, half up to whole tugriks.
- **Quote order** (ADR-0048 #4, ADR-0041 #3 for the discounts). WHOLESALE lines are split by the whole unit: whole packs at the warehouse price, the rest loose (in the line's unit when it divides evenly, else in base units); a product without packs, or a line in whole packs, is one part. RETAIL lines are one part each, at the bulk price when the product's quantity in the cart reaches the profile's threshold. Then the product's programs per part (a unit's PRICE or AMOUNT program reaches only the parts in that unit; a percentage every part), whole MNT, the category programs, the order programs; thresholds count the product's or the category's quantity in the whole cart.
- **Locks.** Product terms: the product's advisory lock, then the profile FOR SHARE; the price sheet import locks the table SHARE ROW EXCLUSIVE instead (single and bulk changes wait for it or it for them; neither holds the table lock while waiting for the other). Profile values and archiving: the profile FOR UPDATE. So archiving waits for a clerk choosing the profile and is then refused; the old key 72_030_001 is retired.
- **Superseded units.** Price terms keep their unit of measure: the new box is the whole unit at once. Discount programs on the old unit stop (ADR-0041 #6).
- **Taxes.** Not in the quote; prices include VAT (SPEC §6.1 #1) until the accountant answers.
- **Completion** (ADR-0044 #3, as amended). Terms in force on the Ulaanbaatar date of the call, their profile's values that day and a working whole unit; terms from tomorrow do not count. Terms cannot be removed, so nothing changes between the check and the update.

## 6. Error codes introduced

`DISCOUNT_PROGRAM_STARTED` (409), `DISCOUNT_PROGRAM_OVERLAP` (409), `PRODUCT_INACTIVE` (409, ADR-0044), `PRICE_PROFILE_ARCHIVED` (409), `PRICE_PROFILE_IN_USE` (409, ADR-0048). Also used: `PRICE_MISSING` (422 on completion; per quote line), `DUPLICATE_VALUE` (a live profile name), `UNIT_SUPERSEDED`, `UNIT_FACTOR_INEXACT`, `VALIDATION_FAILED` (paths `validFrom`, `warehousePrice`, `profileId`, `wholeUomId`, the markups, `steps.N`, …), `NOT_FOUND`, `FORBIDDEN`. SQLSTATE 23P01 (an EXCLUDE) maps to 409 `CONFLICT` everywhere.

## 7. Audit

`price_profiles` CREATE, UPDATE (a rename: the name before and after; new values: the values before and after), ARCHIVE; `product_prices` UPDATE (entity id = product: the terms before and after); `discount_programs` CREATE, UPDATE, DELETE, STOP (also by `unit-superseded`); `products` COMPLETE (one row per completed product, written through catalog) and RETURN (migration 0019). The old `unit_prices` rows stay readable.

## 8. Screens (`apps/web`)

- **Menu «Үнэ»** (every user): «Үнийн тохиргоо», «Хямдралын тохиргоо», «Үнэ тооцоолох».
- **«Үнийн тохиргоо»** (`/pricing/profiles`, `profile-pages.tsx`): the live profiles (or the archived ones) with today's markups, the bulk price («+20% (24+)»), the rounding and the number of products; a profile whose first values start later shows them with their day. `pricing.manage` creates one in a `?new=1` dialog (`profile-form.tsx`): name, the two markups, the bulk price behind a switch, the rounding, the first day, and an example on 1,000₮ that follows the typed values. The profile's page (`/pricing/profiles/:id`) shows today's values worked out on the example and «Утгын түүх» (planned, in force, earlier); «Шинэ утга оруулах» (the dialog prefilled with the latest values, from today), «Нэр солих» and «Архивлах» (asked first; refused while in use).
- **Product page** → card «Үнэ» (`product-prices-card.tsx`, every user): the warehouse price per base unit, the profile (a link, with its values), the whole pack; each unit's wholesale price (marked Бүтэн / Задгай / Холимог), supermarket and supermarket bulk price; problems (no terms, no profile values today, no whole pack, a gone one); planned terms; earlier terms folded. `pricing.prices.manage` opens «Үнэ тохируулах» (`price-entry-dialog.tsx`): the warehouse price, the profile (with its values), the whole pack (the box proposed; none for a product without packs) and the day, with every unit's prices previewed by the shared functions. While the product waits for its prices, the card says so with «Бүрэн болгох», and the dialog sets the terms from today with «Хадгалах» and «Бүрэн болгох» (saves, then completes; a refusal says what is missing and a retry keeps its key).
- **«Үнэ хүлээгдэж буй»** (`/catalog/pending`, menu «Бараа», `pricing.prices.manage`): the waiting products with their warehouse price and profile today, «Үнэ оруулах» per row (the dialog above), and the ticked rows completed at once; a refusal lists the SKUs.
- **Product list** → columns «Агуулахын үнэ» and «Үнийн тохиргоо» (today's terms), read per page only while shown (ADR-0037). The tax columns left the list (ADR-0048 #6); the tax data is on the product's e-Barimt card.
- **«Хямдралын тохиргоо»** (`/pricing/discounts`): as before (ADR-0041 #2): programs in force by default, filters, the program page and the form by scope.
- **«Үнэ тооцоолох»** (`/pricing/quote`): a test cart priced through `/pricing/quote`; each line shows its parts («1 хайрцаг» Бүтэн, «5 ш» Задгай) with their prices, the discounts by name and the totals. Nothing is stored.

Verified in the browser on 2026-10-14 against the dev database, signed in as `admin`: the profile «Жишээ: Ундаа» (15 %, 30 %, from 24 pieces 20 %, up to 50₮) and a planned 17 % from the next day; Coca-Cola at 1,000₮ a piece with the box of 20 counted whole (box 20,000₮, piece 1,150₮ loose, supermarket 1,300₮, bulk 1,200₮) completed from its card; the two list columns; the calculator's 25 pieces as 1 box + 5 loose (25,750₮), 30 supermarket pieces at the bulk price (36,000₮) and the next day's 26,000₮. Phone widths and 1280 px were checked by measuring the layout.

## 9. Tests

Shared (Vitest): `profile.test.ts` (rounding table, per-base prices, whole unit rules), `cart.test.ts` (25 pieces in boxes of 20, multiples, blocks and boxes, a product without packs, the bulk threshold reached by two lines, unit programs only on their parts, the owner's 1,106,028₮ example, PRICE_MISSING, program order), `discounts.test.ts` (steps and shapes). Api unit (Jest): `timeline.spec.ts`. Integration: `pricing.int-spec.ts` (profiles: dates, same-day replacement, archive, rights, audit; terms: refusals, Idempotency; quotes in parts, the supermarket bulk price, a future day; superseded and removed units), `sale-readiness.int-spec.ts` (terms today, a missing whole unit, rights), `ai-views.int-spec.ts` (`product_prices_today` against the service under every rounding). Integrity: `pricing-guards.spec.ts` (only `valid_to` earlier, no delete even by the migrator, no overlaps, the CHECKs, eight concurrent terms, archive against a clerk choosing the profile), `catalog-supersede.spec.ts` (the whole unit follows the new box), `registration-races.spec.ts`. Web: `pricing-pages.test.tsx` (the card, the dialog and its preview, a product without packs, the waiting list and completion, the calculator's parts), `profiles-pages.test.tsx` (the menu, the list, creating with the shared checks, new values, rename, a refused archive, rights), `catalog-pages.test.tsx` (the two price columns, read only while shown).

## 10. Open items

- Done 2026-10-15: the price sheet import (ADR-0054). Next: `sales` freezes the quote's parts at SUBMIT and takes only complete products.
- Promotions, loyalty cards, vouchers and coupons: one interview and session each.
- A menu badge with the number of waiting products (ADR-0044 follow-up).
- Delivery 3: how e-Barimt lines carry `discountAmount`; the accountant's VAT answer.
- Delivery 9: RETAIL at the POS.
