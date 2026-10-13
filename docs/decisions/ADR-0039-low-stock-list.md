# ADR-0039: The low-stock list comes from levels and empty balances

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | — (adds to SPEC §5.4, §5.5, §8.2 #4 and ADR-0036; the levels of `product_locations` since ADR-0033) |

## Context

SPEC §5.4 asks for a low-stock list; architecture §5.1 says the minimum and maximum of `product_locations` drive it. Those levels could only be set one product at a time on the product page, so with the owner's thousands of products the list would stay empty. Asked on 2026-10-13, the owner chose: (1) the list shows products at or below their minimum **and** products a warehouse held that are now out of stock, even without a minimum, with the quantity to bring them up to the maximum; (2) levels come from an Excel template as well as the product page; (3) at the supermarket, rows of the list become a transfer request to a wholesale warehouse, and a wholesale list shows the main supplier (purchase orders come with procurement, delivery 8).

## Decision

1. **The list.** `GET /stock/low?warehouseId` returns, for one warehouse, `LOW` rows (a minimum is set and the warehouse's on-hand, lots summed, is at or below it) and `OUT` rows (no minimum, a `warehouse_stock` row exists and holds 0: the warehouse carried the product). Out of stock first, then by product, keyset by (rank, product). Inactive products are left out; a page is filled past them with a few more reads. Each row carries the product with its base unit, on-hand, minimum, maximum, the suggested quantity (maximum, else minimum, minus on-hand; none without a level or when nothing is missing) and the product's home warehouse. Every signed-in user reads it, like the stock pages; it never carries a cost. On-hand is used rather than available stock while there are no reservations (delivery 2 revisits it).
2. **Levels by Excel.** A fifth import kind `LEVELS` («Доод/дээд хэмжээ»): warehouse (wholesale or the supermarket, by code or name), SKU, unit (default the base unit), minimum, maximum, in that unit and exact in base units. An empty cell keeps the stored level, as everywhere in the imports; a row with neither level is `REQUIRED`; the resulting minimum above the maximum is `MIN_ABOVE_MAX`; the receipts' home rule applies to wholesale warehouses (`NOT_ALLOWED`). Rows plan CREATE (no levels before), UPDATE or UNCHANGED. The commit writes through `ProductLocationsService.setLevelsManyInTx` under the table lock; the revert restores the previous levels only where the imported ones still stand, and removes a location row the import created and left empty. Migration `0011_imports_levels` widens `import_jobs_kind`.
3. **Asking from the supermarket.** On a store's list, a holder of `inventory.transfers.manage` who writes for the store selects rows and creates one `REQUEST` draft from a chosen wholesale warehouse (default: the home most selected rows share), each line in the base unit at the suggested quantity (1 without one); the draft opens on the transfer page, where quantities and units are edited before the request is sent (ADR-0035 unchanged).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Only products below a minimum | The owner wanted out-of-stock products listed without first setting thousands of levels. |
| Only out-of-stock products | The owner wanted the minimum to warn before nothing is left. |
| Levels as columns of the product template | They belong to a warehouse, and the supermarket needs its own; a separate template covers every warehouse. |
| Editing levels on the list | Not chosen by the owner; the product page and the template cover it. |
| Available (sellable − reserved) instead of on-hand | Nothing is reserved before delivery 2; on-hand is what the warehouse sees. |

## Consequences

**Positive.** The list is useful from the first opening stock (out-of-stock products) and grows with the levels the owner imports; the supermarket's refill becomes a few clicks instead of typing a transfer.

**Negative.** A product a warehouse once held and will never carry again stays `OUT` until its balance row moves on (a later decision may add "do not stock here"). A page may come back shorter when many inactive products sit together.

**Follow-ups.** Delivery 2: consider available stock and reservations. Delivery 8 (procurement): purchase-order suggestions from the same levels, `reorder_rules` and sales speed (SPEC §5.11).

## Related

SPEC §5.4, §5.5, §8.2 #4; ADR-0033, ADR-0035, ADR-0036; `docs/modules/inventory.md`, `docs/modules/imports.md`.
