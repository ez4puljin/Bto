# ADR-0037: Lists that show several modules' data read them per page; column choices stay in the browser

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-12 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | — (adds to ADR-0004 #3, architecture §6) |
| Amended by | ADR-0042 (#4: rows of lists whose records have their own page open them on a click anywhere and end with a chevron; the «Засах» / «Харах» button is gone; lists edited in dialogs keep their row buttons); ADR-0047 (#3: a device also keeps a transfer's unsent ship and receive counts and the last chosen warehouse) |

## Context

While checking the delivery-1 screens on 2026-10-12 the owner asked for every piece of product information to be visible as a column of the product list, with a «Баганууд» button to choose the columns, remembered on the computer, and no stock columns. Product information is spread over three modules: `catalog` (names, units, barcodes, VAT), `partners` (suppliers) and `inventory` (home warehouse, fixed shelves). The module graph (§4, ESLint G1) lets inventory and partners read catalog but never the reverse, so the catalog API cannot join the other two. The owner also could not find how to edit a product: the list only linked the product name.

## Decision

1. **Batch reads per page.** A list screen that shows data owned by other modules reads it from each owner with one request per loaded page, passing the page's ids as a repeated query parameter (`productIds=1&productIds=2`, as openapi-fetch and supertest send arrays; at most `MAX_PAGE_LIMIT` = 200, so one request always covers a page). The owners answer with their usual item shapes; unknown ids return nothing. The first two are `GET /product-suppliers?productIds=…` (partners) and `GET /product-locations?productIds=…` (inventory); `queryIds` in `common/pagination` parses the parameter. A page only asks for what a visible column needs.
2. **The owning module enriches its own list.** `GET /products` returns `ProductListItem` rows (the summary plus weight, e-Barimt codes and the current units with their barcodes), built with one statement per page for units and one for barcodes; `ProductSummary`, which other modules and screens use, is unchanged.
3. **Per-browser preferences live in `localStorage`.** The product list stores the keys of hidden columns under `tugeel.catalog.products.hiddenColumns.v1` (versioned, hidden keys only, so later columns show by default; unknown and locked keys ignored; read and write wrapped so a blocked or full storage keeps the choice for the page's life). Business data, drafts and anything another user or device must see never go there.
4. **Rows open their record.** List rows carry an explicit «Засах» (or «Харах» without the right) button in a sticky first column and open the record on a click anywhere in the row.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One combined endpoint in a higher module (inventory) | A catalog screen's data would belong to inventory, and the price columns of delivery 2 (pricing) could not join it. |
| One request per row | 50 extra requests per page (N+1). |
| Comma-separated ids (`productIds=1,2`) | Needs a string type plus manual split/join or a custom openapi-fetch serializer; the repeated form is what the client already sends. |
| Store column choices on the server per user | More machinery for a preference the owner wanted per computer; can move to a user setting later. |
| TanStack Table for column visibility | Still not needed: visibility is a filter over a column registry (the delivery-1 rule of architecture §2 stands). |

## Consequences

**Positive.** All product information is on one screen without breaking module boundaries; hidden columns cost no requests; the pattern extends to customers, receipts and the delivery-2 price columns.

**Negative.** A column from another module cannot be sorted or filtered on the server by the list's own query; filters on such data stay on the owner's screens (e.g. a supplier's products).

## Related

ADR-0004, ADR-0028, ADR-0032, ADR-0033, `docs/modules/catalog.md`, `docs/modules/partners.md`, `docs/modules/inventory.md`, architecture §6.
