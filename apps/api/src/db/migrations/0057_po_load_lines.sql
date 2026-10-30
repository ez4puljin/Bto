-- By hand (ADR-0122): a supplier's goods ride on trucks by line (purchase_order_load_lines) and the AI's
-- reading of a supplier's invoice (purchase_order_invoice_checks). The whole-supplier assignments of ADR-0121
-- become one load line per ordered line before purchase_order_suppliers.load_id goes.
CREATE TABLE "purchase_order_invoice_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_invoice_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_supplier_id" bigint NOT NULL,
	"file_id" bigint NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"model" text,
	"invoice_total" numeric(14, 2),
	"ordered_total" numeric(14, 2),
	"result" jsonb,
	"error_reason" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "purchase_order_invoice_checks_status" CHECK ("purchase_order_invoice_checks"."status" IN ('PENDING', 'DONE', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "purchase_order_load_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "purchase_order_load_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"load_id" bigint NOT NULL,
	"line_id" bigint NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_order_load_lines_key" UNIQUE("load_id","line_id"),
	CONSTRAINT "purchase_order_load_lines_qty" CHECK ("purchase_order_load_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" DROP CONSTRAINT "purchase_order_suppliers_load_id_purchase_order_loads_id_fk";
--> statement-breakpoint
DROP INDEX "purchase_order_suppliers_load_idx";--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_checks" ADD CONSTRAINT "purchase_order_invoice_checks_order_supplier_id_purchase_order_suppliers_id_fk" FOREIGN KEY ("order_supplier_id") REFERENCES "public"."purchase_order_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_checks" ADD CONSTRAINT "purchase_order_invoice_checks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_invoice_checks" ADD CONSTRAINT "purchase_order_invoice_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_load_lines" ADD CONSTRAINT "purchase_order_load_lines_load_id_purchase_order_loads_id_fk" FOREIGN KEY ("load_id") REFERENCES "public"."purchase_order_loads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_load_lines" ADD CONSTRAINT "purchase_order_load_lines_line_id_purchase_order_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."purchase_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_load_lines" ADD CONSTRAINT "purchase_order_load_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_invoice_checks_supplier_idx" ON "purchase_order_invoice_checks" USING btree ("order_supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_order_load_lines_line_idx" ON "purchase_order_load_lines" USING btree ("line_id");--> statement-breakpoint
INSERT INTO "purchase_order_load_lines" ("load_id", "line_id", "qty")
SELECT s."load_id", l."id", l."qty"
FROM "purchase_order_suppliers" s
JOIN "purchase_order_lines" l ON l."order_supplier_id" = s."id"
WHERE s."load_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order_suppliers" DROP COLUMN "load_id";