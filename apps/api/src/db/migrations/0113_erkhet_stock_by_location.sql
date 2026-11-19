CREATE TABLE "erxes_stock_balances" (
	"run_id" bigint NOT NULL,
	"erxes_id" text NOT NULL,
	"location" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erxes_stock_locations" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text,
	"warehouse_id" bigint,
	"linked_by" bigint,
	"linked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "erxes_stock_locations_code" CHECK ("erxes_stock_locations"."code" ~ '^[0-9A-Za-z_-]{1,16}$')
);
--> statement-breakpoint
CREATE TABLE "erxes_stock_products" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erxes_stock_products_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" bigint NOT NULL,
	"erxes_id" text NOT NULL,
	"code" text,
	"name" text,
	"uom" text,
	"product_id" bigint,
	"match_reason" text,
	"read_ok" boolean DEFAULT true NOT NULL,
	CONSTRAINT "erxes_stock_products_match" CHECK (("erxes_stock_products"."product_id" IS NULL) = ("erxes_stock_products"."match_reason" IS NOT NULL) AND ("erxes_stock_products"."match_reason" IS NULL OR "erxes_stock_products"."match_reason" IN ('PRODUCT_NOT_FOUND', 'PRODUCT_AMBIGUOUS')))
);
--> statement-breakpoint
CREATE TABLE "erxes_stock_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "erxes_stock_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"active_slot" smallint,
	"started_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"plan" jsonb,
	"products" integer DEFAULT 0 NOT NULL,
	"batches_total" integer DEFAULT 0 NOT NULL,
	"batches_done" integer DEFAULT 0 NOT NULL,
	"batches_failed" integer DEFAULT 0 NOT NULL,
	"failure" text,
	"failure_detail" text,
	CONSTRAINT "erxes_stock_runs_status" CHECK ("erxes_stock_runs"."status" IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')),
	CONSTRAINT "erxes_stock_runs_failure" CHECK ("erxes_stock_runs"."failure" IS NULL OR "erxes_stock_runs"."failure" IN ('NOT_CONFIGURED', 'KEY_UNREADABLE', 'LOGIN_FAILED', 'UNREACHABLE', 'TIMEOUT', 'UNEXPECTED_ANSWER', 'NO_PLAN', 'INTERRUPTED', 'INTERNAL')),
	CONSTRAINT "erxes_stock_runs_active" CHECK (("erxes_stock_runs"."active_slot" IS NOT NULL) = ("erxes_stock_runs"."status" IN ('QUEUED', 'RUNNING')) AND coalesce("erxes_stock_runs"."active_slot", 1) = 1)
);
--> statement-breakpoint
ALTER TABLE "erxes_stock_balances" ADD CONSTRAINT "erxes_stock_balances_run_id_erxes_stock_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."erxes_stock_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_stock_locations" ADD CONSTRAINT "erxes_stock_locations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_stock_locations" ADD CONSTRAINT "erxes_stock_locations_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_stock_products" ADD CONSTRAINT "erxes_stock_products_run_id_erxes_stock_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."erxes_stock_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erxes_stock_runs" ADD CONSTRAINT "erxes_stock_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_stock_balances_key" ON "erxes_stock_balances" USING btree ("run_id","location","erxes_id");--> statement-breakpoint
CREATE INDEX "erxes_stock_locations_warehouse_idx" ON "erxes_stock_locations" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_stock_products_run_erxes" ON "erxes_stock_products" USING btree ("run_id","erxes_id");--> statement-breakpoint
CREATE INDEX "erxes_stock_products_run_product_idx" ON "erxes_stock_products" USING btree ("run_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "erxes_stock_runs_one_active" ON "erxes_stock_runs" USING btree ("active_slot");