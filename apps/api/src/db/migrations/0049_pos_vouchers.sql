CREATE TABLE "pos_sale_vouchers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_sale_vouchers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sale_id" bigint NOT NULL,
	"voucher_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"face" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"issue" text,
	"invoice_id" bigint,
	"invoice_number" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" bigint,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_sale_vouchers_kind" CHECK ("pos_sale_vouchers"."kind" IN ('COUPON', 'PARTNER')),
	CONSTRAINT "pos_sale_vouchers_issue" CHECK ("pos_sale_vouchers"."issue" IS NULL OR "pos_sale_vouchers"."issue" IN ('UNKNOWN', 'USED', 'NOT_YET', 'EXPIRED', 'STOPPED')),
	CONSTRAINT "pos_sale_vouchers_money" CHECK ("pos_sale_vouchers"."face" > 0 AND "pos_sale_vouchers"."amount" >= 0),
	CONSTRAINT "pos_sale_vouchers_invoice" CHECK (("pos_sale_vouchers"."invoice_id" IS NULL) = ("pos_sale_vouchers"."invoice_number" IS NULL) AND ("pos_sale_vouchers"."invoice_id" IS NULL OR "pos_sale_vouchers"."kind" = 'PARTNER')),
	CONSTRAINT "pos_sale_vouchers_review" CHECK (("pos_sale_vouchers"."reviewed_at" IS NULL) = ("pos_sale_vouchers"."reviewed_by" IS NULL) AND ("pos_sale_vouchers"."reviewed_at" IS NULL OR "pos_sale_vouchers"."issue" IS NOT NULL) AND ("pos_sale_vouchers"."review_note" IS NULL OR length("pos_sale_vouchers"."review_note") BETWEEN 1 AND 300))
);
--> statement-breakpoint
CREATE TABLE "pos_voucher_batches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_voucher_batches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"effect" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"customer_id" bigint,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"qty" integer NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"note" text,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stopped_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_voucher_batches_kind" CHECK ("pos_voucher_batches"."kind" IN ('COUPON', 'PARTNER')),
	CONSTRAINT "pos_voucher_batches_effect" CHECK ("pos_voucher_batches"."effect" IN ('PERCENT', 'AMOUNT')),
	CONSTRAINT "pos_voucher_batches_status" CHECK ("pos_voucher_batches"."status" IN ('ACTIVE', 'STOPPED')),
	CONSTRAINT "pos_voucher_batches_shape" CHECK (("pos_voucher_batches"."kind" = 'PARTNER') = ("pos_voucher_batches"."customer_id" IS NOT NULL) AND ("pos_voucher_batches"."kind" = 'COUPON' OR "pos_voucher_batches"."effect" = 'AMOUNT')),
	CONSTRAINT "pos_voucher_batches_value" CHECK (("pos_voucher_batches"."effect" = 'PERCENT' AND "pos_voucher_batches"."value" > 0 AND "pos_voucher_batches"."value" <= 100) OR ("pos_voucher_batches"."effect" = 'AMOUNT' AND "pos_voucher_batches"."value" > 0 AND "pos_voucher_batches"."value" = round("pos_voucher_batches"."value") AND "pos_voucher_batches"."value" <= 10000000)),
	CONSTRAINT "pos_voucher_batches_dates" CHECK ("pos_voucher_batches"."valid_to" >= "pos_voucher_batches"."valid_from"),
	CONSTRAINT "pos_voucher_batches_qty" CHECK ("pos_voucher_batches"."qty" BETWEEN 1 AND 1000),
	CONSTRAINT "pos_voucher_batches_name" CHECK (length("pos_voucher_batches"."name") BETWEEN 1 AND 120),
	CONSTRAINT "pos_voucher_batches_note" CHECK ("pos_voucher_batches"."note" IS NULL OR length("pos_voucher_batches"."note") BETWEEN 1 AND 300),
	CONSTRAINT "pos_voucher_batches_stopped" CHECK (("pos_voucher_batches"."status" = 'STOPPED') = ("pos_voucher_batches"."stopped_at" IS NOT NULL) AND ("pos_voucher_batches"."stopped_at" IS NULL) = ("pos_voucher_batches"."stopped_by" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "pos_vouchers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_vouchers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"batch_id" bigint NOT NULL,
	"seq" integer NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"sale_id" bigint,
	"redeemed_at" timestamp with time zone,
	"amount" numeric(14, 2),
	CONSTRAINT "pos_vouchers_code_shape" CHECK ("pos_vouchers"."code" ~ '^99[12][0-9]{13}$'),
	CONSTRAINT "pos_vouchers_status" CHECK ("pos_vouchers"."status" IN ('ISSUED', 'REDEEMED')),
	CONSTRAINT "pos_vouchers_redeemed" CHECK (("pos_vouchers"."status" = 'REDEEMED') = ("pos_vouchers"."sale_id" IS NOT NULL) AND ("pos_vouchers"."sale_id" IS NULL) = ("pos_vouchers"."redeemed_at" IS NULL) AND ("pos_vouchers"."sale_id" IS NULL) = ("pos_vouchers"."amount" IS NULL) AND ("pos_vouchers"."amount" IS NULL OR "pos_vouchers"."amount" >= 0)),
	CONSTRAINT "pos_vouchers_seq" CHECK ("pos_vouchers"."seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "pos_shifts" DROP CONSTRAINT "pos_shifts_money";--> statement-breakpoint
ALTER TABLE "pos_tenders" DROP CONSTRAINT "pos_tenders_kind";--> statement-breakpoint
ALTER TABLE "pos_sales" ADD COLUMN "voucher_total" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "voucher_sales" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD COLUMN "voucher_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_sale_vouchers" ADD CONSTRAINT "pos_sale_vouchers_sale_id_pos_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_vouchers" ADD CONSTRAINT "pos_sale_vouchers_voucher_id_pos_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."pos_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_vouchers" ADD CONSTRAINT "pos_sale_vouchers_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_vouchers" ADD CONSTRAINT "pos_sale_vouchers_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_voucher_batches" ADD CONSTRAINT "pos_voucher_batches_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_voucher_batches" ADD CONSTRAINT "pos_voucher_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_voucher_batches" ADD CONSTRAINT "pos_voucher_batches_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_vouchers" ADD CONSTRAINT "pos_vouchers_batch_id_pos_voucher_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."pos_voucher_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_vouchers" ADD CONSTRAINT "pos_vouchers_sale_id_pos_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sale_vouchers_sale_voucher" ON "pos_sale_vouchers" USING btree ("sale_id","voucher_id");--> statement-breakpoint
CREATE INDEX "pos_sale_vouchers_voucher_idx" ON "pos_sale_vouchers" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "pos_sale_vouchers_invoice_idx" ON "pos_sale_vouchers" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "pos_sale_vouchers_issue_idx" ON "pos_sale_vouchers" USING btree ("id") WHERE "pos_sale_vouchers"."issue" IS NOT NULL AND "pos_sale_vouchers"."reviewed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pos_voucher_batches_created_idx" ON "pos_voucher_batches" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "pos_voucher_batches_customer_idx" ON "pos_voucher_batches" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_vouchers_code" ON "pos_vouchers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_vouchers_batch_seq" ON "pos_vouchers" USING btree ("batch_id","seq");--> statement-breakpoint
CREATE INDEX "pos_vouchers_sale_idx" ON "pos_vouchers" USING btree ("sale_id");--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_voucher_id_pos_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."pos_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sales" ADD CONSTRAINT "pos_sales_vouchers" CHECK ("pos_sales"."voucher_total" >= 0 AND "pos_sales"."voucher_total" <= "pos_sales"."total" AND ("pos_sales"."voucher_total" = 0 OR ("pos_sales"."kind" = 'SALE' AND "pos_sales"."credit_total" = 0)));--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_money" CHECK ("pos_shifts"."cash_sales" >= 0 AND "pos_shifts"."cash_refunds" >= 0 AND "pos_shifts"."credit_sales" >= 0 AND "pos_shifts"."credit_refunds" >= 0 AND "pos_shifts"."voucher_sales" >= 0 AND "pos_shifts"."card_sales" >= 0 AND "pos_shifts"."card_refunds" >= 0 AND "pos_shifts"."sales_total" >= 0 AND "pos_shifts"."returns_total" >= 0 AND "pos_shifts"."sales_count" >= 0 AND "pos_shifts"."returns_count" >= 0 AND ("pos_shifts"."counted_cash" IS NULL OR "pos_shifts"."counted_cash" >= 0) AND ("pos_shifts"."float_kept" IS NULL OR "pos_shifts"."float_kept" >= 0));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_voucher" CHECK (("pos_tenders"."kind" = 'VOUCHER') = ("pos_tenders"."voucher_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_kind" CHECK ("pos_tenders"."kind" IN ('CASH', 'CARD', 'CREDIT', 'VOUCHER'));--> statement-breakpoint
-- By hand (ADR-0110): the batches and codes are stopped, never deleted; the uses keep only the
-- office's «Шалгасан» open to change.
REVOKE DELETE, TRUNCATE ON "pos_voucher_batches", "pos_vouchers", "pos_sale_vouchers" FROM app;--> statement-breakpoint
-- pos_vouchers_data:begin
-- The partner vouchers' accounts (temporary codes until Erkhet's chart, TODO-VERIFY D16): what the
-- vouchers paid at the till until the partner's bill takes it over, and the unspent rest of a
-- voucher the partner pays for. Nothing happens on an empty database (no company BO yet).
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, v.code, v.name, v.kind, v.side, 'NONE'
    FROM fin.companies c
    CROSS JOIN (VALUES ('120302', 'Ваучерын тооцоо', 'ASSET', 'DEBIT'),
                       ('511040', 'Ваучерын ашиглагдаагүй үлдэгдлийн орлого', 'INCOME', 'CREDIT'))
      AS v(code, name, kind, side)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT c.id, k.code, 'NONE', false
    FROM fin.companies c
    CROSS JOIN (VALUES ('VOUCHER_CLEARING'), ('VOUCHER_BREAKAGE')) AS k(code)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, k.key, a.id, DATE '2000-01-01'
    FROM fin.companies c
    CROSS JOIN (VALUES ('VOUCHER_CLEARING', '120302'), ('VOUCHER_BREAKAGE', '511040')) AS k(key, code)
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = k.code
   WHERE c.code = 'BO'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = k.key);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND (SELECT count(DISTINCT posting_key) FROM fin.posting_rules
           WHERE posting_key IN ('VOUCHER_CLEARING', 'VOUCHER_BREAKAGE')) <> 2 THEN
    RAISE EXCEPTION 'pos_vouchers: a voucher posting rule is missing';
  END IF;
END $$;
-- pos_vouchers_data:end
