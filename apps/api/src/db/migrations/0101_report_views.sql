CREATE TABLE "report_views" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "report_views_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"page" text NOT NULL,
	"name" text NOT NULL,
	"query" text NOT NULL,
	"period" text,
	"shared" boolean DEFAULT false NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_views_page" CHECK ("report_views"."page" IN ('party-ledger', 'money-ledger', 'stock-balance', 'product-sales', 'stock-documents', 'aging', 'profit', 'stock', 'suppliers')),
	CONSTRAINT "report_views_name" CHECK (length(btrim("report_views"."name")) BETWEEN 1 AND 80),
	CONSTRAINT "report_views_query" CHECK (length("report_views"."query") <= 2000),
	CONSTRAINT "report_views_period" CHECK ("report_views"."period" IS NULL OR "report_views"."period" IN ('thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'))
);
--> statement-breakpoint
ALTER TABLE "report_views" ADD CONSTRAINT "report_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_views_name_key" ON "report_views" USING btree ("created_by","page",lower("name"));--> statement-breakpoint
CREATE INDEX "report_views_shared_idx" ON "report_views" USING btree ("page") WHERE "report_views"."shared";