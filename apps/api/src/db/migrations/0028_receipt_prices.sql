ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind";--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "doc_unit_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "doc_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD COLUMN "free_goods" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "payment_method" text DEFAULT 'CREDIT' NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "money_account_id" integer;--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD COLUMN "vat_rate_pct" numeric(5, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "options" jsonb;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "vat_payer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_price" CHECK (("goods_receipt_lines"."doc_amount" IS NULL OR "goods_receipt_lines"."doc_amount" >= 0)
        AND ("goods_receipt_lines"."doc_unit_price" IS NULL OR ("goods_receipt_lines"."doc_unit_price" >= 0 AND "goods_receipt_lines"."doc_amount" IS NOT NULL))
        AND NOT ("goods_receipt_lines"."free_goods" AND "goods_receipt_lines"."doc_amount" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_payment_method" CHECK ("goods_receipts"."payment_method" IN ('CREDIT', 'CASH', 'BANK'));--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_money_account" CHECK ("goods_receipts"."payment_method" <> 'CREDIT' OR "goods_receipts"."money_account_id" IS NULL);--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_vat_rate" CHECK ("goods_receipts"."vat_rate_pct" >= 0 AND "goods_receipts"."vat_rate_pct" < 100);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind" CHECK ("import_jobs"."kind" IN ('PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK', 'LEVELS', 'PRICES', 'RECEIPTS'));--> statement-breakpoint
-- ADR-0078 #4: what the accountant or the receipt typed, VAT included as on the delivery note; the
-- valuation's amount stays the ex-VAT cost. NULL on rows written before this migration. The table
-- is defined in 0006 (--custom), so drizzle-kit does not see it.
ALTER TABLE "stock_valuation_adjustments" ADD COLUMN "doc_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "stock_valuation_adjustments" ADD CONSTRAINT "stock_valuation_adjustments_doc_amount" CHECK ("doc_amount" IS NULL OR "doc_amount" >= 0);
