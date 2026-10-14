# Module `segments` — contract

Status: **built** in delivery 2, session of 2026-10-14, and extended the same day with hand-picked product segments (ADR-0052); accepted locally with the rest of delivery 2. Code: `apps/api/src/modules/segments/`, the condition registry and its checks in `packages/shared/src/segments`, the definition DTOs every owner reads in `apps/api/src/common/segments/`, screens in `apps/web/src/features/segments/` (the product list's filters live with the list in `apps/web/src/features/catalog/`). Decisions: ADR-0049 (segments, filtered lists, the product export; amends ADR-0037), ADR-0050 (column choices per user), ADR-0051 (bulk edits, built in the owner modules), ADR-0052 (hand-picked product segments, ticks kept across searches), architecture §4 (segments row) and §5.12.

segments depends on `identity` (audit, access decorators, warehouses), `catalog`, `partners`, `inventory` and `pricing`, reading each through its `index.ts`. **Nothing imports segments** (ESLint G1, like `ai`): catalog and partners declare resolver hooks that `SegmentsModule` binds, so their lists narrow to a segment without depending on this module.

## 1. Owner's answers behind the design

Interview of 2026-10-14 (four rounds, after erxes screenshots of a filter menu with «1751 Records Found» and a segment page):

- **Product list.** Filters on suppliers, home warehouse and prices; stock (in, out, at or below the minimum, per warehouse); the dates registered and changed; missing data, with «no barcode on the base unit» and «no barcode at all» as two filters.
- **Ticked rows** go to Excel, are changed together (category, main supplier, price profile, home warehouse), deactivated or reactivated, and later print supermarket price labels (the owner sends the template; SPEC §11 #27).
- **Export.** «As shown»: the ticked rows if any, else every row the filters keep, with the visible columns; a new right («Бараа экспортлох»), admins first.
- **Columns** are kept per user on each Chrome (ADR-0050).
- **Segments** for products, customers and suppliers (orders after sales); dynamic (saved conditions), with AND / OR groups; used now to filter lists and count, later for messages, reports and promotions. Admins create them; everyone sees them.
- **Hand-picked product segments** (2026-10-14, ADR-0052): the owner asked to search «түмний», tick every match, search «хараа», tick those too and make one segment of them. Asked whether such a segment should later take in new products of the same name, the owner left it to Claude: it holds exactly the products put in (`kind` LIST), and products are added or removed later from the list's ticks; a search condition still follows the data. The development database has no product with those words; the owner tests with their own products.

## 2. Owned tables

| Table | What | Guards |
|---|---|---|
| `segments` (`0020_segments`, `0021_segment_lists`) | `entity` PRODUCT / CUSTOMER / SUPPLIER, `kind` RULES / LIST (default RULES), `name`, `name_key` (search-normalised), `description`, `definition` (jsonb; NULL for a LIST), `definition_version` (1), `archived_at`, `created_by` / `updated_by` (users, SET NULL), created and updated stamps | CHECKs: the entity, the kind, name 1–80, description ≤ 500, `segments_kind_definition` (a RULES segment has a JSON object, a LIST segment none and is a PRODUCT one); unique live name per entity across both kinds (`segments_live_name` on `(entity, name_key)` where `archived_at IS NULL`); `REVOKE DELETE, TRUNCATE` from app: a segment is archived, never deleted |
| `segment_products` (`0021_segment_lists`) | the members of a LIST segment: `segment_id`, `product_id`, `added_at`; primary key `(segment_id, product_id)` | foreign keys to `segments` and `products` (a member is a product that exists; the key takes `FOR KEY SHARE` on the product, so members are inserted in ascending product order, architecture §5.3); `REVOKE UPDATE, TRUNCATE` from app: members are inserted and deleted only, by `SegmentListsService` under the segment row's lock |

The definition's shape is checked by `segmentIssue` (shared) on every write and again on every read: a stored definition the registry no longer accepts answers `SEGMENT_INVALID` instead of running. A LIST segment has no definition: its members are read as they are.

## 3. Public API (`modules/segments/index.ts`)

| Export | Use |
|---|---|
| `SegmentsModule` | binds catalog's `PRODUCT_SET_RESOLVER` and partners' `PARTNER_SET_RESOLVER` to `SegmentEvaluator` (`useExisting`); provides `SegmentsService`, `SegmentListsService` and `ProductExportService` |
| `SegmentsHttpModule` | the controllers (api only) |

Inside the module:

| Service | Use |
|---|---|
| `SegmentEvaluator.evaluate(ctx, entity, definition)` | the ids a checked definition keeps, ascending. Each leaf condition is answered by the module that owns its data, through its public services (catalog `ProductFiltersService`, partners `ProductSuppliersService` / `CustomersService` / `SuppliersService`, inventory `ProductLocationsService` / `StockQueryService`, pricing `ProductPricesService` on the Ulaanbaatar day); ALL intersects, ANY unites, a negative operator (NOT_IN, NONE, OUT_OF_STOCK) subtracts its positive form from the entity's universe, read only when needed. Leaves run one after another (the pool is small); a condition repeated in a request is asked once; an empty ALL stops early |
| `SegmentEvaluator.productIds({ where?, segmentId? })`, `ids(ctx, entity, segmentId)`, `ofSegment`, `count` | the two hooks' answers; `segmentId ∧ where` intersect; a LIST segment answers with its members, ascending (inactive products too), and counts them; an unknown or archived segment is 404, another entity's segment 422 |
| `SegmentsService.list / get / counts / preview / create / update / archive` | the routes below; customer segments, their counts and previews need `partners.customers.read`; references (categories, suppliers, price profiles, warehouses) must exist (422 at `definition.groups.G.conditions.C.ids` or `.warehouseId`); `update` changes a LIST segment's name and description only |
| `SegmentListsService.create / add / remove` (ADR-0052) | hand-picked product segments: ids sorted without repeats and checked with catalog's `ProductQueryService.orderedOf` (an unknown one → 422 at `productIds`, `exists`); the segment row locked `FOR UPDATE` (404 unknown or archived, 422 at `id` `kind` for a RULES one); members written by one statement over an id array (`unnest` / `= ANY`, ascending), at most 20,000 (`MAX_SELECTED_PRODUCTS`, 409 `SEGMENT_TOO_LARGE` with `count` and `limit`); `{ changed, unchanged, count }`; one audit row per action |
| `ProductExportService.workbook({ productIds?, filters, columns })` | the product export (ADR-0049 #6), below |

## 4. REST surface (`/api/v1`)

| Route | Access | Notes |
|---|---|---|
| `GET /segments?entity&cursor&limit` | authenticated | live segments by name, keyset; customer segments only with `partners.customers.read` |
| `GET /segments/counts?segmentIds=…` | authenticated | 1–50 ids → `[{ segmentId, count }]`; `count` null for an unknown, archived, unreadable or no longer valid segment. Declared before `:id` |
| `GET /segments/:id` | authenticated | 404 when unknown or archived; 403 for a customer segment without `partners.customers.read` |
| `POST /segments/preview` | `segments.manage` | `{ entity, definition }` → `{ count }`, 200: the editor's live count |
| `POST /segments` | `segments.manage`, Idempotency-Key | `{ entity, name, description?, definition }` → 201; a live name taken in the entity → `DUPLICATE_VALUE` |
| `PUT /segments/:id` | `segments.manage` | `{ name, description?, definition? }`; the entity and the kind never change; an omitted description is cleared; a RULES segment needs its definition (422 `required`), a LIST segment takes none (422 `notAllowed`) |
| `POST /segments/lists` | `segments.manage`, Idempotency-Key | `{ name, description?, productIds }` (1–20,000, repeats dropped) → 201, a PRODUCT segment of kind LIST (ADR-0052); a live product segment of the same name → `DUPLICATE_VALUE` |
| `POST /segments/:id/products` | `segments.manage`, Idempotency-Key | `{ productIds }` → 200 `{ changed, unchanged, count }`: products added, those already in, the size afterwards; past 20,000 → 409 `SEGMENT_TOO_LARGE` |
| `POST /segments/:id/products/remove` | `segments.manage`, Idempotency-Key | `{ productIds }` → 200 `{ changed, unchanged, count }`: products taken out, those not in it |
| `DELETE /segments/:id` | `segments.manage` | archives, 204 |
| `POST /exports/products` | `catalog.products.export` | `{ productIds }` (1–20,000, alone) or the product list's filters (`q`, `categoryId`, `status`, `saleReady`, `where`, `segmentId`) with `columns` (the list's keys but the photo, written in the list's order) → an `.xlsx`, 200 (`Content-Disposition` «Бараа YYYY-MM-DD.xlsx»); more than 20,000 rows → 422 `EXPORT_TOO_LARGE` (`params.count`, `params.limit`); a third export while two run → 429 `TOO_MANY_REQUESTS`; ticked products with filters → 422 at `productIds` (`alone`) |

The filtered lists themselves stay with their owners: catalog's `POST /products/query` (`where`, `segmentId`, `total` on the first page) and `POST /products/query/ids` (every id the filters keep, at most 20,000, ADR-0052), and partners' `segmentId` on `GET /customers` and `GET /suppliers` (`docs/modules/catalog.md` §4, `partners.md` §4).

## 5. Rules worth knowing

- **The registry** (`@tugeel/shared/segments`, `SEGMENT_FIELDS`). PRODUCT: `search`, `category` (with subcategories), `stage` (ACTIVE / PENDING / INACTIVE), `createdAt` / `updatedAt` (BETWEEN or LAST_DAYS, Ulaanbaatar days, both ends included), `missing` (one of BASE_BARCODE, ANY_BARCODE, PHOTO, WEIGHT, EBARIMT), `supplier` (IN, MAIN_IN, NOT_IN, ANY, NONE), `homeWarehouse`, `stock` (IN_STOCK, OUT_OF_STOCK, AT_OR_BELOW_MIN; one warehouse, else the selling ones: WHOLESALE and STORE), `priceProfile`, `warehousePrice` (BETWEEN whole tugriks, on today's terms). CUSTOMER: `search`, `kind`, `status`, `creditHold`, `tinPending`, `gpsMissing`, `createdAt`. SUPPLIER: `search`, `status`, `products` (ANY / NONE), `createdAt`. Limits: 10 groups, 10 conditions a group, 30 in all, 200 ids a condition.
- **A hand-picked segment** (ADR-0052) never follows the data: new products join only through «Сегментэд нэмэх»; an inactive product stays a member; the segment's size is at most 20,000 like the list's ticks.
- **«Шинэчилсэн огноо»** is the product's own data: unit, barcode and photo changes touch `products.updated_at` (catalog's `touchProduct`, under the product's row lock).
- **Scale.** With 20,000 products (integrity `segments.spec.ts`, logged): a list page under three conditions 92 ms, ten segment counts 0.5–0.7 s, the whole catalogue to Excel 5.6 s on the owner's machine. Beyond about 20,000 records the evaluator would move to SQL fragments (ADR-0049 #3).
- **The export** settles its ids first (the ticked ones in the list's order, or what the filters keep, at most 20,000), then reads the rows in one REPEATABLE READ transaction, 1,000 at a time, from catalog, pricing, inventory and partners (only the chosen columns' owners). Codes and barcodes are text cells, prices and weights numbers, several values one cell joined by «, », an empty value an empty cell; headers come from mn.json. The download helper `common/excel/xlsx-file.ts` serves ai, imports and the export.

## 6. Error codes introduced

`SEGMENT_INVALID` (409, `params.name`, `params.issue`), `EXPORT_TOO_LARGE` (422, `params.count`, `params.limit`), `SEGMENT_TOO_LARGE` (409, `params.count`, `params.limit`; ADR-0052). Catalog's `SELECTION_TOO_LARGE` (422) answers more than 20,000 matches on the id route. Also used: `VALIDATION_FAILED` (a condition's path and its issue code, e.g. `where.groups.0.conditions.0.field` / `FIELD_NOT_ALLOWED`; the issue codes are translated under `segments.issues.*`), `DUPLICATE_VALUE`, `NOT_FOUND`, `FORBIDDEN`, `TOO_MANY_REQUESTS` (429), and in the owners `SERVICE_UNAVAILABLE` (503) when no resolver is bound — a filtered list never answers with every row.

## 7. Audit

`segments` CREATE (a list's with its `productIds`), UPDATE (name, description and definition before and after), ARCHIVE, and for a list `ADD_PRODUCTS` / `REMOVE_PRODUCTS` (the ids that changed and the size afterwards; none when nothing changed) — one row per action on the segment, not one per product (ADR-0052 #4).

## 8. Screens (`apps/web`)

- **Menu «Сегмент» → «Сегментүүд»** (`/segments`, everyone): one entity at a time (a `SegmentedControl`; «Харилцагч» only with `partners.customers.read`), the live segments with their description and count («128 бараа», «Тоолох боломжгүй» for a stale one); «Сегмент үүсгэх» with `segments.manage`.
- **A segment** (`/segments/:id`): its type and count in the header, the conditions in words (group by group, «ба» / «эсвэл» between them), «Жагсаалтаар харах» (the entity's list with `?segment=`), «Засах» and «Архивлах» (asked first) for admins. A hand-picked segment carries the «Сонгосон бараа» badge (also in the list) and, instead of conditions, a line saying new products never join by themselves and how to add or remove them; its form keeps the name and the description only.
- **The editor** (`/segments/new?entity=`, `/segments/:id/edit`, `segments.manage`): name, description, the type (fixed after creation) and the groups: each group «Бүгд биелэх» or «Аль нэг нь биелэх» once it has two conditions, and the groups joined the same way; a condition picks its field, its operator and its value (records from a dialog with a search for suppliers; values as checkboxes or a select; dates, days, tugriks, a word or a warehouse). The shared rules name what is missing; otherwise «Таарах: N» follows the conditions a moment after typing stops.
- **«Сегмент болгох»** on the product list (with `segments.manage`, when a search, category, status or filter is set) opens the editor with those conditions (`from=` the list's query; a segment filter is left out: segments do not nest).
- **Customers and suppliers**: «Бүх сегмент» narrows the list to a segment (`?segment=`), shown when the entity has segments.
- **The product list's «Сегмент» menu** (ADR-0052, `segments.manage`, `features/segments/segment-actions.tsx`) in the selection bar: «Сонгосноор сегмент үүсгэх» (name and description; then the new segment's page, the ticks cleared), «Сегментэд нэмэх…» (when a hand-picked segment exists; only those are offered) and «Сегментээс хасах» (while the list is filtered by a hand-picked segment; asked first); toasts say how many changed and how many already were in (or not in).
- The product list's «Шүүлтүүр», chips, count, ticks (kept across searches, «Таарсан бүгдийг сонгох»), selection bar, Excel and bulk changes are catalog's screen (`docs/modules/catalog.md` §8).

Verified in the browser on 2026-10-14 against the dev database, signed in as `admin` and as `nyarav`: filters by supplier and missing data (chips, count, URL), «Сегмент болгох» with a second condition in the OR group (live count 1 → 2), the saved segment's page and its filtered list, ticking and the bulk category, home (no change) and status changes, all undone afterwards, the test segment archived; `nyarav` sees no ticks, Excel, bulk or segment buttons; phone width (375 px) and 1280 px measured without horizontal overflow.

Hand-picked segments verified in the browser on 2026-10-14 (ADR-0052) against the dev database's 20,000 test products, as `admin` and `nyarav`: «алтан» ticked on the loaded page, then «Таарсан бүгдийг сонгох (400)»; «номин» searched with the 400 kept and ticked the same way (800); a product opened by mistake and «back», then a reload, kept the 800; «Засах» → «Ангилал солих» with 800 ticked only explained the 500 limit; «Сонгосноор сегмент үүсгэх» made the segment (its page: «Сонгосон бараа», 800; the ticks cleared); filtered by it, two ticked rows taken out (798) and one «говь» product added from another search (799); the name changed on a form without conditions; the audit showed «Үүсгэсэн», «Бараа хассан», «Бараа нэмсэн», «Өөрчилсөн»; with no filter the bar said «Таарсан 20,006 бараа байна; нэг удаад 20,000 хүртэл сонгоно.»; at 375 px the bar wrapped inside the page; `nyarav` read the segment and its list (799) without ticks or menus. The test segment was archived afterwards. Fixed after the walk: the line on how to add and remove products shows only to those who may.

## 9. Tests

Shared (Vitest): `segments.test.ts` (the registry, every issue and its path, `positiveCondition`, `conditionDays`). Api unit: `set-algebra.spec.ts`. Integration: `segments.int-spec.ts` (every product condition from its owner, AND / OR groups with the list's own filters and pagination, refused conditions at their path, CRUD with Idempotency, names, references, rights, counts, previews, archiving, customer segments and rights, the supplier list's segment and ids, `updated_at` after a barcode), `product-export.int-spec.ts` (columns in the list's order, cells by kind, ticked rows, conditions, refusals), `segment-lists.int-spec.ts` (ADR-0052: a list made of ticked products with repeats dropped and read by the list, its ids, the export and the counts, inactive members too; unknown products, empty and oversized lists, names shared with RULES segments and a worker refused; adding and removing with what changed, an Idempotency replay and the audit rows; RULES and LIST kept apart, `PUT` by kind, an archived list unusable). Integrity: `segments.spec.ts` (REVOKE DELETE / TRUNCATE, the CHECKs, live names; 20,000 products: page < 500 ms, ten counts < 2 s, the export of all 20,000 two at a time, a third refused with 429, 20,001 refused; the ids of 20,000 within a second and the 20,001st refused; list members only of products and only in a product LIST segment, never updated or truncated; a list of the whole catalogue paging within 500 ms and refusing the 20,001st, also when two additions race), `bulk-races.spec.ts` (an addition in reverse order beside bulk and single product changes). Web: `segments-pages.test.tsx` (the list and counts, a segment in words, archiving, creating with groups and a live count, the name required, «Сегмент болгох», the customer list's segment, a hand-picked segment's badge, page and name-only form, its how-to only for admins), `segment-definition.test.ts`, the product list's filters, export, kept ticks, «Таарсан бүгдийг сонгох» and the «Сегмент» menu in `catalog-pages.test.tsx` and `product-filters.test.ts`.

## 10. Open items

- Supermarket price labels for ticked products: when the owner sends the template (SPEC §11 #27, TODO-VERIFY).
- Order segments, after sales.
- A full filter menu on the customer and supplier lists (today: the segment select).
- «Сонгосныг харах»: the list showing only the ticked products (a `productIds` filter on `/products/query`, ADR-0052 follow-up).
- Ticks and hand-picked segments on the customer and supplier lists, when asked.
- Segments in promotions (pricing) and messages (notifications) through the same hooks.
- Segments inside segments: not planned.
