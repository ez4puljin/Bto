CREATE TABLE "sales_order_loads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_order_loads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"driver_id" bigint NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_stage_id" bigint,
	"to_stage_id" bigint,
	"undone_at" timestamp with time zone,
	"undone_by" bigint,
	CONSTRAINT "sales_order_loads_undone" CHECK (("sales_order_loads"."undone_at" IS NULL) = ("sales_order_loads"."undone_by" IS NULL)),
	CONSTRAINT "sales_order_loads_moved" CHECK (("sales_order_loads"."to_stage_id" IS NULL OR "sales_order_loads"."from_stage_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD COLUMN "loaded_stage_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_order_loads" ADD CONSTRAINT "sales_order_loads_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_loads" ADD CONSTRAINT "sales_order_loads_driver_id_users_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_loads" ADD CONSTRAINT "sales_order_loads_from_stage_id_sales_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_loads" ADD CONSTRAINT "sales_order_loads_to_stage_id_sales_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."sales_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_loads" ADD CONSTRAINT "sales_order_loads_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_loads_live" ON "sales_order_loads" USING btree ("order_id") WHERE "sales_order_loads"."undone_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sales_order_loads_driver_idx" ON "sales_order_loads" USING btree ("driver_id","loaded_at");--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_loaded_stage_fk" FOREIGN KEY ("id","loaded_stage_id") REFERENCES "public"."sales_stages"("pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ADR-0179: a loading is taken back, never removed; its history stays.
REVOKE DELETE, TRUNCATE ON "sales_order_loads" FROM app;--> statement-breakpoint
-- ADR-0179 #3: a sales pipeline whose stage is named «Ачигдсан…» (the old system's loaded column)
-- and runs no action gets it as the stage a loaded, sold order moves into; the admin changes it
-- in the pipeline's dialog.
UPDATE "sales_pipelines" p SET "loaded_stage_id" = s."id"
FROM (
  SELECT DISTINCT ON ("pipeline_id") "pipeline_id", "id"
  FROM "sales_stages"
  WHERE "archived_at" IS NULL AND "action" = 'NONE' AND "name" ILIKE 'Ачигдсан%'
  ORDER BY "pipeline_id", "position", "id"
) s
WHERE s."pipeline_id" = p."id" AND p."kind" = 'SALES' AND p."loaded_stage_id" IS NULL;
