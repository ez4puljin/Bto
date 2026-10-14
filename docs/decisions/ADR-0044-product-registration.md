# ADR-0044: Product registration: code ranges, products waiting for their prices, no brands

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0041 (a price clerk's permission; a product is sold only once completed), ADR-0036 (new imported products wait for their prices; the revert takes the tables in the order below), ADR-0028 #5 (brands are gone) |
| Amended by | ADR-0048 (#3: completion needs the warehouse price and a price profile in force today and a whole unit that resolves; #4: the price clerk uses `POST /product-prices`; #9: the price dialog takes the warehouse price, the profile and the whole unit, and the pending list shows «Агуулахын үнэ» and «Үнийн тохиргоо») |

## Context

On 2026-10-13 the owner described how a product should be registered:

- the registrar picks the category first, and the system fills in the next code of that category;
- there are no brands;
- registration never asks for e-Barimt data;
- it asks for the supplier, photos, the home warehouse and the box quantity;
- saving registers the product and it then waits for its selling prices;
- a price clerk opens the list of waiting products, enters the prices and completes them, after which the product appears in every order.

Five interview rounds settled the details:

| Topic | Answer |
|---|---|
| Codes | Each category has its own range. A subcategory without a range uses its parent's, and may have its own. A typed code outside the range is refused; Excel imports are exempt |
| Brands | Removed completely |
| Completion | The clerk enters the prices and presses «Бүрэн болгох»; the wholesale and the supermarket price are both required |
| e-Barimt | The accountant enters it on its own page |
| Required at registration | Supplier, at least one photo, the home warehouse, the box quantity. The shelf is optional |
| Barcodes and units | Piece and box barcodes; base unit, weight and extra units such as a block stay |
| Permissions | A new «Бараа бүртгэх» permission; a new «Үнэ оруулах» permission for prices and completion. Discounts stay with `pricing.manage` |
| Waiting products | May be used in the warehouse (receipts, transfers, stocktakes). Imported new products wait too and are completed in bulk |
| After saving | The next product's form, keeping the category, the supplier and the warehouse |

## Decision

1. **Category code ranges** (`categories.sku_from` / `sku_to`, `NUMERIC(20,0)`; rules in `@tugeel/shared/catalog`).
   - Both ends or neither (CHECK `categories_sku_range_pair`), `0 ≤ from ≤ to` (`categories_sku_range`).
   - Ranges are laminar: two ranges that meet are nested, and the outer one belongs to an ancestor of the inner one's category. Anything else is `SKU_RANGE_OVERLAP` (409), checked under `CATEGORY_TREE_LOCK` when a range is set or a category moves.
   - A category uses its own range, else its nearest ancestor's. A code belongs to the innermost range around it.
   - **Suggestion** (`GET /products/next-sku?categoryId=`): one more than the largest code of any product inside the range and outside its subcategories' blocks; past the end, the lowest free code; `SKU_RANGE_FULL` (409) when none is left. A category without a range gets the next number outside every range.
   - **Typed codes** at registration, `POST /products` and a code change (`PATCH` checks only a changed code): outside the category's range is `SKU_OUT_OF_RANGE`, inside another category's block `SKU_RESERVED` (both 422). A number already taken, also with leading zeros («010000» against «10000»), is `DUPLICATE_VALUE` on `products_sku_key`. A two-key advisory lock on the number (`SKU_NUMBER_LOCK`, 72_026_105) makes two registrations of one number wait for each other.
   - Imports keep the owner's codes and never ask. Moving a product to another category keeps its code.
2. **Sale readiness.** `products.sale_ready_at` (NULL: «Үнэ хүлээгдэж буй»). `status` (ACTIVE / INACTIVE) is unchanged, so search, stock and the e-Barimt report see waiting products as before.
   - Every new product waits: registration, `POST /products`, the import. Migration 0015 completed the existing products (`= created_at`).
   - Reverting an import clears it again (`deactivateManyInTx`).
   - Orders (`sales`, delivery 3) take only ACTIVE products that are complete (SPEC §6).
3. **Completion** `POST /pricing/sale-ready` `{ productIds }` (1–200, `Idempotency-Key`, `pricing.prices.manage`).
   - The products are locked `ORDER BY id FOR UPDATE`; each must be ACTIVE (`PRODUCT_INACTIVE`, 409) and its base unit must have a WHOLESALE and a RETAIL price in force today, Ulaanbaatar date (`PRICE_MISSING`, 409, `errors[]` naming each SKU).
   - All or nothing; a product already complete is skipped. One `COMPLETE` audit row per product.
   - A base price can never be deleted or replaced by nothing, so nothing changes between the check and the update.
4. **Permissions** (`packages/shared/src/auth`, no migration):
   - `catalog.products.register` «Бараа бүртгэх»: registration and `next-sku`; product photos may be uploaded with it (a file kind now lists several permissions, any one is enough).
   - `pricing.prices.manage` «Үнэ оруулах»: `POST /unit-prices` and completion. Discount programs keep `pricing.manage`.
   - ACCOUNTANT gains `catalog.ebarimt.manage`. ADMIN holds everything.
5. **Registration** `POST /api/v1/product-registrations` (`catalog.products.register`, `@Idempotent`).
   - Body: `sku`, `name`, `categoryId`, `baseUomId`, `weightKg?`, `baseBarcodes`, `boxFactor`, `boxBarcodes`, `units` (other units, never the box), `supplierId`, `homeWarehouseId`, `fixedBinCode?`, `images` (1–10, uploaded first). The response is `{ productId, sku, name }`.
   - `ProductRegistrationService` lives in **inventory**, the lowest module allowed to call catalog and partners. It is not a `*-flow.service.ts`: it calls no integration.
   - Before the transaction: the write scope of the home warehouse, and every photo has arrived (an HTTP HEAD with the Spaces driver).
   - In the transaction, read-only checks first: an ACTIVE supplier (`SUPPLIER_INACTIVE`), an ACTIVE WHOLESALE warehouse (`WAREHOUSE_KIND_NOT_ALLOWED`), the shelf code looked up in that warehouse (a STORAGE or PICKING shelf, not archived; else a 422 on `fixedBinCode`).
   - Then the writes, **in the table order of every product writer: products (by id), product_locations, product_suppliers**:
     1. catalog's `CatalogRegistrationService.registerInTx`: the range check, the product, base unit, box unit (`boxFactor`, exact), other units, barcodes, e-Barimt defaults (VAT_ABLE, the classification code of the category or its nearest ancestor that has one) and the photos (`ProductImagesService.attachManyInTx`, the first primary);
     2. `ProductLocationsService.setHomeInTx` and `setInTx` (the fixed shelf);
     3. `ProductSuppliersService.linkInTx` (the first link is the main supplier).
   - The product import takes its products by id before changing them (`CatalogImportService.lockManyInTx`). Its revert used to lock `product_suppliers` before `product_locations` and could deadlock with a registration; it now restores products, then locations, then links. An integrity test holds a registration between its location and its supplier link while a revert runs.
   - `POST /products` stays for the API and the tests (`catalog.products.manage`); the web registers only through this route.
6. **e-Barimt leaves registration.** `UpdateProductDto` no longer carries VAT, city tax, classification or tax product codes. `PATCH /products/:id/ebarimt` (`catalog.ebarimt.manage`) sets them and each current unit's e-Barimt measure unit; the product page shows them in their own card. The readiness page stays.
7. **Brands are removed**: the table (migration 0014), the API, the Excel template column, the screens and filters. `audit.entities.brands` stays for old audit rows.
8. **Litre** is not a system unit; the owner adds it on «Хэмжих нэгж» if needed.
9. **Screens.**
   - `/catalog/products/new` is the registration form (category and code, units, barcodes, extra units, supplier and location, photos). Photos upload as soon as they are chosen. After a save the next product's form keeps the category, the supplier, the warehouse and the base unit, a new `Idempotency-Key` is drawn and a line on top links to the product just registered.
   - `/catalog/pending` «Үнэ хүлээгдэж буй» (`pricing.prices.manage`): the waiting products with their base prices, «Үнэ оруулах» per row (the price dialog with «Болих», «Хадгалах», «Бүрэн болгох», prices from today) and the ticked rows completed at once.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A PENDING value in `products.status` | Every reader of `status` (search, stock, receipts, the e-Barimt report) would have to learn it, and the owner wants waiting products usable in the warehouse. A nullable timestamp keeps `status` as it is |
| One `next_sku` counter per category | Codes come from Excel with gaps and from other ranges; deriving the next code from the products keeps a single truth |
| Overlapping ranges, first match wins | Two categories could hand out one code; the laminar rule makes the owner of every code unique |
| The registration in catalog, calling partners and inventory | catalog may not depend on them (architecture §4); inventory already depends on both |
| Saving the photos after the product, in a second call | A product would exist without a photo when the second call fails; uploading first and attaching in the transaction keeps registration whole |
| Asking for the e-Barimt data at registration with defaults | The owner wants registration quick; the accountant knows the data and now has a card for it |

## Consequences

**Positive.** One request registers a product completely or not at all, retries are safe, and a product reaches orders only with both prices. The price clerk and the accountant each have their own list.

**Negative.** Two places sort out code numbers: the unique key for the exact text, an advisory lock for numbers with leading zeros. Tests that create products through `POST /products` get waiting products and complete them where it matters.

**Follow-ups.**
- `sales` (delivery 3) filters products on `sale_ready_at IS NOT NULL`.
- The price import (next session) may complete products it prices in force today.
- A badge with the number of waiting products in the menu is left for later.

## Related

ADR-0008, ADR-0015, ADR-0028, ADR-0030, ADR-0032, ADR-0033, ADR-0036, ADR-0041, ADR-0043; `docs/modules/catalog.md`, `pricing.md`, `inventory.md`, `imports.md`; `docs/architecture.md` §4, §5.2, §5.3; `docs/SPEC.md` §5.2, §6.
