CREATE TABLE "goods_issue_confirmations" (
	"issue_id" bigint NOT NULL,
	"warehouse_id" bigint NOT NULL,
	"confirmed_by" bigint,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unchanged" boolean DEFAULT false NOT NULL,
	CONSTRAINT "goods_issue_confirmations_issue_id_warehouse_id_pk" PRIMARY KEY("issue_id","warehouse_id")
);
--> statement-breakpoint
ALTER TABLE "goods_issues" DROP CONSTRAINT "goods_issues_status";--> statement-breakpoint
ALTER TABLE "goods_issues" DROP CONSTRAINT "goods_issues_texts";--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ALTER COLUMN "bin_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD COLUMN "warehouse_id" bigint;--> statement-breakpoint
-- By hand (ADR-0117): every line so far left its issue's one warehouse.
UPDATE "goods_issue_lines" l SET "warehouse_id" = g."warehouse_id" FROM "goods_issues" g WHERE g."id" = l."issue_id";--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ALTER COLUMN "warehouse_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD COLUMN "sale_unit_price" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD COLUMN "sale_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "goods_issues" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD COLUMN "sent_by" bigint;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD COLUMN "return_note" text;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD COLUMN "returned_by" bigint;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD COLUMN "corrects_issue_id" bigint;--> statement-breakpoint
ALTER TABLE "goods_issue_confirmations" ADD CONSTRAINT "goods_issue_confirmations_issue_id_goods_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."goods_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_confirmations" ADD CONSTRAINT "goods_issue_confirmations_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_confirmations" ADD CONSTRAINT "goods_issue_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_corrects_issue_id_goods_issues_id_fk" FOREIGN KEY ("corrects_issue_id") REFERENCES "public"."goods_issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fin_journal_lines_account_party_idx" ON "fin"."journal_lines" USING btree ("company_id","account_id","party_id");--> statement-breakpoint
CREATE INDEX "goods_issue_lines_warehouse_idx" ON "goods_issue_lines" USING btree ("issue_id","warehouse_id");--> statement-breakpoint
CREATE INDEX "goods_issues_corrects_idx" ON "goods_issues" USING btree ("corrects_issue_id");--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_sale" CHECK (("goods_issue_lines"."sale_unit_price" IS NULL) = ("goods_issue_lines"."sale_amount" IS NULL)
        AND ("goods_issue_lines"."sale_unit_price" IS NULL OR ("goods_issue_lines"."sale_unit_price" >= 0 AND "goods_issue_lines"."sale_amount" >= 0)));--> statement-breakpoint
ALTER TABLE "goods_issue_lines" ADD CONSTRAINT "goods_issue_lines_posted_bin" CHECK ("goods_issue_lines"."unit_cost" IS NULL OR "goods_issue_lines"."bin_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_returned" CHECK (("goods_issues"."status" <> 'RETURNED' OR "goods_issues"."return_note" IS NOT NULL)
        AND ("goods_issues"."return_note" IS NULL) = ("goods_issues"."returned_at" IS NULL));--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_status" CHECK ("goods_issues"."status" IN ('DRAFT', 'SENT', 'RETURNED', 'POSTED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "goods_issues" ADD CONSTRAINT "goods_issues_texts" CHECK (("goods_issues"."recipient_name" IS NULL OR length("goods_issues"."recipient_name") BETWEEN 1 AND 200)
        AND ("goods_issues"."note" IS NULL OR length("goods_issues"."note") BETWEEN 1 AND 500)
        AND ("goods_issues"."return_note" IS NULL OR length("goods_issues"."return_note") BETWEEN 1 AND 500));--> statement-breakpoint
-- By hand (ADR-0117). A confirmation that posted is never withdrawn; only a correction's "unchanged" marks are
-- deleted, at its next send.
REVOKE TRUNCATE ON "goods_issue_confirmations" FROM app;--> statement-breakpoint
-- The ledger takes a correction's reversal: the goods of the corrected part come back (sign +1).
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_movement_type";--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_movement_type" CHECK ("movement_type" IN ('RECEIPT',
  'PUTAWAY_OUT', 'PUTAWAY_IN', 'BIN_MOVE_OUT', 'BIN_MOVE_IN', 'PICK_OUT', 'PICK_IN', 'DISPATCH_OUT',
  'DISPATCH_IN', 'DELIVERY_ISSUE', 'POS_SALE', 'GOODS_ISSUE', 'GOODS_ISSUE_REVERSAL', 'TRANSFER_OUT',
  'TRANSFER_IN', 'RETURN_IN', 'ADJUSTMENT', 'COUNT_CORRECTION'));--> statement-breakpoint
ALTER TABLE "stock_ledger" DROP CONSTRAINT "stock_ledger_sign";--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_sign" CHECK (CASE
  WHEN "movement_type" IN ('RECEIPT', 'PUTAWAY_IN', 'BIN_MOVE_IN', 'PICK_IN', 'DISPATCH_IN', 'TRANSFER_IN',
    'RETURN_IN', 'GOODS_ISSUE_REVERSAL') THEN "qty_base" > 0
  WHEN "movement_type" IN ('PUTAWAY_OUT', 'BIN_MOVE_OUT', 'PICK_OUT', 'DISPATCH_OUT', 'DELIVERY_ISSUE',
    'POS_SALE', 'GOODS_ISSUE', 'TRANSFER_OUT') THEN "qty_base" < 0
  ELSE true END);--> statement-breakpoint
-- The seventh default expense type: damage charged to a person at the sale price (ADR-0117 #3).
INSERT INTO "issue_expense_types" ("name", "name_key", "code", "sort_order") VALUES
  ('Хүнд тооцох', 'хүнд тооцох', 'DAMAGE_CHARGE', 70)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Finance Core: the charge's document type (an AR invoice numbered by Bto), for a database whose
-- company exists; a new database gets it from the api's boot step. Nothing happens without BO.
-- issues_confirmed:data:begin
INSERT INTO fin.document_types (company_id, code, source_system_id, class, number_mode, number_series)
  SELECT c.id, 'BTO.DAMAGE_CHARGE', s.id, 'AR_INVOICE', 'SOURCE', NULL
    FROM fin.companies c
    JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'BTO'
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND NOT EXISTS (SELECT 1 FROM fin.document_types WHERE code = 'BTO.DAMAGE_CHARGE') THEN
    RAISE EXCEPTION 'issues_confirmed: the damage charge document type is missing';
  END IF;
END $$;
-- issues_confirmed:data:end
