CREATE TABLE "note_scanners" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "note_scanners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"url" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "note_scanners_values" CHECK (length("note_scanners"."name") BETWEEN 1 AND 60 AND length("note_scanners"."url") BETWEEN 8 AND 200)
);
--> statement-breakpoint
CREATE TABLE "receipt_note_aliases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipt_note_aliases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"supplier_id" bigint NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"product_unit_id" bigint NOT NULL,
	"uses" integer DEFAULT 1 NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_note_aliases_key" UNIQUE("supplier_id","key"),
	CONSTRAINT "receipt_note_aliases_values" CHECK (length("receipt_note_aliases"."key") BETWEEN 1 AND 400 AND length("receipt_note_aliases"."label") BETWEEN 1 AND 400
        AND "receipt_note_aliases"."uses" >= 1)
);
--> statement-breakpoint
CREATE TABLE "receipt_note_reading_pages" (
	"reading_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"file_id" bigint NOT NULL,
	CONSTRAINT "receipt_note_reading_pages_reading_id_position_pk" PRIMARY KEY("reading_id","position"),
	CONSTRAINT "receipt_note_reading_pages_file_key" UNIQUE("file_id"),
	CONSTRAINT "receipt_note_reading_pages_position" CHECK ("receipt_note_reading_pages"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_note_readings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "receipt_note_readings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"status" text DEFAULT 'READING' NOT NULL,
	"supplier_id" bigint,
	"result" jsonb,
	"failure" jsonb,
	"model" text,
	"receipt_id" bigint,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "receipt_note_readings_status" CHECK ("receipt_note_readings"."status" IN ('READING', 'READY', 'FAILED', 'SAVED', 'DISCARDED')),
	CONSTRAINT "receipt_note_readings_state" CHECK (("receipt_note_readings"."status" = 'SAVED') = ("receipt_note_readings"."receipt_id" IS NOT NULL)
        AND ("receipt_note_readings"."status" NOT IN ('READY', 'SAVED') OR "receipt_note_readings"."result" IS NOT NULL)
        AND ("receipt_note_readings"."status" = 'READING') = ("receipt_note_readings"."finished_at" IS NULL)
        AND ("receipt_note_readings"."model" IS NULL OR length("receipt_note_readings"."model") BETWEEN 1 AND 100))
);
--> statement-breakpoint
CREATE TABLE "receipt_note_templates" (
	"supplier_id" bigint PRIMARY KEY NOT NULL,
	"notes" text,
	"readings" integer DEFAULT 0 NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_note_templates_values" CHECK ("receipt_note_templates"."readings" >= 0 AND ("receipt_note_templates"."notes" IS NULL OR length("receipt_note_templates"."notes") BETWEEN 1 AND 2000))
);
--> statement-breakpoint
ALTER TABLE "ai_usage" DROP CONSTRAINT "ai_usage_purpose";--> statement-breakpoint
ALTER TABLE "note_scanners" ADD CONSTRAINT "note_scanners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_aliases" ADD CONSTRAINT "receipt_note_aliases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_aliases" ADD CONSTRAINT "receipt_note_aliases_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_aliases" ADD CONSTRAINT "receipt_note_aliases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_reading_pages" ADD CONSTRAINT "receipt_note_reading_pages_reading_id_receipt_note_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."receipt_note_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_reading_pages" ADD CONSTRAINT "receipt_note_reading_pages_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_readings" ADD CONSTRAINT "receipt_note_readings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_readings" ADD CONSTRAINT "receipt_note_readings_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_readings" ADD CONSTRAINT "receipt_note_readings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_templates" ADD CONSTRAINT "receipt_note_templates_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_note_templates" ADD CONSTRAINT "receipt_note_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_note_readings_open_idx" ON "receipt_note_readings" USING btree ("id") WHERE "receipt_note_readings"."status" IN ('READING', 'READY', 'FAILED');--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_note_readings_receipt_key" ON "receipt_note_readings" USING btree ("receipt_id") WHERE "receipt_note_readings"."receipt_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_purpose" CHECK ("ai_usage"."purpose" IN ('ASK', 'INVOICE_CHECK', 'PRODUCT_READ', 'RECEIPT_READ'));--> statement-breakpoint
-- Hand-written (ADR-0210): a reading and its pages are the record of what the model was shown and
-- answered; a supplier's notes and a scanner are emptied or switched off, never deleted. Aliases
-- stay deletable: «Мартуулах» removes a supplier's.
REVOKE DELETE, TRUNCATE ON "receipt_note_readings" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "receipt_note_reading_pages" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "receipt_note_templates" FROM app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "note_scanners" FROM app;--> statement-breakpoint
REVOKE TRUNCATE ON "receipt_note_aliases" FROM app;
