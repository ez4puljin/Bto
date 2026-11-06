-- A receipt is numbered at its first save (ADR-0153): a draft may carry a number, a posted receipt must.
ALTER TABLE "goods_receipts" DROP CONSTRAINT "goods_receipts_posted";--> statement-breakpoint
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_posted" CHECK (("goods_receipts"."status" = 'POSTED') = ("goods_receipts"."posted_at" IS NOT NULL
        AND "goods_receipts"."effective_date" IS NOT NULL AND "goods_receipts"."costing_status" IS NOT NULL)
        AND ("goods_receipts"."status" <> 'POSTED' OR "goods_receipts"."number" IS NOT NULL));