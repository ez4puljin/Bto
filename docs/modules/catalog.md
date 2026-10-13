# Module `catalog` — contract

Status: **built** in delivery 1 (week 2), session of 2026-10-11; accepted locally together with the rest of delivery 1. Code: `apps/api/src/modules/catalog/`, shared rules in `packages/shared/src/{text,gtin,units,files}`, screens in `apps/web/src/features/catalog/`, scanning in `apps/web/src/lib/scan/` and `apps/web/src/components/{scan-box,camera-scanner}.tsx`. Decisions: ADR-0008 (units and factors), ADR-0010 (money and tax), ADR-0011 (i18n), ADR-0015 #3 (e-Barimt attributes optional in delivery 1), ADR-0028 (search keys), ADR-0029 (barcode model), ADR-0030 (file storage), ADR-0031 (camera fallback), architecture §4 (catalog row) and §5.2.

catalog depends only on `identity` (audit, settings, storage, access decorators). partners (`product_suppliers`, ADR-0032), inventory, imports, pricing, sales, procurement and ebarimt import its `index.ts`.

## 1. Owner's answers behind the design (interview of 2026-10-10/11)

Names mix Cyrillic and Latin; weighed goods are sold in bulk by the kilogram; pre-packed bundles are ordinary products and promotional bundles belong to pricing (delivery 2); pieces, blocks and boxes carry their own barcodes and some products have none; the product code (SKU) is numeric and comes from the owner's Excel sheet, the system suggests the next one; categories form a tree; only the admin edits the catalog; VAT-exempt goods exist and city tax is undecided until the accountant answers (SPEC §11 #3a); the admin uploads photos by hand. The Excel columns map as follows: code, name, category, barcode, box quantity and unit weight → catalog; home warehouse → inventory (week 3, `product_locations`); price → the delivery-2 price import; supplier → partners `product_suppliers` (ADR-0032); image → uploaded by hand.

On 2026-10-12, checking the screens, the owner asked for every piece of product information as a column of the product list, chosen with a «Баганууд» button and remembered on the computer, without stock columns; and could not find how to edit a product from the list (ADR-0037).

## 2. Owned tables (migration `0003_catalog`)

| Table | Purpose | Key rules (DB-enforced unless noted) |
|---|---|---|
| `uoms` | units of measure | system units `PCS`, `BLOCK`, `BOX`, `KG` (code `^[A-Z]{2,12}$`, synced at api boot with Mongolian names from `mn.json` `uoms.system`, an admin's renames kept); custom units have no code; `fractional` (kg, l) fixed after creation; `measure_unit` = default e-Barimt measure unit |
| `categories` | category tree | `parent_id` (not itself; no cycles, depth ≤ 8 — service, under an advisory lock); sibling names unique by `name_key` (`categories_sibling_name` on `coalesce(parent_id, 0)`); `default_classification_code` 7 digits or NULL |
| `brands` | brands | `name_key` unique |
| `products` | products | `sku` `^[0-9]{1,20}$` unique (`products_sku_key`, leading zeros kept); `name` NFC, 1–200; `search_text`, `search_phonetic`, `search_version` written by the service only (GIN trigram indexes); `category_id` NOT NULL; `vat_type` VAT_ABLE/VAT_FREE/VAT_ZERO/NO_VAT; `city_tax` boolean or NULL (= undecided); `classification_code` 7 digits, `tax_product_code` 3 digits, both nullable; `status` ACTIVE/INACTIVE; `tracks_lots` (ADR-0019, unused); `weight_kg NUMERIC(12,4) > 0` per base unit. `REVOKE DELETE, TRUNCATE … FROM app` |
| `product_units` | units of a product | `factor_to_base NUMERIC(18,6) > 0`; exactly one base unit (factor 1, never superseded; partial unique index + the deferred constraint trigger `products_base_unit_required` checked at COMMIT); one current row per unit of measure; at most one default-sales and one default-purchase unit; `superseded_by` implies `superseded_at`; a superseded or retired row has no default flags; `measure_unit` 1–50 or NULL (= the unit of measure's default). Trigger `product_units_immutable` (SQLSTATE 23001, also for the migrator): product, unit of measure, factor and base flag never change, `superseded_at`/`superseded_by` are written once. `REVOKE DELETE, TRUNCATE … FROM app` |
| `product_barcodes` | barcodes of units | `code` printable ASCII 1–48 as printed; `gtin14` 14 digits or NULL; `lookup_key = coalesce(gtin14, upper(code))` unique across the table (`product_barcodes_lookup_key_key`); `barcode_type` GS1/ISBN/UNDEFINED; one primary (the e-Barimt barcode) and at most one internal barcode per unit; internal ⇒ UNDEFINED |
| `product_images` | photos | `image_file_id`, `thumb_file_id` → identity `files` (each unique, different from each other); `sort_order`; one primary per product |
| sequence `catalog_internal_barcode_seq` | internal EAN-13 numbers | `20` + 10 digits + check digit (ADR-0029) |

## 3. Public API (`modules/catalog/index.ts`)

| Export | Use |
|---|---|
| `CatalogModule` | import into a feature module to get the services below |
| `CatalogService.get(id, executor?)`, `getMany(ids, executor?)`, `search(query)` | product detail with units, barcodes and images; summaries for lists; the same search and order as `GET /products` (plain summaries; the list screen's extra fields come from `ProductsService.listItems`) |
| `UnitConversionService.toBase(unitId, enteredQty, executor?)` → `{ productId, unitId, factorSnapshot, qtyBase }` | what a document line stores (ADR-0008 #2); `UNIT_SUPERSEDED` for superseded or retired units, `UNIT_FACTOR_INEXACT` when the base quantity needs more than 3 decimals or is not whole pieces |
| `UnitConversionService.describe(unitIds, executor?)`, `baseUnits(productIds, executor?)` → `Map<…, UnitInfo>`, `currentUnits(productIds, executor?)` → `Map<productId, UnitInfo[]>` (current units, base first; `UnitInfo.uomId` since 2026-10-13, for pricing's derived prices and counted boxes) | names and factors of the units on document lines (current or superseded); the base unit of each product (stocktake corrections post in base units). Added with inventory, 2026-10-11 |
| `UnitsService.supersedeInTx(tx, actor, unitId, factorToBase)` | the single supersede path: old row closed, new row inserted with the flags, barcodes re-pointed, `UNIT_SUPERSEDED_HOOK` called, audit — one transaction |
| `UNIT_SUPERSEDED_HOOK` / `UnitSupersededHook` | optional provider (resolved through `ModuleRef`, `strict: false`); bound by pricing since 2026-10-13: the old unit's prices end and its programs stop, nothing is copied (ADR-0041 #6) |
| `CategoriesService.get / subtreeIds(id)`, `UomsService.get` | exported 2026-10-13 for pricing (category programs count a subtree; the counted unit of measure) |
| `BarcodeService.lookup(code, executor?)` | every current unit a scanned code may belong to (an 8-digit code may be EAN-8 or UPC-E) |
| `TaxService.rates(productId, onDate?, executor?)` → `{ vatType, vatRatePct, cityTax, cityTaxRatePct }` | rates in force on an Ulaanbaatar business date from identity settings; VAT 0 unless VAT_ABLE, city tax 0 unless `city_tax`; `TAX_ATTRIBUTES_MISSING` when city tax is undecided, `SETTING_MISSING` without a rate. Whether the company itself pays VAT or city tax is applied by pricing and ebarimt (SPEC §11 #3a) |
| `CatalogImportService` (2026-10-11, ADR-0036): `reference()`, `productsBySku(skus)`, `productsByIds(ids)`, `barcodeOwners(lookupKeys)`, `createManyInTx(tx, actor, inputs)`, `updateProductInTx(tx, actor, id, patch)`, `deactivateManyInTx(tx, actor, ids)` | bulk reads and writes for the Excel import: categories, brands, units and VAT types in a few statements; products with their units and barcodes by SKU or id; who owns a barcode; new products written with multi-row inserts, references checked in bulk, one audit row each and no per-product locks (a taken barcode or SKU fails the whole call with `DUPLICATE_VALUE`); a revert makes products INACTIVE and releases their barcodes (audited as `UPDATE` with the codes released) |
| `UnitsService.addInTx(tx, actor, productId, input)`, `retireInTx(tx, actor, unitId)`; `BarcodeService.removeInTx(tx, actor, barcodeId)` | the single-product paths, callable inside another module's transaction (the importer adds a box unit or barcodes to an existing product and takes them back on revert); `updateProductInTx` wraps the internal `ProductsService.updateInTx`, which returns the row as it was before |
| types `ProductDetail`, `ProductSummary`, `ProductPatch`, `NewUnitInput`, `UnitView`, `ConvertedQty`, `ProductTaxRates`, `ResolvedBarcode`, `CatalogReference`, `ImportProduct`, `BulkProductInput`, `CreatedProduct`, `VAT_TYPES` / `VatType` | |

Other modules never write catalog tables and never read them directly; inventory (week 3) records the home warehouse in its own `product_locations`.

## 4. REST surface (`/api/v1`)

Two permissions, both ADMIN-only system mappings and assignable to custom roles: `catalog.products.manage` (edit products, units, barcodes, images and master data) and `catalog.ebarimt.manage` (readiness report and bulk assignment). Every authenticated user reads the catalog.

| Method and path | Access | Notes |
|---|---|---|
| `GET /uoms`, `GET /categories`, `GET /brands` | authenticated | short lists; categories carry `productCount` (direct) and `childCount`, brands `productCount` |
| `POST/PATCH/DELETE /uoms[/:id]`, `/categories[/:id]`, `/brands[/:id]` | `catalog.products.manage` | delete only when unused (`IN_USE`, `CATEGORY_NOT_EMPTY`); system units cannot be deleted (`IN_USE`); moving a category under itself → `CATEGORY_CYCLE` |
| `GET /products` | authenticated | `q` (any script, SKU or barcode; ADR-0028), `categoryId` (with subcategories), `brandId`, `status`, keyset `cursor`/`limit`; strict matches first. Rows are `ProductListItem`: the summary plus `weightKg`, `classificationCode`, `taxProductCode` and `units` (current units, base first then by factor, each with its barcodes, primary first), read with one statement each per page (ADR-0037) |
| `GET /products/next-sku` | `catalog.products.manage` | the largest SKU + 1, same width |
| `GET /products/:id` | authenticated | units (current first), barcodes, images with public URLs |
| `POST /products`, `PATCH /products/:id` | `catalog.products.manage` | create takes the base unit, other units and barcodes in one transaction; a taken SKU is `DUPLICATE_VALUE` with `params.constraint = 'products_sku_key'` |
| `POST /products/:id/units`, `PATCH /product-units/:id` | `catalog.products.manage` | factor exactness checked against the base unit (`UNIT_FACTOR_INEXACT`); setting a default flag moves it from the other unit |
| `POST /product-units/:id/supersede` (201), `POST /product-units/:id/retire` (200) | `catalog.products.manage`, `Idempotency-Key` | base unit → `UNIT_BASE_LOCKED`; a second change of the same row → `UNIT_SUPERSEDED`; retiring deletes the unit's barcodes |
| `POST /product-units/:id/barcodes`, `POST /product-units/:id/internal-barcode` (`Idempotency-Key`), `POST /product-barcodes/:id/primary`, `DELETE /product-barcodes/:id` | `catalog.products.manage` | `BARCODE_INVALID` (check digit, characters), `BARCODE_TAKEN` with `params.sku` / `params.name` of the owner, `BARCODE_AMBIGUOUS`; deleting the primary promotes the oldest remaining barcode |
| `GET /barcodes/:code` | authenticated | scan lookup → `{ product, unit, barcode }`; 404 unknown, 409 `BARCODE_AMBIGUOUS`, 422 `BARCODE_INVALID`; superseded and retired units never answer |
| `POST /products/:id/images`, `POST /product-images/:id/primary`, `DELETE /product-images/:id` | `catalog.products.manage` | `{ imageFileId, thumbFileId }` of uploaded `catalog.product_image` (≤ 5 MB) and `catalog.product_thumb` (≤ 512 KB) files; at most 10 photos; delete marks both files DELETED |
| `GET /catalog/ebarimt-readiness`, `GET /catalog/ebarimt-readiness/products` | `catalog.ebarimt.manage` | counts of active products missing `classificationCode`, `taxProductCode` (VAT_FREE / VAT_ZERO only), `measureUnit` (a current unit without its own or a default measure unit) or `cityTax`; keyset list filtered by `gap` and `categoryId` |
| `POST /catalog/ebarimt-readiness/assign` (200) | `catalog.ebarimt.manage`, `Idempotency-Key` | `{ categoryId, includeSubcategories, classificationCode?, taxProductCode?, cityTax?, dryRun? }`: fills only empty values (never overwrites), returns counts per attribute; one `ASSIGN` audit row with the product ids |

## 5. Rules worth knowing

- **Search (ADR-0028).** Keys are built in `@tugeel/shared/text` from the name and the SKU: `search_text` (NFKC, lower case, Latin look-alikes → Cyrillic, ё → е) and `search_phonetic` (romanised, ө → o, ү → u, Latin spelling folded). Every term must match; terms shorter than 3 characters match word starts only; `%` and `_` are escaped. After changing the rules, raise `SEARCH_KEYS_VERSION` and run `pnpm catalog:reindex-search` (`--all` recomputes every product).
- **Barcodes (ADR-0029).** Input is cleaned and classified by `@tugeel/shared/gtin`: GTIN-8/12/13/14 need a valid check digit and share one key (UPC-A "036000291452" = EAN-13 "0036000291452"), UPC-E expands to UPC-A, other printable codes (Code 128 labels) are stored as typed. The web checks the same rules before sending.
- **Units (ADR-0008).** Factors never change. A piece-based product needs whole factors and whole base quantities; a kilogram-based product allows 3 decimals. A product needs a new unit row (e.g. "хайрцаг 12") for a second box size, because (product, unit of measure) is unique among current units.
- **Images (ADR-0030).** The browser scales each photo to 1280 px and a 256 px thumbnail (JPEG, EXIF removed), uploads both through presigned URLs, then attaches them; HEIC is refused with a hint on desktop browsers.
- **Scanning (ADR-0021, ADR-0031).** Barcode fields and the global wedge detector read number-row digits from `event.code` (the Mongolian layout types symbols there). The camera opens on HTTPS or localhost only.

## 6. Error codes introduced

`IN_USE` 409, `CATEGORY_CYCLE` 409, `CATEGORY_NOT_EMPTY` 409, `UNIT_FACTOR_INEXACT` 422, `UNIT_BASE_LOCKED` 422, `BARCODE_INVALID` 422, `BARCODE_TAKEN` 409, `BARCODE_AMBIGUOUS` 409, `TAX_ATTRIBUTES_MISSING` 409. Also used: `UNIT_SUPERSEDED` 409, `DUPLICATE_VALUE` 409, `VALIDATION_FAILED` 422, `FILE_NOT_UPLOADED` 409, `FILE_KIND_MISMATCH` 422.

## 7. Audit

Actions `CREATE`, `UPDATE`, `DELETE`, `SUPERSEDE`, `RETIRE`, `ASSIGN` on the entities `uoms`, `categories`, `brands`, `products`, `product_units`, `product_barcodes`, `product_images` (labels in `mn.json` `audit.*`). Search keys are derived data and are not audited.

## 8. Screens (`apps/web`)

Menu group «Бараа» (layout and patterns: `docs/ui.md`, ADR-0043):

- `/catalog/products`: search and filters in the URL. Every piece of product information is a column (image, SKU, name, category, brand, base unit, other units «1 хайрцаг = 24 ш», base and other-unit barcodes, VAT, city tax, weight, home warehouse and fixed shelves from inventory, main supplier «+N» from partners, e-Barimt codes, status), read per page with `productIds` only for visible columns. «Баганууд» hides and shows columns (SKU and name stay), remembered per browser in `localStorage` `tugeel.catalog.products.hiddenColumns.v1`; the shared `components/column-chooser.tsx` serves the customer and supplier lists too (ADR-0037). A click anywhere on a row opens the product, whose name stays a link (ADR-0042 #6). The page uses the full width (route `handle: { wide: true }`).
- `/catalog/products/new` (`catalog.products.manage`): sections «Ерөнхий», «e-Barimt шинж», «Суурь нэгж ба баркод» and «Нэмэлт нэгж» (each extra unit with its factor, default switches and barcodes); «Болих» goes back to the list.
- `/catalog/products/:id`, read-only without `catalog.products.manage`:
  - the header shows the primary photo, then SKU · category · brand · status;
  - «Үндсэн мэдээлэл» is read in the form's sections, «Засах» opens the form, and the status is a switch;
  - «Нэгж ба баркод» has one row per unit: the unit, its factor, its e-Barimt measure unit and default tags; its barcodes tagged «Үндсэн» / «Дотоод», with icon buttons to make one primary or delete it; «Баркод нэмэх» opens a dialog (scan or type, or «Дотоод баркод үүсгэх» while the unit has none); a «⋯» menu «{unit}: үйлдэл» edits the unit, changes its factor or retires it (the base unit only edits); earlier units fold away;
  - photos form a square grid with «Үндсэн» on the primary one and their actions on hover;
  - then prices, the suppliers card from `features/partners` (`docs/modules/partners.md` §8) and the «Байршил ба үлдэгдэл» card from `features/inventory` (`docs/modules/inventory.md` §9).
- `/catalog/categories` (the tree with folders; row icons «Дэд ангилал», «Засах», «Устгах»), `/catalog/brands`, `/catalog/uoms` (a system / own pill, ✓ for fractional units; the fractional switch is fixed after creation).
- `/catalog/scan`: the scan card (wedge scanner, typing, camera), the result card with «Бараа нээх», the earlier scans.
- `/catalog/ebarimt` (`catalog.ebarimt.manage`): count tiles (green with «Бүрэн» at zero, amber otherwise), the bulk assignment form, the products still missing something.

Idempotent actions send one `Idempotency-Key` per user intent (a dialog or a click) and resend it on a retry.

## 9. Tests

Shared (Vitest): `text`, `gtin`, `units`, `files`. Integration (`apps/api/test/integration/`): `catalog-schema`, `catalog-reference`, `catalog-masters`, `products`, `units-barcodes`, `catalog-search`, `barcode-lookup` (10 000 products, HTTP lookup under 300 ms, the plan uses `product_barcodes_lookup_key_key`), `product-images`, `tax-readiness`, plus identity's `files`. Integrity (`apps/api/test/integrity/`): `catalog-guards` (triggers, REVOKEs), `catalog-supersede` (keeps barcodes and default flags; two parallel supersedes → one wins), `catalog-barcode-race` (one GTIN registered on two products in parallel → one wins). Web: `features/catalog/catalog-pages.test.tsx`, `features/catalog/catalog-logic.test.ts`, `lib/catalog-helpers.test.ts`, `lib/scan/wedge-detector.test.ts`.

## 10. Open items

- ~~The supplier link (Excel "нийлүүлэгч")~~ resolved 2026-10-11: `product_suppliers` in partners (ADR-0032), one main supplier per product; the week-4 product import fills it through `ProductSuppliersService.linkInTx`.
- Home warehouse (Excel "харьяалагдах агуулах") and shelf labels with barcodes: inventory, week 3.
- Product and price Excel import: `imports`, week 4 (products) and delivery 2 (prices).
- Cleanup of PENDING image uploads that were never attached and of DELETED files: identity's housekeeping job (identity.md §12).
- Phone camera scanning during local-only development needs HTTPS on the LAN; decide the mechanism in the inventory session (the first with phone flows).
- City-tax rule for the company itself and `tax_product_code` values: accountant (SPEC §11 #3a); the readiness report must reach zero before delivery 3.
