# ADR-0052: Hand-picked product segments, and ticks kept across searches

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0049 (#1: a product segment may also be a hand-picked list; the rejected alternative «hand-picked segments» is now built); ADR-0051 (#3: the bulk changes act on every ticked product and refuse more than 500 in their dialogs; «Идэвхгүй болгох» and «Идэвхжүүлэх» both sit in «Засах»; the follow-up «Таарсан бүх N-ийг сонгох» is built); ADR-0050 (screen state: the product list's ticks live in `sessionStorage`, per user and tab) |

## Context

On 2026-10-14 the owner asked for this flow on `/catalog/products`:

1. search «түмний»;
2. tick every product found;
3. search «хараа» and tick those too;
4. make a segment of the ticked products.

Three things stood in the way:

- **Ticks.** A change of search or filter cleared them (the product list as built for ADR-0049 and ADR-0051, `docs/ui.md`), so ticks from two searches could never meet.
- **The header checkbox.** It ticks only the loaded rows. The list loads 50 at a time.
- **Segments.** They were saved conditions only (ADR-0049 #1). SPEC §5.16 said «гараар сонгосон жагсаалт биш».

The owner was asked whether such a segment should later take in new products of the same name by itself. They left it to Claude. The recommendation was taken: the segment holds exactly the products put in, and products are added or removed later from the list's ticks. A search condition («түмний» OR «хараа») remains the way to follow the data; it already works through «Сегмент болгох».

The development database has no product with those words. The owner tests with their own products; the walk uses the test products' names.

## Decision

1. **Two kinds of segment.**
   - **`segments.kind`:**
     - `RULES`: ADR-0049's saved conditions;
     - `LIST`: products only; the members are exactly the products put in, and new products never join by themselves.
   - **Definition.** A LIST segment's `definition` is NULL. One CHECK ties kind, definition and entity together.
   - **Members.** They live in `segment_products (segment_id, product_id, added_at)`, with primary key `(segment_id, product_id)` and foreign keys to `segments` and `products`. The table is owned by the segments module.
   - **Rights on the table.** `REVOKE UPDATE, TRUNCATE`: members are only inserted and deleted. Segments themselves are still never deleted.
   - **Names.** A live name is unique per entity across both kinds.
   - **Migration** `0021_segment_lists`.
2. **Evaluation.**
   - For a LIST segment the evaluator reads its members, ascending, both for the ids (`ofSegment`) and for the count.
   - Every consumer of a `segmentId` takes both kinds unchanged: the product list, the id route below, the Excel export, and later discounts and messages.
   - Inactive products stay members.
3. **Routes.**
   - **Common to the three routes:** `segments.manage`, `@Idempotent()`.

   | Route | Body | Answer |
   |---|---|---|
   | `POST /segments/lists` | `{ name, description?, productIds }` | 201 with the segment |
   | `POST /segments/:id/products` | `{ productIds }` | 200 `{ changed, unchanged, count }` |
   | `POST /segments/:id/products/remove` | `{ productIds }` | 200 `{ changed, unchanged, count }` |

   - **Ids.** 1–20,000 per request; repeats are dropped (no `@ArrayUnique`, which is quadratic). `count` is the segment's size afterwards.
   - **Refusals:**
     - an unknown product → 422 at `productIds` (`exists`);
     - a RULES segment → 422 at `id` (`kind`);
     - an unknown or archived segment → 404;
     - more than 20,000 members → 409 `SEGMENT_TOO_LARGE` `{ count, limit }`.
   - **Writing.**
     - The segment row is locked `FOR UPDATE`.
     - Members are written by one statement over an id array (`unnest`, `= ANY`), which avoids the 65,535-parameter limit.
     - Members are inserted in ascending id order. The product foreign key takes `FOR KEY SHARE` on each product, so this keeps to the order every product writer locks in (architecture §5.3).
   - **`PUT /segments/:id`.**
     - On a LIST segment it changes the name and description only; a definition is 422 (`notAllowed`).
     - A RULES segment still needs its definition (422 `required`).
   - **Reads.** They return `kind`, and `definition` is null for a LIST segment.
4. **Audit.** One row per action, on the segment:
   - `CREATE` carries the `productIds`;
   - `ADD_PRODUCTS` / `REMOVE_PRODUCTS` carry the ids that changed and the size afterwards;
   - an action that changes nothing writes no row.

   ADR-0051 writes one row per product because the products change there. Here the segment changes. Twenty thousand rows (~4 MB) per click would flood the append-only log.
5. **Ticking every match.**
   - **Route.** `POST /products/query/ids` (catalog, any signed-in user) takes the product list's filters, without cursor or limit.
   - **Answer.** The ids in the list's order, at most 20,000 (`MAX_SELECTED_PRODUCTS`, the export's limit). Above that it answers 422 `SELECTION_TOO_LARGE` `{ count, limit }`.
   - **Nature.** It is a capped set read like the export, not a page.
6. **Ticks on the product list.**
   - **Kept across searches.** They stay when the search or a filter changes, so ticks gathered from several searches go together. The bar's count shows them all.
   - **Storage.** `sessionStorage`, per user and tab: `tugeel.catalog.products.selection.v1:<userId>`.
     - This is screen state, not business data.
     - Ticks survive a product opened by mistake (a click beside the box opens it, ADR-0042 #6) and a reload.
     - They end with the tab, and another user in the tab starts with none.
   - **The header checkbox** still ticks the loaded rows. When every loaded row is ticked and the filters keep more, the selection bar offers «Таарсан бүх N-ийг сонгох». Afterwards unticking the header removes all those matches again.
   - **Limit.** At most 20,000 ticks.
7. **Actions on the ticks.**
   - **Bulk changes.** They act on every ticked product, loaded or not. Above 500 their dialogs explain the limit and offer no save button.
   - **Status.** «Идэвхгүй болгох» and «Идэвхжүүлэх» both sit in «Засах», because the status of products outside the loaded pages is unknown. The server's `unchanged` reports those already so.
   - **Names in the home move.** The products with stock elsewhere are named from the loaded rows, else read one by one (at most five are named).
   - **Excel** takes the ticks as before (≤ 20,000).
   - **The «Сегмент» menu**, for `segments.manage`:
     - «Сонгосноор сегмент үүсгэх» (name and description, then the new segment's page);
     - «Сегментэд нэмэх…» (a LIST segment);
     - «Сегментээс хасах» (while the list is filtered by a LIST segment).
   - **Who ticks.** `segments.manage` now lets a user tick rows.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A `product IN ids` condition inside a RULES definition | Up to 20,000 ids in the jsonb definition and in the condition editor. Adding or removing would need rules about where in the AND/OR tree to write. |
| A separate table and routes for lists | Two name spaces and two pickers. Every later consumer (discounts, messages) would take a second parameter. |
| A trigger keeping members to LIST segments | It runs per row on 20,000-row inserts. The only writer locks the segment row first, and members of a RULES segment would be ignored anyway. |
| The header checkbox ticks every match | It needs a per-filter cache of ids and a waiting state on the checkbox. It would also silently tick thousands against the bulk changes' 500. |
| One audit row per member | 20,000 rows (~4 MB) per click in an append-only log. |
| Ticks in `localStorage` | They would outlive the tab and come back days later. |

## Consequences

**Positive.**
- The owner's flow works in a few clicks.
- A list segment feeds the product list, Excel and later discounts like any segment.
- Ticks survive a mistaken click.

**Negative.**
- A list segment does not follow the data: new products are added by hand. A RULES search segment does follow it.
- Ticks may include rows the screen does not show; the bar's count is the reminder.
- The bulk changes still refuse more than 500 at once.
- A list's audit names product ids, not names.

**Follow-ups.**
- «Сонгосныг харах»: show only the ticked products, through a `productIds` filter on `/products/query`.
- Ticks and list segments on the customer and supplier lists, when asked.

## Related

ADR-0037, ADR-0042, ADR-0049, ADR-0050, ADR-0051, SPEC §5.2, §5.16, §6.15, architecture §4, §5.3, §5.12, §6, `docs/modules/segments.md`, `docs/modules/catalog.md`, `docs/ui.md`.
