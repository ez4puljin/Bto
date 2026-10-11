# ADR-0032: The product ↔ supplier link lives in partners, which may depend on catalog

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-11 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | `docs/architecture.md` §4 (partners depends on identity and catalog) |

## Context

The owner's product sheet has a mandatory "нийлүүлэгч" (supplier) column, and most products come from one supplier (interview of 2026-10-11). The owner wants the link now: the product page shows its supplier, the supplier page its products, goods receipts from a supplier (inventory, delivery 1 week 3) start from that supplier's products, and the Excel import (week 4) fills the link from the sheet. Architecture §4 had partners depend on identity only, and catalog may not depend on partners (catalog is below partners in the module graph). Procurement (delivery 8), which owns supplier prices and reorder rules, is months away and depends on inventory, so it cannot provide a link that inventory needs in week 3. inventory, imports, pricing and procurement already depend on both catalog and partners.

## Decision

1. **partners owns `product_suppliers`** (`product_id` → `products`, `supplier_id` → `suppliers`, `is_main`): one row per (product, supplier), at most one main supplier per product (partial unique index), the first link becomes the main one and removing the main one promotes the oldest remaining link. "Make main" and the first link are serialised per product with a transaction-level advisory lock, because partners may not lock catalog's product row.
2. **partners depends on identity and catalog.** `MODULE_DEPS.partners` in `eslint.config.mjs` is `['identity', 'catalog']`; the lint-guard self-test proves that catalog → partners still fires. The graph stays acyclic: catalog depends on identity only. `PartnersModule` imports `CatalogModule` (services), never `CatalogHttpModule` (controllers and the unit-of-measure boot sync would register twice). `partners/schema.ts` references `products` for the foreign key; `products` cannot be deleted (`REVOKE DELETE`), so the key never blocks catalog.
3. **partners reads products only through `CatalogService.getMany`.** A supplier's products are paged by link id and enriched with catalog summaries; catalog's product list cannot filter by supplier, and nothing in catalog knows about suppliers. The REST routes stay in the partners namespace: `GET /product-suppliers?productId=`, `POST /product-suppliers`, `POST /product-suppliers/:id/main`, `DELETE /product-suppliers/:id`, `GET /suppliers/:id/products`.
4. **Writes need `partners.suppliers.manage`; reads are open to every signed-in user** (warehouse receiving needs them). The product page in the web admin shows a supplier card from the partners feature.
5. **Import (week 4):** the product sheet's supplier cell is matched by supplier code when it is all digits and such a code exists, otherwise by the supplier's `name_key` (unique); anything else is a preview error. A re-import makes the sheet's supplier the main one and keeps other links.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| procurement owns the link | Built in delivery 8 and depends on inventory, while inventory's receiving needs the link in delivery 1. |
| catalog owns the link (`products.main_supplier_id`) | catalog would depend on partners, reversing the module graph of architecture §4. |
| A `product_id` column without a foreign key, or a supplier name copied onto products | Loses referential integrity and still needs catalog to show product names. |
| Waiting and importing the supplier column later | The owner uses the link daily for ordering and receiving; the column is mandatory in the sheet. |

## Consequences

**Positive.** Receiving and the import can use the supplier of each product from week 3; the link is a plain table with database-enforced invariants.

**Negative.** One more edge in the module graph; partners queries that need product names go through `CatalogService.getMany` instead of a join, so supplier product lists sort by link, not by product name.

## Related

ADR-0008, ADR-0015, `docs/architecture.md` §4, `docs/modules/partners.md`, `docs/modules/catalog.md`.
