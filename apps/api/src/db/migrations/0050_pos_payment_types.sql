-- The till's payment types, payment rows, sales history and day summary (ADR-0111). Generated from
-- the pos schema, then by hand: the REVOKEs, the day counts' append-only guard, the four first
-- payment types, and the transfer clearing account of company BO (as 0044 added its account).
CREATE TABLE "pos_day_counts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_day_counts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"edge_node_id" bigint NOT NULL,
	"till_id" bigint NOT NULL,
	"day" text NOT NULL,
	"cashier_user_id" bigint NOT NULL,
	"counts" jsonb NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"counted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_day_counts_day" CHECK ("pos_day_counts"."day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "pos_day_counts_total" CHECK ("pos_day_counts"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pos_payment_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_payment_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"sort" smallint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_payment_types_kind" CHECK ("pos_payment_types"."kind" IN ('CASH', 'CARD', 'TRANSFER', 'CREDIT')),
	CONSTRAINT "pos_payment_types_status" CHECK ("pos_payment_types"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "pos_payment_types_name_length" CHECK (length("pos_payment_types"."name") BETWEEN 1 AND 40),
	CONSTRAINT "pos_payment_types_sort_range" CHECK ("pos_payment_types"."sort" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pos_shifts" DROP CONSTRAINT "pos_shifts_money";--> statement-breakpoint
ALTER TABLE "pos_sync_rejections" DROP CONSTRAINT "pos_sync_rejections_kind";--> statement-breakpoint
ALTER TABLE "pos_tenders" DROP CONSTRAINT "pos_tenders_kind";--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "transfer_sales" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "transfer_refunds" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD COLUMN "payment_type_id" bigint;--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD COLUMN "payment_type_name" text;--> statement-breakpoint
ALTER TABLE "pos_tills" ADD COLUMN "printer_name" text;--> statement-breakpoint
ALTER TABLE "pos_day_counts" ADD CONSTRAINT "pos_day_counts_edge_node_id_pos_edge_nodes_id_fk" FOREIGN KEY ("edge_node_id") REFERENCES "public"."pos_edge_nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_day_counts" ADD CONSTRAINT "pos_day_counts_till_id_pos_tills_id_fk" FOREIGN KEY ("till_id") REFERENCES "public"."pos_tills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_day_counts" ADD CONSTRAINT "pos_day_counts_cashier_user_id_users_id_fk" FOREIGN KEY ("cashier_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pos_day_counts_client" ON "pos_day_counts" USING btree ("edge_node_id","client_id");--> statement-breakpoint
CREATE INDEX "pos_day_counts_till_day_idx" ON "pos_day_counts" USING btree ("till_id","day","id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_types_name" ON "pos_payment_types" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_payment_types_one_cash" ON "pos_payment_types" USING btree ("kind") WHERE "pos_payment_types"."status" = 'ACTIVE' AND "pos_payment_types"."kind" IN ('CASH', 'CREDIT');--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_payment_type_id_pos_payment_types_id_fk" FOREIGN KEY ("payment_type_id") REFERENCES "public"."pos_payment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_money" CHECK ("pos_shifts"."cash_sales" >= 0 AND "pos_shifts"."cash_refunds" >= 0 AND "pos_shifts"."credit_sales" >= 0 AND "pos_shifts"."credit_refunds" >= 0 AND "pos_shifts"."transfer_sales" >= 0 AND "pos_shifts"."transfer_refunds" >= 0 AND "pos_shifts"."card_sales" >= 0 AND "pos_shifts"."card_refunds" >= 0 AND "pos_shifts"."sales_total" >= 0 AND "pos_shifts"."returns_total" >= 0 AND "pos_shifts"."sales_count" >= 0 AND "pos_shifts"."returns_count" >= 0 AND ("pos_shifts"."counted_cash" IS NULL OR "pos_shifts"."counted_cash" >= 0) AND ("pos_shifts"."float_kept" IS NULL OR "pos_shifts"."float_kept" >= 0));--> statement-breakpoint
ALTER TABLE "pos_sync_rejections" ADD CONSTRAINT "pos_sync_rejections_kind" CHECK ("pos_sync_rejections"."kind" IN ('TILL_BOUND', 'SHIFT_OPENED', 'SALE', 'RETURN', 'SHIFT_CLOSED', 'RECEIPT_STATUS', 'VOID', 'DAY_COUNT'));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_payment_type_name" CHECK (("pos_tenders"."payment_type_id" IS NULL) = ("pos_tenders"."payment_type_name" IS NULL) AND ("pos_tenders"."payment_type_name" IS NULL OR length("pos_tenders"."payment_type_name") BETWEEN 1 AND 40));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_kind" CHECK ("pos_tenders"."kind" IN ('CASH', 'CARD', 'TRANSFER', 'CREDIT'));--> statement-breakpoint
-- A payment type is never deleted (tenders name it); a day count is never changed or removed.
REVOKE DELETE, TRUNCATE ON "pos_payment_types" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "pos_day_counts" FROM app;--> statement-breakpoint
CREATE TRIGGER "pos_day_counts_no_update_delete" BEFORE UPDATE OR DELETE ON "pos_day_counts"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER "pos_day_counts_no_truncate" BEFORE TRUNCATE ON "pos_day_counts"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
-- The owner's first types (2026-10-27); the admin renames, reorders and adds on «Тохиргоо».
INSERT INTO "pos_payment_types" ("name", "kind", "sort") VALUES
  ('Бэлэн', 'CASH', 0),
  ('Khaanbank terminal', 'CARD', 1),
  ('Шилжүүлэг', 'TRANSFER', 2),
  ('Зээл', 'CREDIT', 3)
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The till's bank transfers until the accountant matches them (TODO-VERIFY with the accountant).
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, '120302', 'Шилжүүлгийн төлбөрийн авлага', 'ASSET', 'DEBIT', 'NONE'
    FROM fin.companies c
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT id, 'TRANSFER_CLEARING', 'NONE', false FROM fin.companies WHERE code = 'BO'
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, 'TRANSFER_CLEARING', a.id, DATE '2000-01-01'
    FROM fin.companies c
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = '120302'
   WHERE c.code = 'BO'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = 'TRANSFER_CLEARING');
