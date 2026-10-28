CREATE TABLE "pos_loyalty_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_loyalty_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"member_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"points" numeric(14, 2) NOT NULL,
	"spend_delta" numeric(14, 2) DEFAULT 0 NOT NULL,
	"sale_id" bigint,
	"percent" numeric(5, 2),
	"reason" text,
	"journal_entry_id" bigint,
	"journal_number" text,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_loyalty_entries_kind" CHECK ("pos_loyalty_entries"."kind" IN ('EARN', 'SPEND', 'RETURN_EARN', 'RETURN_SPEND', 'ADJUST')),
	CONSTRAINT "pos_loyalty_entries_whole" CHECK ("pos_loyalty_entries"."points" = trunc("pos_loyalty_entries"."points")),
	CONSTRAINT "pos_loyalty_entries_sign" CHECK (("pos_loyalty_entries"."kind" = 'EARN' AND "pos_loyalty_entries"."points" >= 0 AND "pos_loyalty_entries"."spend_delta" >= 0) OR ("pos_loyalty_entries"."kind" = 'SPEND' AND "pos_loyalty_entries"."points" < 0 AND "pos_loyalty_entries"."spend_delta" = 0) OR ("pos_loyalty_entries"."kind" = 'RETURN_EARN' AND "pos_loyalty_entries"."points" <= 0 AND "pos_loyalty_entries"."spend_delta" <= 0) OR ("pos_loyalty_entries"."kind" = 'RETURN_SPEND' AND "pos_loyalty_entries"."points" > 0 AND "pos_loyalty_entries"."spend_delta" = 0) OR ("pos_loyalty_entries"."kind" = 'ADJUST' AND "pos_loyalty_entries"."points" <> 0 AND "pos_loyalty_entries"."spend_delta" = 0)),
	CONSTRAINT "pos_loyalty_entries_source" CHECK (("pos_loyalty_entries"."kind" = 'ADJUST') = ("pos_loyalty_entries"."sale_id" IS NULL) AND ("pos_loyalty_entries"."kind" = 'ADJUST') = ("pos_loyalty_entries"."reason" IS NOT NULL) AND ("pos_loyalty_entries"."kind" = 'ADJUST') = ("pos_loyalty_entries"."created_by" IS NOT NULL) AND ("pos_loyalty_entries"."kind" = 'EARN') = ("pos_loyalty_entries"."percent" IS NOT NULL) AND ("pos_loyalty_entries"."journal_entry_id" IS NULL) = ("pos_loyalty_entries"."journal_number" IS NULL) AND ("pos_loyalty_entries"."journal_entry_id" IS NULL OR "pos_loyalty_entries"."kind" = 'ADJUST') AND ("pos_loyalty_entries"."reason" IS NULL OR length("pos_loyalty_entries"."reason") BETWEEN 1 AND 200))
);
--> statement-breakpoint
CREATE TABLE "pos_loyalty_members" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_loyalty_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"pin_hash" text NOT NULL,
	"pin_version" integer DEFAULT 1 NOT NULL,
	"pin_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reg_no" text,
	"birth_date" date,
	"gender" text,
	"note" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"balance" numeric(14, 2) DEFAULT 0 NOT NULL,
	"lifetime_spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_loyalty_members_status" CHECK ("pos_loyalty_members"."status" IN ('ACTIVE', 'BLOCKED')),
	CONSTRAINT "pos_loyalty_members_gender" CHECK ("pos_loyalty_members"."gender" IS NULL OR "pos_loyalty_members"."gender" IN ('MALE', 'FEMALE')),
	CONSTRAINT "pos_loyalty_members_phone" CHECK ("pos_loyalty_members"."phone" ~ '^[+]976[0-9]{8}$'),
	CONSTRAINT "pos_loyalty_members_text" CHECK (length("pos_loyalty_members"."name") BETWEEN 1 AND 120 AND ("pos_loyalty_members"."note" IS NULL OR length("pos_loyalty_members"."note") BETWEEN 1 AND 300) AND ("pos_loyalty_members"."reg_no" IS NULL OR length("pos_loyalty_members"."reg_no") BETWEEN 1 AND 20)),
	CONSTRAINT "pos_loyalty_members_pin" CHECK (length("pos_loyalty_members"."pin_hash") > 0 AND "pos_loyalty_members"."pin_version" >= 1),
	CONSTRAINT "pos_loyalty_members_money" CHECK ("pos_loyalty_members"."balance" = trunc("pos_loyalty_members"."balance") AND "pos_loyalty_members"."lifetime_spend" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pos_loyalty_tiers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_loyalty_tiers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"from_amount" numeric(14, 2) NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"sort" smallint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_loyalty_tiers_status" CHECK ("pos_loyalty_tiers"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "pos_loyalty_tiers_name" CHECK (length("pos_loyalty_tiers"."name") BETWEEN 1 AND 60),
	CONSTRAINT "pos_loyalty_tiers_terms" CHECK ("pos_loyalty_tiers"."from_amount" >= 0 AND "pos_loyalty_tiers"."from_amount" = trunc("pos_loyalty_tiers"."from_amount") AND "pos_loyalty_tiers"."from_amount" <= 100000000000 AND "pos_loyalty_tiers"."percent" > 0 AND "pos_loyalty_tiers"."percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "pos_sale_loyalty" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pos_sale_loyalty_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sale_id" bigint NOT NULL,
	"member_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"earn_base" numeric(14, 2) NOT NULL,
	"percent" numeric(5, 2) NOT NULL,
	"earned" numeric(14, 2) NOT NULL,
	"spent" numeric(14, 2) NOT NULL,
	"given_back" numeric(14, 2) NOT NULL,
	"clawback" numeric(14, 2) NOT NULL,
	"spend_delta" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"issue" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" bigint,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_sale_loyalty_kind" CHECK ("pos_sale_loyalty"."kind" IN ('SALE', 'RETURN')),
	CONSTRAINT "pos_sale_loyalty_issue" CHECK ("pos_sale_loyalty"."issue" IS NULL OR "pos_sale_loyalty"."issue" IN ('BLOCKED', 'OVERDRAWN')),
	CONSTRAINT "pos_sale_loyalty_money" CHECK ("pos_sale_loyalty"."earn_base" >= 0 AND "pos_sale_loyalty"."percent" >= 0 AND "pos_sale_loyalty"."earned" >= 0 AND "pos_sale_loyalty"."spent" >= 0 AND "pos_sale_loyalty"."given_back" >= 0 AND "pos_sale_loyalty"."clawback" >= 0 AND "pos_sale_loyalty"."earned" = trunc("pos_sale_loyalty"."earned") AND "pos_sale_loyalty"."spent" = trunc("pos_sale_loyalty"."spent") AND "pos_sale_loyalty"."given_back" = trunc("pos_sale_loyalty"."given_back") AND "pos_sale_loyalty"."clawback" = trunc("pos_sale_loyalty"."clawback") AND "pos_sale_loyalty"."balance_after" = trunc("pos_sale_loyalty"."balance_after")),
	CONSTRAINT "pos_sale_loyalty_shape" CHECK (("pos_sale_loyalty"."kind" = 'SALE' AND "pos_sale_loyalty"."given_back" = 0 AND "pos_sale_loyalty"."clawback" = 0 AND "pos_sale_loyalty"."spend_delta" = "pos_sale_loyalty"."earn_base") OR ("pos_sale_loyalty"."kind" = 'RETURN' AND "pos_sale_loyalty"."earned" = 0 AND "pos_sale_loyalty"."spent" = 0 AND "pos_sale_loyalty"."spend_delta" <= 0)),
	CONSTRAINT "pos_sale_loyalty_review" CHECK (("pos_sale_loyalty"."reviewed_at" IS NULL) = ("pos_sale_loyalty"."reviewed_by" IS NULL) AND ("pos_sale_loyalty"."reviewed_at" IS NULL OR "pos_sale_loyalty"."issue" IS NOT NULL) AND ("pos_sale_loyalty"."review_note" IS NULL OR length("pos_sale_loyalty"."review_note") BETWEEN 1 AND 300))
);
--> statement-breakpoint
ALTER TABLE "pos_shifts" DROP CONSTRAINT "pos_shifts_money";--> statement-breakpoint
ALTER TABLE "pos_tenders" DROP CONSTRAINT "pos_tenders_kind";--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "points_sales" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "points_refunds" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "points_earned" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD COLUMN "points_clawback" numeric(14, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pos_loyalty_entries" ADD CONSTRAINT "pos_loyalty_entries_member_id_pos_loyalty_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."pos_loyalty_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_loyalty_entries" ADD CONSTRAINT "pos_loyalty_entries_sale_id_pos_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_loyalty_entries" ADD CONSTRAINT "pos_loyalty_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_loyalty_members" ADD CONSTRAINT "pos_loyalty_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_loyalty" ADD CONSTRAINT "pos_sale_loyalty_sale_id_pos_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."pos_sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_loyalty" ADD CONSTRAINT "pos_sale_loyalty_member_id_pos_loyalty_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."pos_loyalty_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_sale_loyalty" ADD CONSTRAINT "pos_sale_loyalty_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pos_loyalty_entries_member_idx" ON "pos_loyalty_entries" USING btree ("member_id","id");--> statement-breakpoint
CREATE INDEX "pos_loyalty_entries_sale_idx" ON "pos_loyalty_entries" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_loyalty_members_phone" ON "pos_loyalty_members" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "pos_loyalty_members_name_idx" ON "pos_loyalty_members" USING btree ("name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "pos_loyalty_tiers_from" ON "pos_loyalty_tiers" USING btree ("from_amount") WHERE "pos_loyalty_tiers"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "pos_sale_loyalty_sale" ON "pos_sale_loyalty" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "pos_sale_loyalty_member_idx" ON "pos_sale_loyalty" USING btree ("member_id","id");--> statement-breakpoint
CREATE INDEX "pos_sale_loyalty_issue_idx" ON "pos_sale_loyalty" USING btree ("id") WHERE "pos_sale_loyalty"."issue" IS NOT NULL AND "pos_sale_loyalty"."reviewed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "pos_shifts" ADD CONSTRAINT "pos_shifts_money" CHECK ("pos_shifts"."cash_sales" >= 0 AND "pos_shifts"."cash_refunds" >= 0 AND "pos_shifts"."credit_sales" >= 0 AND "pos_shifts"."credit_refunds" >= 0 AND "pos_shifts"."voucher_sales" >= 0 AND "pos_shifts"."transfer_sales" >= 0 AND "pos_shifts"."transfer_refunds" >= 0 AND "pos_shifts"."points_sales" >= 0 AND "pos_shifts"."points_refunds" >= 0 AND "pos_shifts"."points_earned" >= 0 AND "pos_shifts"."points_clawback" >= 0 AND "pos_shifts"."card_sales" >= 0 AND "pos_shifts"."card_refunds" >= 0 AND "pos_shifts"."sales_total" >= 0 AND "pos_shifts"."returns_total" >= 0 AND "pos_shifts"."sales_count" >= 0 AND "pos_shifts"."returns_count" >= 0 AND ("pos_shifts"."counted_cash" IS NULL OR "pos_shifts"."counted_cash" >= 0) AND ("pos_shifts"."float_kept" IS NULL OR "pos_shifts"."float_kept" >= 0));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_points" CHECK ("pos_tenders"."kind" <> 'POINTS' OR "pos_tenders"."amount" = trunc("pos_tenders"."amount"));--> statement-breakpoint
ALTER TABLE "pos_tenders" ADD CONSTRAINT "pos_tenders_kind" CHECK ("pos_tenders"."kind" IN ('CASH', 'CARD', 'TRANSFER', 'CREDIT', 'VOUCHER', 'POINTS'));--> statement-breakpoint
-- By hand (ADR-0112): members and tiers are blocked or retired, never deleted; a sale's member part
-- keeps only the office's «Шалгасан» open to change; the points history is append-only.
REVOKE DELETE, TRUNCATE ON "pos_loyalty_members", "pos_loyalty_tiers", "pos_sale_loyalty" FROM app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "pos_loyalty_entries" FROM app;--> statement-breakpoint
CREATE TRIGGER "pos_loyalty_entries_no_update_delete" BEFORE UPDATE OR DELETE ON "pos_loyalty_entries"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
CREATE TRIGGER "pos_loyalty_entries_no_truncate" BEFORE TRUNCATE ON "pos_loyalty_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();--> statement-breakpoint
-- pos_loyalty_data:begin
-- The bonus card's accounts (temporary codes until Erkhet's chart, TODO-VERIFY D16): the points
-- members hold, owed to them as a payment at the till, and their cost when earned. Nothing happens
-- on an empty database (no company BO yet).
INSERT INTO fin.accounts (company_id, code, name, kind, normal_side, control)
  SELECT c.id, v.code, v.name, v.kind, v.side, 'NONE'
    FROM fin.companies c
    CROSS JOIN (VALUES ('320301', 'Бонус онооны өр', 'LIABILITY', 'CREDIT'),
                       ('730301', 'Бонус онооны зардал', 'EXPENSE', 'DEBIT'))
      AS v(code, name, kind, side)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_keys (company_id, code, required_control, requires_tax_code)
  SELECT c.id, k.code, 'NONE', false
    FROM fin.companies c
    CROSS JOIN (VALUES ('LOYALTY_LIABILITY'), ('LOYALTY_EXPENSE')) AS k(code)
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
  SELECT c.id, k.key, a.id, DATE '2000-01-01'
    FROM fin.companies c
    CROSS JOIN (VALUES ('LOYALTY_LIABILITY', '320301'), ('LOYALTY_EXPENSE', '730301')) AS k(key, code)
    JOIN fin.accounts a ON a.company_id = c.id AND a.code = k.code
   WHERE c.code = 'BO'
     AND NOT EXISTS (SELECT 1 FROM fin.posting_rules r
                      WHERE r.company_id = c.id AND r.posting_key = k.key);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND (SELECT count(DISTINCT posting_key) FROM fin.posting_rules
           WHERE posting_key IN ('LOYALTY_LIABILITY', 'LOYALTY_EXPENSE')) <> 2 THEN
    RAISE EXCEPTION 'pos_loyalty: a bonus card posting rule is missing';
  END IF;
END $$;
-- pos_loyalty_data:end
