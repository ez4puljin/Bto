-- ADR-0161: suppliers get a tree of categories.
CREATE TABLE "supplier_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "supplier_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"parent_id" bigint,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_categories_parent_name_key" UNIQUE NULLS NOT DISTINCT("parent_id","name_key"),
	CONSTRAINT "supplier_categories_name" CHECK (length("supplier_categories"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "category_id" bigint;--> statement-breakpoint
ALTER TABLE "supplier_categories" ADD CONSTRAINT "supplier_categories_parent_id_supplier_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."supplier_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_categories_parent_idx" ON "supplier_categories" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_category_id_supplier_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."supplier_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suppliers_category_idx" ON "suppliers" USING btree ("category_id","id");--> statement-breakpoint

-- Suppliers name them: never deleted, only retired.
REVOKE DELETE, TRUNCATE ON "supplier_categories" FROM app;
