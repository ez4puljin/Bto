CREATE TABLE "expiry_item_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expiry_item_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"qty_floor_old" numeric(14, 3) NOT NULL,
	"qty_floor_new" numeric(14, 3) NOT NULL,
	"qty_warehouse_old" numeric(14, 3) NOT NULL,
	"qty_warehouse_new" numeric(14, 3) NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" bigint,
	"changed_by_name" text NOT NULL,
	"legacy_id" bigint,
	CONSTRAINT "expiry_item_changes_kind" CHECK ("expiry_item_changes"."kind" IN ('CREATE', 'UPDATE'))
);
--> statement-breakpoint
CREATE TABLE "expiry_item_roles" (
	"item_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	CONSTRAINT "expiry_item_roles_item_id_role_id_pk" PRIMARY KEY("item_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "expiry_item_users" (
	"item_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	CONSTRAINT "expiry_item_users_item_id_user_id_pk" PRIMARY KEY("item_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "expiry_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expiry_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"product_id" bigint NOT NULL,
	"expiry_date" date NOT NULL,
	"qty_floor" numeric(14, 3) DEFAULT 0 NOT NULL,
	"qty_warehouse" numeric(14, 3) DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'REVIEW' NOT NULL,
	"liability_type" text DEFAULT 'NONE' NOT NULL,
	"liability_note" text,
	"note" text,
	"edit_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"created_by_name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	"archived_at" timestamp with time zone,
	"archived_by" bigint,
	"archived_by_name" text,
	"legacy_id" bigint,
	CONSTRAINT "expiry_items_qty_floor" CHECK ("expiry_items"."qty_floor" >= 0),
	CONSTRAINT "expiry_items_qty_warehouse" CHECK ("expiry_items"."qty_warehouse" >= 0),
	CONSTRAINT "expiry_items_status" CHECK ("expiry_items"."status" IN ('REVIEW', 'CITY_RETURN', 'INTERNAL_SALE', 'ARCHIVED')),
	CONSTRAINT "expiry_items_liability_type" CHECK ("expiry_items"."liability_type" IN ('NONE', 'SPECIFIC', 'ALL_STAFF')),
	CONSTRAINT "expiry_items_liability_note" CHECK ("expiry_items"."liability_note" IS NULL OR length("expiry_items"."liability_note") BETWEEN 1 AND 500),
	CONSTRAINT "expiry_items_note" CHECK ("expiry_items"."note" IS NULL OR length("expiry_items"."note") BETWEEN 1 AND 1000),
	CONSTRAINT "expiry_items_edit_version" CHECK ("expiry_items"."edit_version" >= 1),
	CONSTRAINT "expiry_items_archived" CHECK (("expiry_items"."status" = 'ARCHIVED') = ("expiry_items"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "expiry_item_changes" ADD CONSTRAINT "expiry_item_changes_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_changes" ADD CONSTRAINT "expiry_item_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_roles" ADD CONSTRAINT "expiry_item_roles_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_roles" ADD CONSTRAINT "expiry_item_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_users" ADD CONSTRAINT "expiry_item_users_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_item_users" ADD CONSTRAINT "expiry_item_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_items" ADD CONSTRAINT "expiry_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_items" ADD CONSTRAINT "expiry_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_items" ADD CONSTRAINT "expiry_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expiry_items" ADD CONSTRAINT "expiry_items_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expiry_item_changes_item_idx" ON "expiry_item_changes" USING btree ("item_id","changed_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_item_changes_legacy_key" ON "expiry_item_changes" USING btree ("legacy_id") WHERE "expiry_item_changes"."legacy_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "expiry_items_date_idx" ON "expiry_items" USING btree ("expiry_date","id");--> statement-breakpoint
CREATE INDEX "expiry_items_status_date_idx" ON "expiry_items" USING btree ("status","expiry_date","id");--> statement-breakpoint
CREATE INDEX "expiry_items_product_idx" ON "expiry_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expiry_items_legacy_key" ON "expiry_items" USING btree ("legacy_id") WHERE "expiry_items"."legacy_id" IS NOT NULL;--> statement-breakpoint
-- Hand-written (ADR-0172 #3): a record is archived, never deleted, and a history row never changes.
REVOKE DELETE, TRUNCATE ON "expiry_items" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "expiry_item_changes" FROM app;--> statement-breakpoint

-- The register for the AI assistant (ADR-0172 #11), under the rules of 0017_ai. The liability is
-- left out: it reads as pay. "Today" is the Ulaanbaatar business date, as the service's daysLeft.
CREATE VIEW ai.expiry_items AS
SELECT e.product_id, p.sku, p.name AS product_name, base_uom.name AS base_unit, e.expiry_date,
       e.expiry_date - (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date AS days_left,
       e.qty_floor, e.qty_warehouse, e.qty_floor + e.qty_warehouse AS qty_total,
       e.status, e.note, e.created_at, e.created_by_name
  FROM public.expiry_items e
  JOIN public.products p ON p.id = e.product_id
  LEFT JOIN public.product_units bu ON bu.product_id = p.id AND bu.is_base
  LEFT JOIN public.uoms base_uom ON base_uom.id = bu.uom_id;
--> statement-breakpoint
-- app's default privileges (0000_foundation) cover views too: take them back. migrate.ts repeats
-- this after every run and grants ai_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA ai FROM app;
