CREATE TABLE "sales_order_picks" (
	"order_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"picker_id" bigint,
	"started_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_order_picks_order_id_warehouse_id_pk" PRIMARY KEY("order_id","warehouse_id"),
	CONSTRAINT "sales_order_picks_status" CHECK ("sales_order_picks"."status" IN ('OPEN', 'PICKING', 'DONE')),
	CONSTRAINT "sales_order_picks_picker" CHECK (("sales_order_picks"."status" = 'OPEN') = ("sales_order_picks"."picker_id" IS NULL)),
	CONSTRAINT "sales_order_picks_done" CHECK (("sales_order_picks"."status" = 'DONE') = ("sales_order_picks"."done_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD COLUMN "kind" text DEFAULT 'SALES' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_order_picks" ADD CONSTRAINT "sales_order_picks_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_picks" ADD CONSTRAINT "sales_order_picks_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_picks" ADD CONSTRAINT "sales_order_picks_picker_id_users_id_fk" FOREIGN KEY ("picker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_order_picks_warehouse_idx" ON "sales_order_picks" USING btree ("warehouse_id","status");--> statement-breakpoint
-- ADR-0126 #1: a pipeline that names a store is a TRANSFER pipeline (ADR-0125's pipelines 4 and 6).
UPDATE "sales_pipelines" SET "kind" = 'TRANSFER' WHERE "transfer_warehouse_id" IS NOT NULL;--> statement-breakpoint
-- ADR-0126 #2: every open order gets a part per warehouse its lines ship from; a packed order's parts are done.
INSERT INTO "sales_order_picks" ("order_id", "warehouse_id", "status", "picker_id", "started_at", "done_at")
SELECT DISTINCT o."id", l."warehouse_id",
       CASE WHEN o."status" = 'PACKED' THEN 'DONE' ELSE 'OPEN' END,
       CASE WHEN o."status" = 'PACKED' THEN COALESCE(o."picked_by", o."created_by") END,
       CASE WHEN o."status" = 'PACKED' THEN COALESCE(o."picked_at", o."updated_at") END,
       CASE WHEN o."status" = 'PACKED' THEN COALESCE(o."picked_at", o."updated_at") END
  FROM "sales_orders" o JOIN "sales_order_lines" l ON l."order_id" = o."id"
 WHERE o."status" IN ('CONFIRMED', 'PICKING', 'PACKED');--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_kind" CHECK ("sales_pipelines"."kind" IN ('SALES', 'TRANSFER'));--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_transfer_store" CHECK (("sales_pipelines"."kind" = 'TRANSFER') = ("sales_pipelines"."transfer_warehouse_id" IS NOT NULL));