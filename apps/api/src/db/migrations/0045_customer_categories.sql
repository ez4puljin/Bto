CREATE TABLE "customer_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "customer_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_categories_name_key_key" UNIQUE("name_key"),
	CONSTRAINT "customer_categories_name" CHECK (length("customer_categories"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "category_id" bigint;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_category_id_customer_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."customer_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_category_idx" ON "customers" USING btree ("category_id","id");--> statement-breakpoint
-- Categories are retired, never deleted: customers name them (ADR-0107).
REVOKE DELETE, TRUNCATE ON "customer_categories" FROM app;
