CREATE TABLE "sales_order_excluded_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_excluded_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"product_id" bigint NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"factor_snapshot" numeric(18, 6) NOT NULL,
	"qty_base" numeric(14, 3) NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"subtotal" numeric(14, 2),
	"discount_amount" numeric(14, 2),
	"total" numeric(14, 2),
	"parts" jsonb NOT NULL,
	"excluded_by" bigint,
	"excluded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_by" bigint,
	"restored_at" timestamp with time zone,
	CONSTRAINT "sales_order_excluded_lines_qty" CHECK ("sales_order_excluded_lines"."qty" > 0 AND "sales_order_excluded_lines"."qty_base" > 0 AND "sales_order_excluded_lines"."factor_snapshot" > 0),
	CONSTRAINT "sales_order_excluded_lines_restored" CHECK ("sales_order_excluded_lines"."restored_at" IS NULL OR "sales_order_excluded_lines"."restored_by" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_excluded_by_users_id_fk" FOREIGN KEY ("excluded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_excluded_lines" ADD CONSTRAINT "sales_order_excluded_lines_restored_by_users_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_order_excluded_lines_order_idx" ON "sales_order_excluded_lines" USING btree ("order_id");--> statement-breakpoint
-- ADR-0175 #2: a taken-off line is history; a restore stamps it, nothing deletes it.
REVOKE DELETE, TRUNCATE ON "sales_order_excluded_lines" FROM app;
