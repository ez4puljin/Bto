CREATE TABLE "ebarimt_receipts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ebarimt_receipts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_code" text NOT NULL,
	"source_system" text NOT NULL,
	"source_doc_type" text NOT NULL,
	"source_doc_id" text NOT NULL,
	"source_revision" integer DEFAULT 1 NOT NULL,
	"doc_number" text NOT NULL,
	"order_number" text,
	"buyer_name" text NOT NULL,
	"receipt_type" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error_code" text,
	"message" text,
	"customer_tin" text,
	"consumer_no" text,
	"lines" jsonb NOT NULL,
	"payments" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"vat_total" numeric(14, 2) NOT NULL,
	"city_tax_total" numeric(14, 2) NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"claimed_node_id" bigint,
	"claimed_node_code" text,
	"next_attempt_at" timestamp with time zone,
	"ddtd" text,
	"posapi_date" text,
	"issued_at" timestamp with time zone,
	"merchant_tin" text,
	"merchant_name" text,
	"resolved_by" bigint,
	"resolved_at" timestamp with time zone,
	"cancel_status" text,
	"cancel_reason" text,
	"cancel_requested_at" timestamp with time zone,
	"cancel_attempt" integer DEFAULT 0 NOT NULL,
	"cancel_claimed_at" timestamp with time zone,
	"cancel_node_id" bigint,
	"cancel_next_attempt_at" timestamp with time zone,
	"cancel_message" text,
	"cancelled_at" timestamp with time zone,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebarimt_receipts_status" CHECK ("ebarimt_receipts"."status" IN ('PENDING', 'SENDING', 'CONFIRMED', 'ERROR', 'INDETERMINATE', 'CANCELLED')),
	CONSTRAINT "ebarimt_receipts_cancel_status" CHECK ("ebarimt_receipts"."cancel_status" IS NULL OR "ebarimt_receipts"."cancel_status" IN ('PENDING', 'SENDING', 'DONE', 'ERROR', 'INDETERMINATE')),
	CONSTRAINT "ebarimt_receipts_type" CHECK ("ebarimt_receipts"."receipt_type" IN ('B2C', 'B2B')),
	CONSTRAINT "ebarimt_receipts_revision" CHECK ("ebarimt_receipts"."source_revision" >= 1),
	CONSTRAINT "ebarimt_receipts_attempts" CHECK ("ebarimt_receipts"."attempt" >= 0 AND "ebarimt_receipts"."cancel_attempt" >= 0),
	CONSTRAINT "ebarimt_receipts_money" CHECK ("ebarimt_receipts"."total" > 0 AND "ebarimt_receipts"."vat_total" >= 0),
	CONSTRAINT "ebarimt_receipts_confirmed" CHECK ("ebarimt_receipts"."status" <> 'CONFIRMED' OR ("ebarimt_receipts"."ddtd" IS NOT NULL AND "ebarimt_receipts"."posapi_date" IS NOT NULL)),
	CONSTRAINT "ebarimt_receipts_sending" CHECK ("ebarimt_receipts"."status" <> 'SENDING' OR "ebarimt_receipts"."claimed_at" IS NOT NULL),
	CONSTRAINT "ebarimt_receipts_ddtd" CHECK ("ebarimt_receipts"."ddtd" IS NULL OR "ebarimt_receipts"."ddtd" ~ '^[0-9]{20,40}$'),
	CONSTRAINT "ebarimt_receipts_posapi_date" CHECK ("ebarimt_receipts"."posapi_date" IS NULL OR length("ebarimt_receipts"."posapi_date") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "sales_stages" ADD COLUMN "ebarimt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ebarimt_receipts" ADD CONSTRAINT "ebarimt_receipts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebarimt_receipts" ADD CONSTRAINT "ebarimt_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ebarimt_receipts_source_key" ON "ebarimt_receipts" USING btree ("company_code","source_system","source_doc_type","source_doc_id","source_revision");--> statement-breakpoint
CREATE INDEX "ebarimt_receipts_status_idx" ON "ebarimt_receipts" USING btree ("status","id");--> statement-breakpoint
CREATE INDEX "ebarimt_receipts_cancel_idx" ON "ebarimt_receipts" USING btree ("cancel_status","id") WHERE "ebarimt_receipts"."cancel_status" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_stages" ADD CONSTRAINT "sales_stages_ebarimt" CHECK (NOT "sales_stages"."ebarimt" OR "sales_stages"."action" = 'SALE');--> statement-breakpoint
-- ADR-0185: a receipt row is the tax trail of its document; never deleted.
REVOKE DELETE, TRUNCATE ON "ebarimt_receipts" FROM app;
