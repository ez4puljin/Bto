-- N+M split on order lines (ADR-0217): the free base units of a line as its prices were frozen, shown
-- to the picker as «үндсэн + бонус». Only adds nullable columns: older lines show no split.
ALTER TABLE "sales_order_excluded_lines" ADD COLUMN "free_qty_base" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN "free_qty_base" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_free" CHECK ("sales_order_lines"."free_qty_base" IS NULL OR ("sales_order_lines"."free_qty_base" > 0 AND "sales_order_lines"."free_qty_base" <= "sales_order_lines"."qty_base"));