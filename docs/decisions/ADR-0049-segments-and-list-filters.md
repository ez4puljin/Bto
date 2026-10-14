# ADR-0049: Segments are saved conditions that the data owners evaluate; lists narrow through resolver hooks

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0037 (Consequences: another module's data can now narrow a list on the server, through the owner's resolver hook); architecture §4 (a new `segments` module) |
| Amended by | ADR-0052 (#1: a product segment may also be a hand-picked list, `kind` LIST, with members in `segment_products`; the product list's ticks stay across searches) |

## Context

On 2026-10-14 the owner showed erxes screens and asked for three things on `/catalog/products`:

- a «Шүүлтүүр» menu;
- checkable rows;
- an «Export» button.

The owner also asked for a «Segment» module where segments are created from the available properties. Four rounds of structured questions settled the details:

- **Filters.** On top of today's search, category and status:
  - supplier, home warehouse, price profile and a warehouse price range;
  - stock: in stock, out of stock, or at or below the minimum, per warehouse or in any;
  - created and updated dates;
  - missing data: no barcode on the piece, no barcode at all, no photo, no weight, no e-Barimt codes, no supplier, no home warehouse, no price.
- **Export.** The rows as the list shows them: the ticked rows if any, else every row the filters keep; the visible columns. A new right, «Бараа экспортлох», for admins first.
- **Segments.**
  - Entities: products, customers and suppliers; orders once `sales` exists.
  - Kind: dynamic, i.e. saved conditions whose members follow the data. Conditions combine in AND/OR groups.
  - Rights: admins create them, everyone sees and uses them.
  - Uses: filtering lists and counting now; later messages to customer segments, Excel and reports, and discounts or promotions aimed at a segment.

The product list's data belongs to four modules: catalog, partners (suppliers), inventory (home warehouse, stock) and pricing (price terms). ESLint G1 lets catalog import only identity. ADR-0037 therefore kept other modules' data out of the list's server-side filters. No owner module could yet return "the products that match X" as a set or a count.

## Decision

1. **A new module, `segments`.**
   - **Dependencies.** It depends on identity, catalog, partners, inventory and pricing, at the level of `imports`.
   - **Isolation.** Nobody imports it. ESLint gets a rule like the one for `ai`.
   - **What it owns:**
     - the `segments` table;
     - the CRUD routes;
     - the evaluator that turns a condition tree into ids;
     - the product export.
   - **The table** (migration `0020_segments`):
     - columns: `entity` (PRODUCT, CUSTOMER, SUPPLIER), `name` (unique among live segments of an entity), `description`, `definition` (jsonb) and `definition_version`;
     - a segment is archived, never deleted: `REVOKE DELETE`, so later discounts and messages can refer to it.
2. **The condition model lives in `@tugeel/shared/segments`.**
   - **Shape.** A definition is a match (`ALL` / `ANY`) over groups; each group is a match over conditions. This expresses (A ∧ B) ∨ (C ∧ D) and (A ∨ B) ∧ (C ∨ D).
   - **A condition** is flat: `field`, `op`, and the slots its operator needs (`ids`, `values`, `from`/`to`, `days`, `min`/`max`, `warehouseId`, `text`).
   - **A registry** names each entity's fields, the module that owns each field's data, and the field's operators.
   - **`segmentIssue()`** checks a definition and returns an issue code and path. The api, the database row and the web editor use the same function.
   - **Limits:** 10 groups, 10 conditions per group, 30 conditions in all, 200 ids per condition.
   - **Meaning:**
     - a negative operator (`NOT_IN`, `NONE`, `OUT_OF_STOCK`) means "all records except the matching ones";
     - dates are Ulaanbaatar days, both ends included;
     - price terms and "today" use the Ulaanbaatar business date;
     - "in stock in any warehouse" counts wholesale and store warehouses, not transit or vehicles;
     - «шинэчилсэн» is a change to the product's own data, so unit, barcode and photo changes now touch `products.updated_at`.
3. **The data owners evaluate.**
   - **Leaves.** Each leaf condition is answered by the module that owns its data, through a new method in that module's `index.ts`. The method returns ascending ids:
     - catalog: search, category subtree, stage, dates, missing barcode / photo / weight / e-Barimt data;
     - partners: products of suppliers, with or without a supplier;
     - inventory: home warehouse, stock state;
     - pricing: price profile, warehouse price.
   - **Combining.** The evaluator combines the sets: AND is intersection, OR is union, a negation is the universe minus the set.
   - **The universe** is read only when needed:
     - for products, every product, inactive ones too;
     - for customers, those the caller may see;
     - for suppliers, all of them.
   - **Running.** Leaves run one after another (the pool is small), and identical leaves are evaluated once per request.
   - **Scale.** At up to ~20,000 products this takes milliseconds. Composing owners' SQL fragments into one statement is the path if the catalog ever passes ~100,000 products.
4. **Lists stay with their owners.**
   - **Hooks.** The owner declares a resolver hook, and `SegmentsModule` binds it to its evaluator, as pricing binds catalog's `UNIT_SUPERSEDED_HOOK`.
     - catalog declares `PRODUCT_SET_RESOLVER`;
     - partners declares `PARTNER_SET_RESOLVER`.
   - **`POST /products/query`** (catalog) takes today's filters plus `where` (a definition) and `segmentId`. It returns catalog's own rows, in catalog's order, with catalog's cursor, plus a total on the first page.
   - **Partners** lists take `segmentId` on `GET /customers` and `GET /suppliers`.
   - **No hook bound.** A filter sent while no resolver is bound is refused with 503 `SERVICE_UNAVAILABLE`, never answered unfiltered.
   - **Later consumers** use the same hooks and never import segments, so no cycle forms:
     - discount programs in pricing, which depends on catalog;
     - messages in notifications, which depends on partners;
     - a promotions module.
5. **Segment routes and rights.**
   - **Writes.** `segments.manage` («Сегмент удирдах», admins first) creates, changes and archives segments:
     - `POST /segments` is idempotent;
     - `PUT /segments/:id` cannot change the entity;
     - `DELETE /segments/:id` archives.
   - **Reads** need any signed-in user: list, read, a batch of counts (≤ 50) and a live preview count. Customer segments, their counts and their previews need `partners.customers.read`.
   - **Names.** A taken name is `DUPLICATE_VALUE`.
   - **Stale definitions.** A stored definition that no longer validates answers 409 `SEGMENT_INVALID`.
   - **Audit.** Changes are audited (CREATE, UPDATE, ARCHIVE).
6. **The product export** (`POST /exports/products`, in segments).
   - **Right.** It needs the new `catalog.products.export` («Бараа экспортлох», admins first).
   - **Rows.** Either the ticked rows (≤ 20,000 ids) or the list's filters, in the list's order.
   - **Columns.** The visible columns, with the list's column keys; the image is not exported.
   - **Consistency.** Rows are read in one REPEATABLE READ transaction, 1,000 at a time, from the four owners' public services.
   - **The workbook** is written by `common/excel/table-workbook.ts`:
     - SKU and barcodes as text, prices and weight as numbers;
     - headers from mn.json.
   - **Limits.**
     - More than 20,000 rows is 422 `EXPORT_TOO_LARGE`.
     - At most two exports run at once per process (429 `TOO_MANY_REQUESTS`).
     - The download helper moves from the ai controller to `common/excel` and serves ai, imports and the export.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `segments` serves the product rows (`POST /segments/products/query`) | It would need catalog's row DTO and mapper, which `index.ts` does not export. A second schema of the same name collides in OpenAPI. It goes against ADR-0037 #2 (the owner enriches its own list) and would repeat for customers and suppliers. |
| Catalog declares filter-provider tokens that every other module binds | Catalog would own the AND/OR logic. Partners would repeat it for customers, and sales for orders. Segment storage still needs a home. |
| The web combines the filters | It puts business rules in a client (architecture §1) and moves 20,000-id payloads around. Pricing and notifications could not reuse it. |
| `segments` returns ids, the web reads rows from catalog by id | Two round trips per page and a two-step table, for the same result. |
| Owners return SQL fragments composed into one statement | Fast with exact counts, but table shapes leak between modules and owners can no longer be tested alone. Kept as the scale-up path. |
| Views like the assistant's `ai` schema | They repeat owner rules in SQL. The `app` role may not read them (ADR-0045). |
| Hand-picked (static) segments | The owner chose dynamic segments. |
| Segments inside segments | Not asked for. AND/OR groups cover the owner's examples. |

## Consequences

**Positive.**
- One mechanism serves the lists now and discounts, messages and orders later.
- Every rule is answered by the module that owns it, and G1 stays intact.
- The list shows a total count.

**Negative.**
- Each filtered request evaluates again; there is no cache across requests.
- A count costs one query per leaf.
- Id sets are held in memory, which suits tens of thousands of records, not millions.
- Registry changes must stay additive, or a migration rewrites the stored definitions.
- The product list makes a POST read (precedent: `POST /pricing/quote`).

**Follow-ups.**
- Customer and supplier lists get only a segment filter now; their full filter menus come when asked.
- Order segments come with `sales`.
- Discount programs and messages aimed at a segment resolve the hooks; archiving a segment then asks its users first.
- Supermarket price labels for ticked rows wait for the owner's label template (SPEC §11 #27).

## Related

ADR-0027, ADR-0037, ADR-0039, ADR-0045, ADR-0048, ADR-0050, ADR-0051, SPEC §5.2, §5.16, §6.15, architecture §4, §6, `docs/modules/segments.md`.
