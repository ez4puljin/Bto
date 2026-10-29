-- By hand (ADR-0118): no data change; SHIPPING is a new status value, shipped_qty and the receipt line note start empty.
ALTER TABLE "purchase_order_suppliers" DROP CONSTRAINT "purchase_order_suppliers_status";--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_status";--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD COLUMN "shipped_qty" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "archived_by" bigint;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_orders_archived_idx" ON "purchase_orders" USING btree ("archived_at","id");--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_note" CHECK ("goods_receipt_lines"."note" IS NULL OR length("goods_receipt_lines"."note") BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_shipped" CHECK ("purchase_order_lines"."shipped_qty" IS NULL OR "purchase_order_lines"."shipped_qty" >= 0);--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD CONSTRAINT "purchase_order_suppliers_status" CHECK ("purchase_order_suppliers"."status" IN ('PREPARING', 'SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED', 'ACCOUNTING', 'RECEIVED'));--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status" CHECK ("purchase_orders"."status" IN ('PREPARING', 'SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED', 'ACCOUNTING', 'RECEIVED'));--> statement-breakpoint
