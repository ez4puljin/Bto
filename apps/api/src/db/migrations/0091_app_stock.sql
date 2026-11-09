CREATE TABLE "app_stock_warehouses" (
	"app" text NOT NULL,
	"warehouse_id" bigint NOT NULL,
	CONSTRAINT "app_stock_warehouses_app_warehouse_id_pk" PRIMARY KEY("app","warehouse_id"),
	CONSTRAINT "app_stock_warehouses_app" CHECK ("app_stock_warehouses"."app" IN ('CUSTOMER', 'STAFF'))
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "customer_stock_display" text DEFAULT 'WORDS' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_stock_display" CHECK ("app_settings"."customer_stock_display" IN ('WORDS', 'NUMBER'));--> statement-breakpoint
-- ADR-0173: an app's warehouse list is replaced as a whole (its rows are deleted), never truncated.
REVOKE TRUNCATE ON "app_stock_warehouses" FROM app;
