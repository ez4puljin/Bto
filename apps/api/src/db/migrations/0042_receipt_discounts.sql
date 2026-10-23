-- ADR-0103: a receipt's discounts on chosen lines or on the whole note replace the header's one
-- discount of 0038 (numbered 0042: 0039–0041 are reserved for other work).
CREATE TABLE "goods_receipt_discount_lines" (
	"discount_id" bigint NOT NULL,
	"line_id" bigint NOT NULL,
	CONSTRAINT "goods_receipt_discount_lines_discount_id_line_id_pk" PRIMARY KEY("discount_id","line_id")
);
--> statement-breakpoint
CREATE TABLE "goods_receipt_discounts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goods_receipt_discounts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"pct" numeric(5, 2),
	"amount" numeric(14, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goods_receipt_discounts_kind" CHECK ("goods_receipt_discounts"."kind" IN ('LINES', 'NOTE')),
	CONSTRAINT "goods_receipt_discounts_value" CHECK (("goods_receipt_discounts"."pct" IS NULL) <> ("goods_receipt_discounts"."amount" IS NULL)
        AND ("goods_receipt_discounts"."pct" IS NULL OR ("goods_receipt_discounts"."pct" > 0 AND "goods_receipt_discounts"."pct" <= 100))
        AND ("goods_receipt_discounts"."amount" IS NULL OR "goods_receipt_discounts"."amount" > 0))
);
--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP CONSTRAINT "goods_receipts_discount";--> statement-breakpoint
ALTER TABLE "goods_receipt_discount_lines" ADD CONSTRAINT "goods_receipt_discount_lines_discount_id_goods_receipt_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."goods_receipt_discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_discount_lines" ADD CONSTRAINT "goods_receipt_discount_lines_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_receipt_discounts" ADD CONSTRAINT "goods_receipt_discounts_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goods_receipt_discount_lines_line_idx" ON "goods_receipt_discount_lines" USING btree ("line_id");--> statement-breakpoint
CREATE INDEX "goods_receipt_discounts_receipt_idx" ON "goods_receipt_discounts" USING btree ("receipt_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "goods_receipt_discounts_note_key" ON "goods_receipt_discounts" USING btree ("receipt_id") WHERE "goods_receipt_discounts"."kind" = 'NOTE';--> statement-breakpoint
-- ADR-0103: a header discount of 0038 becomes the receipt's NOTE discount.
INSERT INTO "goods_receipt_discounts" ("receipt_id", "kind", "pct", "amount")
  SELECT "id", 'NOTE', "discount_pct", "discount_amount" FROM "goods_receipts"
   WHERE "discount_pct" IS NOT NULL OR "discount_amount" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "discount_pct";--> statement-breakpoint
ALTER TABLE "goods_receipts" DROP COLUMN "discount_amount";