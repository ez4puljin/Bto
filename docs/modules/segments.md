# Module `segments` — contract

Status: **built** in delivery 2, session of 2026-10-14; accepted locally with the rest of delivery 2. Code: `apps/api/src/modules/segments/`, the condition registry and its checks in `packages/shared/src/segments`, the definition DTOs every owner reads in `apps/api/src/common/segments/`, screens in `apps/web/src/features/segments/` (the product list's filters live with the list in `apps/web/src/features/catalog/`). Decisions: ADR-0049 (segments, filtered lists, the product export; amends ADR-0037), ADR-0050 (column choices per user), ADR-0051 (bulk edits, built in the owner modules), architecture §4 (segments row) and §5.12.

segments depends on `identity` (audit, access decorators, warehouses), `catalog`, `partners`, `inventory` and `pricing`, reading each through its `index.ts`. **Nothing imports segments** (ESLint G1, like `ai`): catalog and partners declare resolver hooks that `SegmentsModule` binds, so their lists narrow to a segment without depending on this module.

## 1. Owner's answers behind the design

Interview of 2026-10-14 (four rounds, after erxes screenshots of a filter menu with «1751 Records Found» and a segment page):

- **Product list.** Filters on suppliers, home warehouse and prices; stock (in, out, at or below the minimum, per warehouse); the dates registered and changed; missing data, with «no barcode on the base unit» and «no barcode at all» as two filters.
- **Ticked rows** go to Excel, are changed together (category, main supplier, price profile, home warehouse), deactivated or reactivated, and later print supermarket price labels (the owner sends the template; SPEC §11 #27).
- **Export.** «As shown»: the ticked rows if any, else every row the filters keep, with the visible columns; a new right («Бараа экспортлох»), admins first.
- **Columns** are kept per user on each Chrome (ADR-0050).
- **Segments** for products, customers and suppliers (orders after sales); dynamic (saved conditions, never a frozen list), with AND / OR groups; used now to filter lists and count, later for messages, reports and promotions. Admins create them; everyone sees them.

## 2. Owned tables

| Table | What | Guards |
|---|---|---|
| `segments` (`0020_segments`) | `entity` PRODUCT / CUSTOMER / SUPPLIER, `name`, `name_key` (search-normalised), `description`, `definition` (jsonb), `definition_version` (1), `archived_at`, `created_by` / `updated_by` (users, SET NULL), created and updated stamps | CHECKs: the entity, name 1–80, description ≤ 500, the definition a JSON object; unique live name per entity (`segments_live_name` on `(entity, name_key)` where `archived_at IS NULL`); `REVOKE DELETE, TRUNCATE` from app: a segment is archived, never deleted |

The definition's shape is checked by `segmentIssue` (shared) on every write and again on every read: a stored definition the registry no longer accepts answers `SEGMENT_INVALID` instead of running.

## 3. Public API (`modules/segments/index.ts`)

| Export | Use |
|---|---|
| `SegmentsModule` | binds catalog's `PRODUCT_SET_RESOLVER` and partners' `PARTNER_SET_RESOLVER` to `SegmentEvaluator` (`useExisting`); provides `SegmentsService` and `ProductExportService` |
| `SegmentsHttpModule` | the controllers (api only) |

Inside the module:

| Service | Use |
|---|---|
| `SegmentEvaluator.evaluate(ctx, entity, definition)` | the ids a checked definition keeps, ascending. Each leaf condition is answered by the module that owns its data, through its public services (catalog `ProductFiltersService`, partners `ProductSuppliersService` / `CustomersService` / `SuppliersService`, inventory `ProductLocationsService` / `StockQueryService`, pricing `ProductPricesService` on the Ulaanbaatar day); ALL intersects, ANY unites, a negative operator (NOT_IN, NONE, OUT_OF_STOCK) subtracts its positive form from the entity's universe, read only when needed. Leaves run one after another (the pool is small); a condition repeated in a request is asked once; an empty ALL stops early |
| `SegmentEvaluator.productIds({ where?, segmentId? })`, `ids(ctx, entity, segmentId)`, `ofSegment`, `count` | the two hooks' answers; `segmentId ∧ where` intersect; an unknown or archived segment is 404, another entity's segment 422 |
| `SegmentsService.list / get / counts / preview / create / update / archive` | the routes below; customer segments, their counts and previews need `partners.customers.read`; references (categories, suppliers, price profiles, warehouses) must exist (422 at `definition.groups.G.conditions.C.ids` or `.warehouseId`) |
| `ProductExportService.workbook({ productIds?, filters, columns })` | the product export (ADR-0049 #6), below |

## 4. REST surface (`/api/v1`)

| Route | Access | Notes |
|---|---|---|
| `GET /segments?entity&cursor&limit` | authenticated | live segments by name, keyset; customer segments only with `partners.customers.read` |
| `GET /segments/counts?segmentIds=…` | authenticated | 1–50 ids → `[{ segmentId, count }]`; `count` null for an unknown, archived, unreadable or no longer valid segment. Declared before `:id` |
| `GET /segments/:id` | authenticated | 404 when unknown or archived; 403 for a customer segment without `partners.customers.read` |
| `POST /segments/preview` | `segments.manage` | `{ entity, definition }` → `{ count }`, 200: the editor's live count |
| `POST /segments` | `segments.manage`, Idempotency-Key | `{ entity, name, description?, definition }` → 201; a live name taken in the entity → `DUPLICATE_VALUE` |
| `PUT /segments/:id` | `segments.manage` | `{ name, description?, definition }`; the entity never changes; an omitted description is cleared |
| `DELETE /segments/:id` | `segments.manage` | archives, 204 |
| `POST /exports/products` | `catalog.products.export` | `{ productIds }` (1–20,000, alone) or the product list's filters (`q`, `categoryId`, `status`, `saleReady`, `where`, `segmentId`) with `columns` (the list's keys but the photo, written in the list's order) → an `.xlsx`, 200 (`Content-Disposition` «Бараа YYYY-MM-DD.xlsx»); more than 20,000 rows → 422 `EXPORT_TOO_LARGE` (`params.count`, `params.limit`); a third export while two run → 429 `TOO_MANY_REQUESTS`; ticked products with filters → 422 at `productIds` (`alone`) |

The filtered lists themselves stay with their owners: catalog's `POST /products/query` (`where`, `segmentId`, `total` on the first page) and partners' `segmentId` on `GET /customers` and `GET /suppliers` (`docs/modules/catalog.md` §4, `partners.md` §4).

## 5. Rules worth knowing

- **The registry** (`@tugeel/shared/segments`, `SEGMENT_FIELDS`). PRODUCT: `search`, `category` (with subcategories), `stage` (ACTIVE / PENDING / INACTIVE), `createdAt` / `updatedAt` (BETWEEN or LAST_DAYS, Ulaanbaatar days, both ends included), `missing` (one of BASE_BARCODE, ANY_BARCODE, PHOTO, WEIGHT, EBARIMT), `supplier` (IN, MAIN_IN, NOT_IN, ANY, NONE), `homeWarehouse`, `stock` (IN_STOCK, OUT_OF_STOCK, AT_OR_BELOW_MIN; one warehouse, else the selling ones: WHOLESALE and STORE), `priceProfile`, `warehousePrice` (BETWEEN whole tugriks, on today's terms). CUSTOMER: `search`, `kind`, `status`, `creditHold`, `tinPending`, `gpsMissing`, `createdAt`. SUPPLIER: `search`, `status`, `products` (ANY / NONE), `createdAt`. Limits: 10 groups, 10 conditions a group, 30 in all, 200 ids a condition.
- **«Шинэчилсэн огноо»** is the product's own data: unit, barcode and photo changes touch `products.updated_at` (catalog's `touchProduct`, under the product's row lock).
- **Scale.** With 20,000 products (integrity `segments.spec.ts`, logged): a list page under three conditions 92 ms, ten segment counts 0.5–0.7 s, the whole catalogue to Excel 5.6 s on the owner's machine. Beyond about 20,000 records the evaluator would move to SQL fragments (ADR-0049 #3).
- **The export** settles its ids first (the ticked ones in the list's order, or what the filters keep, at most 20,000), then reads the rows in one REPEATABLE READ transaction, 1,000 at a time, from catalog, pricing, inventory and partners (only the chosen columns' owners). Codes and barcodes are text cells, prices and weights numbers, several values one cell joined by «, », an empty value an empty cell; headers come from mn.json. The download helper `common/excel/xlsx-file.ts` serves ai, imports and the export.

## 6. Error codes introduced

`SEGMENT_INVALID` (409, `params.name`, `params.issue`), `EXPORT_TOO_LARGE` (422, `params.count`, `params.limit`). Also used: `VALIDATION_FAILED` (a condition's path and its issue code, e.g. `where.groups.0.conditions.0.field` / `FIELD_NOT_ALLOWED`; the issue codes are translated under `segments.issues.*`), `DUPLICATE_VALUE`, `NOT_FOUND`, `FORBIDDEN`, `TOO_MANY_REQUESTS` (429), and in the owners `SERVICE_UNAVAILABLE` (503) when no resolver is bound — a filtered list never answers with every row.

## 7. Audit

`segments` CREATE, UPDATE (name, description and definition before and after), ARCHIVE.

## 8. Screens (`apps/web`)

- **Menu «Сегмент» → «Сегментүүд»** (`/segments`, everyone): one entity at a time (a `SegmentedControl`; «Харилцагч» only with `partners.customers.read`), the live segments with their description and count («128 бараа», «Тоолох боломжгүй» for a stale one); «Сегмент үүсгэх» with `segments.manage`.
- **A segment** (`/segments/:id`): its type and count in the header, the conditions in words (group by group, «ба» / «эсвэл» between them), «Жагсаалтаар харах» (the entity's list with `?segment=`), «Засах» and «Архивлах» (asked first) for admins.
- **The editor** (`/segments/new?entity=`, `/segments/:id/edit`, `segments.manage`): name, description, the type (fixed after creation) and the groups: each group «Бүгд биелэх» or «Аль нэг нь биелэх» once it has two conditions, and the groups joined the same way; a condition picks its field, its operator and its value (records from a dialog with a search for suppliers; values as checkboxes or a select; dates, days, tugriks, a word or a warehouse). The shared rules name what is missing; otherwise «Таарах: N» follows the conditions a moment after typing stops.
- **«Сегмент болгох»** on the product list (with `segments.manage`, when a search, category, status or filter is set) opens the editor with those conditions (`from=` the list's query; a segment filter is left out: segments do not nest).
- **Customers and suppliers**: «Бүх сегмент» narrows the list to a segment (`?segment=`), shown when the entity has segments.
- The product list's «Шүүлтүүр», chips, count, ticks, selection bar, Excel and bulk changes are catalog's screen (`docs/modules/catalog.md` §8).

Verified in the browser on 2026-10-14 against the dev database, signed in as `admin` and as `nyarav`: filters by supplier and missing data (chips, count, URL), «Сегмент болгох» with a second condition in the OR group (live count 1 → 2), the saved segment's page and its filtered list, ticking and the bulk category, home (no change) and status changes, all undone afterwards, the test segment archived; `nyarav` sees no ticks, Excel, bulk or segment buttons; phone width (375 px) and 1280 px measured without horizontal overflow.

## 9. Tests

Shared (Vitest): `segments.test.ts` (the registry, every issue and its path, `positiveCondition`, `conditionDays`). Api unit: `set-algebra.spec.ts`. Integration: `segments.int-spec.ts` (every product condition from its owner, AND / OR groups with the list's own filters and pagination, refused conditions at their path, CRUD with Idempotency, names, references, rights, counts, previews, archiving, customer segments and rights, the supplier list's segment and ids, `updated_at` after a barcode), `product-export.int-spec.ts` (columns in the list's order, cells by kind, ticked rows, conditions, refusals). Integrity: `segments.spec.ts` (REVOKE DELETE / TRUNCATE, the CHECKs, live names; 20,000 products: page < 500 ms, ten counts < 2 s, the export of all 20,000 two at a time, a third refused with 429, 20,001 refused). Web: `segments-pages.test.tsx` (the list and counts, a segment in words, archiving, creating with groups and a live count, the name required, «Сегмент болгох», the customer list's segment), `segment-definition.test.ts`, the product list's filters and export in `catalog-pages.test.tsx` and `product-filters.test.ts`.

## 10. Open items

- Supermarket price labels for ticked products: when the owner sends the template (SPEC §11 #27, TODO-VERIFY).
- Order segments, after sales.
- A full filter menu on the customer and supplier lists (today: the segment select).
- «Таарсан бүх N-ийг сонгох» (ticking every matching row beyond the loaded pages), when the owner needs it.
- Segments in promotions (pricing) and messages (notifications) through the same hooks.
- Segments inside segments: not planned.
