-- Pipelines between the boards and the stages, archived orders, a shared card sort and the order
-- number format (ADR-0057). Generated in two drizzle-kit steps (the new tables and columns, then
-- the board columns' drop) and merged by hand like 0019: the AI view that reads
-- sales_orders.board_id goes first and comes back on the pipelines at the end; between the steps
-- every board gets one pipeline of its own name holding its roles, stages, orders and defaults.
DROP VIEW ai.sales_orders;--> statement-breakpoint
CREATE TABLE "sales_pipeline_roles" (
	"pipeline_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"right" text NOT NULL,
	CONSTRAINT "sales_pipeline_roles_pipeline_id_role_id_right_pk" PRIMARY KEY("pipeline_id","role_id","right"),
	CONSTRAINT "sales_pipeline_roles_right" CHECK ("sales_pipeline_roles"."right" IN ('VIEW', 'MANAGE', 'ALL_ORDERS'))
);
--> statement-breakpoint
CREATE TABLE "sales_pipelines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sales_pipelines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"board_id" bigint NOT NULL,
	"name" text NOT NULL,
	"position" smallint NOT NULL,
	"visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"own_orders_only" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_pipelines_name" CHECK (length("sales_pipelines"."name") BETWEEN 1 AND 80),
	CONSTRAINT "sales_pipelines_position" CHECK ("sales_pipelines"."position" >= 0),
	CONSTRAINT "sales_pipelines_visibility" CHECK ("sales_pipelines"."visibility" IN ('PUBLIC', 'PRIVATE'))
);
--> statement-breakpoint
CREATE TABLE "sales_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"number_pattern" text NOT NULL,
	"number_digits" smallint NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_settings_single" CHECK ("sales_settings"."id" = 1),
	CONSTRAINT "sales_settings_pattern" CHECK (length("sales_settings"."number_pattern") BETWEEN 1 AND 24 AND "sales_settings"."number_pattern" !~ '[0-9}]$'),
	CONSTRAINT "sales_settings_digits" CHECK ("sales_settings"."number_digits" BETWEEN 1 AND 8)
);
--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ADD COLUMN "pipeline_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "pipeline_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "archived_by" bigint;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD COLUMN "pipeline_id" bigint;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD COLUMN "card_sort" text DEFAULT 'NEWEST' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_pipeline_roles" ADD CONSTRAINT "sales_pipeline_roles_pipeline_id_sales_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."sales_pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pipeline_roles" ADD CONSTRAINT "sales_pipeline_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_board_id_sales_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."sales_boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_pipelines" ADD CONSTRAINT "sales_pipelines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_settings" ADD CONSTRAINT "sales_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_pipelines_board_idx" ON "sales_pipelines" USING btree ("board_id","position");--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ADD CONSTRAINT "sales_channel_defaults_pipeline_id_sales_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."sales_pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_pipeline_id_sales_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."sales_pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_pipeline_id_sales_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."sales_pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_orders_stage_live_idx" ON "sales_orders" USING btree ("stage_id","id") WHERE "sales_orders"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "sales_orders_pipeline_idx" ON "sales_orders" USING btree ("pipeline_id","id");--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_archived" CHECK (("sales_orders"."archived_by" IS NULL OR "sales_orders"."archived_at" IS NOT NULL) AND ("sales_orders"."archived_at" IS NULL OR "sales_orders"."status" IN ('DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED')));--> statement-breakpoint
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_card_sort" CHECK ("sales_stages"."card_sort" IN ('NEWEST', 'OLDEST', 'DELIVERY', 'TOTAL', 'WAITING'));
--> statement-breakpoint
-- One pipeline per board, private when the board named who may see it; then everything that
-- pointed at the board points at its pipeline (one per board, so the mapping is one to one).
INSERT INTO "sales_pipelines" ("board_id", "name", "position", "visibility", "archived_at", "created_by", "created_at", "updated_at")
SELECT b."id", b."name", 0,
       CASE WHEN EXISTS (SELECT 1 FROM "sales_board_roles" r WHERE r."board_id" = b."id" AND r."right" = 'VIEW')
            THEN 'PRIVATE' ELSE 'PUBLIC' END,
       b."archived_at", b."created_by", b."created_at", b."updated_at"
  FROM "sales_boards" b;--> statement-breakpoint
INSERT INTO "sales_pipeline_roles" ("pipeline_id", "role_id", "right")
SELECT p."id", r."role_id", r."right"
  FROM "sales_board_roles" r
  JOIN "sales_pipelines" p ON p."board_id" = r."board_id";--> statement-breakpoint
UPDATE "sales_stages" s SET "pipeline_id" = p."id" FROM "sales_pipelines" p WHERE p."board_id" = s."board_id";--> statement-breakpoint
UPDATE "sales_orders" o SET "pipeline_id" = p."id" FROM "sales_pipelines" p WHERE p."board_id" = o."board_id";--> statement-breakpoint
UPDATE "sales_channel_defaults" d SET "pipeline_id" = p."id" FROM "sales_pipelines" p WHERE p."board_id" = d."board_id";--> statement-breakpoint
ALTER TABLE "sales_board_roles" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "sales_board_roles" CASCADE;--> statement-breakpoint
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_board";--> statement-breakpoint
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_submitted";--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" DROP CONSTRAINT "sales_channel_defaults_board_id_sales_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" DROP CONSTRAINT "sales_channel_defaults_stage_id_sales_stages_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_board_id_sales_boards_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_orders" DROP CONSTRAINT "sales_orders_stage_id_sales_stages_id_fk";
--> statement-breakpoint
ALTER TABLE "sales_stages" DROP CONSTRAINT "sales_stages_board_id_sales_boards_id_fk";
--> statement-breakpoint
DROP INDEX "sales_stages_board_idx";--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_stages" ALTER COLUMN "pipeline_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_pipeline_stage" UNIQUE("pipeline_id","id");--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" ADD CONSTRAINT "sales_channel_defaults_stage_fk" FOREIGN KEY ("pipeline_id","stage_id") REFERENCES "public"."sales_stages"("pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_stage_fk" FOREIGN KEY ("pipeline_id","stage_id") REFERENCES "public"."sales_stages"("pipeline_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_stages_pipeline_idx" ON "sales_stages" USING btree ("pipeline_id","position");--> statement-breakpoint
ALTER TABLE "sales_channel_defaults" DROP COLUMN "board_id";--> statement-breakpoint
ALTER TABLE "sales_orders" DROP COLUMN "board_id";--> statement-breakpoint
ALTER TABLE "sales_stages" DROP COLUMN "board_id";--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_place" CHECK (("sales_orders"."pipeline_id" IS NULL) = ("sales_orders"."stage_id" IS NULL) AND ("sales_orders"."stage_id" IS NULL) = ("sales_orders"."stage_entered_at" IS NULL));--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_submitted" CHECK (("sales_orders"."submitted_at" IS NULL OR "sales_orders"."number" IS NOT NULL) AND ("sales_orders"."submitted_at" IS NULL) = ("sales_orders"."price_date" IS NULL) AND ("sales_orders"."submitted_at" IS NULL) = ("sales_orders"."total" IS NULL));
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_pipelines" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "sales_settings" FROM app;--> statement-breakpoint

-- The assistant sees the board, the pipeline, the stage and the archive (ADR-0057 #8).
CREATE VIEW ai.sales_orders AS
SELECT o.id, o.number, o.status, o.channel, o.customer_id, c.code AS customer_code,
       c.name AS customer_name, o.fulfilment, o.delivery_date, o.address_text, o.payment_method,
       o.price_date, o.subtotal, o.discount_total, o.total,
       (SELECT count(*) FROM public.sales_order_lines l WHERE l.order_id = o.id) AS line_count,
       p.board_id, b.name AS board_name, o.pipeline_id, p.name AS pipeline_name, o.stage_id,
       s.name AS stage_name, o.stage_entered_at, o.submitted_at, o.confirmed_at, o.picked_at,
       o.delivered_at, o.cancelled_at, o.cancel_reason, o.archived_at, o.created_at,
       cu.full_name AS created_by_name
  FROM public.sales_orders o
  JOIN public.customers c ON c.id = o.customer_id
  LEFT JOIN public.sales_pipelines p ON p.id = o.pipeline_id
  LEFT JOIN public.sales_boards b ON b.id = p.board_id
  LEFT JOIN public.sales_stages s ON s.id = o.stage_id
  LEFT JOIN public.users cu ON cu.id = o.created_by;
--> statement-breakpoint

-- app's default privileges (0000_foundation) cover views too: take them back. migrate.ts repeats
-- this after every run and grants ai_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;
