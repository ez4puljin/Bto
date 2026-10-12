-- Movement history by shelf and by warehouse (SPEC §8.2 #1, docs/modules/inventory.md §4): newest
-- first within a bin or a warehouse, like stock_ledger_product_idx for a product.
CREATE INDEX "stock_ledger_bin_idx" ON "stock_ledger" ("bin_id", "id");
--> statement-breakpoint
CREATE INDEX "stock_ledger_warehouse_idx" ON "stock_ledger" ("warehouse_id", "id");
