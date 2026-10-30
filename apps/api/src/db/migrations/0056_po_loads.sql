-- By hand (ADR-0121): trucks and the loads of an order; no data change. The transfers CHECKs drizzle wanted to re-add unchanged are left out.
CREATE TABLE "purchase_order_loads" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_loads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" bigint NOT NULL,
	"truck_id" bigint NOT NULL,
	"note" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_loads_key" UNIQUE("order_id","truck_id"),
	CONSTRAINT "purchase_order_loads_note" CHECK ("purchase_order_loads"."note" IS NULL OR length("purchase_order_loads"."note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE TABLE "trucks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trucks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"plate" text,
	"capacity_kg" numeric(14, 3),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trucks_name_key" UNIQUE("name"),
	CONSTRAINT "trucks_name" CHECK (length("trucks"."name") BETWEEN 1 AND 80),
	CONSTRAINT "trucks_plate" CHECK ("trucks"."plate" IS NULL OR length("trucks"."plate") BETWEEN 1 AND 20),
	CONSTRAINT "trucks_capacity" CHECK ("trucks"."capacity_kg" IS NULL OR "trucks"."capacity_kg" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD COLUMN "load_id" bigint;--> statement-breakpoint
ALTER TABLE "purchase_order_loads" ADD CONSTRAINT "purchase_order_loads_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_loads" ADD CONSTRAINT "purchase_order_loads_truck_id_trucks_id_fk" FOREIGN KEY ("truck_id") REFERENCES "public"."trucks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_loads" ADD CONSTRAINT "purchase_order_loads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" ADD CONSTRAINT "purchase_order_suppliers_load_id_purchase_order_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."purchase_order_loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_suppliers_load_idx" ON "purchase_order_suppliers" USING btree ("load_id");--> statement-breakpoint
