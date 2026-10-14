# ADR-0051: Ticked products are changed in bulk by the module that owns each field

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-14 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | — (adds to ADR-0037, ADR-0044, ADR-0048) |
| Amended by | ADR-0052 (#3: the changes act on every ticked product, loaded or not, and their dialogs refuse more than 500; «Идэвхгүй болгох» and «Идэвхжүүлэх» both sit in «Засах»; «Таарсан бүх N-ийг сонгох» is built) |

## Context

With checkable rows on the product list (ADR-0049), the owner asked on 2026-10-14 to change the ticked products together. Four changes are needed: the category, the main supplier, the price profile, and the home warehouse. Deactivating and reactivating products is also wanted.

The owner's answers:

- **Main supplier.** The old main supplier stays linked as an additional supplier.
- **Price profile.** The new profile applies from a chosen day. The warehouse price stays.
- **Home warehouse.**
  - Products that hold stock elsewhere are shown and confirmed first.
  - When the old warehouse holds no stock of the product, its fixed shelf and minimum/maximum are cleared there.
  - Where stock remains, they stay so it can be shipped out.

Each field belongs to a different module:

| Field | Owner |
|---|---|
| status, category | catalog |
| supplier links | partners |
| home warehouse, shelves | inventory |
| price terms | pricing |

No module writes another's tables.

## Decision

1. **One bulk route per owner.**
   - **Common rules for every route:**
     - 1–500 products (`MAX_BULK_PRODUCTS`); an unknown id refuses the whole request;
     - `@Idempotent()`, 200;
     - the same permission as the single-record change;
     - one audit row per changed product (`recordMany`);
     - the result says what changed and what was already so.

   | Route | Permission | Rule |
   |---|---|---|
   | `POST /products/bulk/status` `{productIds, status}` | `catalog.products.manage` | Products are locked in id order (`CatalogImportService.lockManyInTx`), then updated. The meaning is the same as the product form's: a reactivated product that still waits for prices stays waiting. |
   | `POST /products/bulk/category` `{productIds, categoryId}` | `catalog.products.manage` | Codes are not checked against the new category's range: moving a product keeps its code (ADR-0044 #1). |
   | `POST /product-suppliers/bulk/main` `{productIds, supplierId}` | `partners.suppliers.manage` | The supplier must be active. A linked product has that link made main. Any other product gets a new main link. The previous main link stays as an additional supplier. Supplier links are locked as `linkManyInTx` locks them. |
   | `POST /product-prices/bulk/profile` `{productIds, profileId, validFrom}` | `pricing.prices.manage` | The day is today or later. Products' advisory locks are taken in id order, then the profile `FOR SHARE` (the order of a single change, ADR-0048 #2). The terms in force on that day and every planned row after it are written again with the new profile, the same warehouse price and the same whole unit, under the dated-row rules. Equal rows change nothing. A product without terms is skipped and reported as `NO_TERMS`. |
   | `POST /product-locations/bulk/home` `{productIds, warehouseId, dryRun?}` | `inventory.setup.manage` + write scope | Wholesale warehouses only. `dryRun` answers which products would move and which hold stock in another wholesale warehouse, without writing; the screen asks only when that list is not empty. When applied, the old warehouse's fixed shelf and minimum/maximum are cleared where it holds none of the product. |

2. **Lock order.** The table order of every product writer stands: products, then `product_locations`, then `product_suppliers` (architecture §5.3). A bulk change takes its locks in id order.
3. **On the screen** (`docs/ui.md`). Ticking rows shows a selection bar above the list:
   - «N сонгосон»;
   - «Excel»;
   - «Засах» (category, main supplier, price profile, home warehouse);
   - «Идэвхгүй болгох / Идэвхжүүлэх».

   Each action shows only to a user holding its right. Each opens a dialog that names the count and asks before writing. A toast reports what changed and what was skipped.
4. **Supermarket price labels** for the ticked products are not built yet. They wait for the owner's label template (SPEC §11 #27).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One bulk-edit route in `segments` that calls every owner | One request would span four modules' writes in one transaction, against the rule that each module writes its own tables through its own services with its own locks. |
| A loop of single-record requests from the web | 500 requests per action, partial failures half way, and 500 audit transactions. |
| Clearing the old warehouse's shelf even when stock remains | The stock there could no longer be found on its shelf. |
| Removing the old main supplier's link | The owner keeps it as an additional supplier. |

## Consequences

**Positive.**
- Hundreds of products change in one step.
- Each change keeps its module's checks, locks and audit.

**Negative.**
- Five routes to maintain.
- A pricing change holds up to 500 advisory locks for one transaction. This is acceptable for a rare admin action.
- After a home move, the old warehouse's low-stock list still shows products that ran out there (ADR-0039's out-of-stock rule).

**Follow-ups.**
- «Таарсан бүх N-ийг сонгох» (ticking every matching row, beyond the loaded pages) when the owner needs it.
- The price sheet import (next session) reuses the pricing route's core.

## Related

ADR-0037, ADR-0039, ADR-0044, ADR-0048, ADR-0049, architecture §5.3, `docs/modules/catalog.md`, `partners.md`, `inventory.md`, `pricing.md`.
