CREATE TABLE "bank_statement_lines" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_statement_lines_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"statement_id" bigint NOT NULL,
	"line_no" integer NOT NULL,
	"txn_at" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"debit" numeric(14, 2) NOT NULL,
	"credit" numeric(14, 2) NOT NULL,
	"bank_description" text NOT NULL,
	"bank_counterpart" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"customer_id" bigint,
	"supplier_id" bigint,
	"counter_account_id" bigint,
	"description" text NOT NULL,
	"action" text,
	"export_type" text,
	"payment_id" bigint,
	"journal_entry_id" bigint,
	"posted_at" timestamp with time zone,
	"posted_by" bigint,
	"post_attempt" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_lines_kind" CHECK ("bank_statement_lines"."kind" IN ('NORMAL', 'FEE', 'SETTLEMENT')),
	CONSTRAINT "bank_statement_lines_action" CHECK ("bank_statement_lines"."action" IS NULL OR "bank_statement_lines"."action" IN ('CLOSE', 'CREATE', 'CLOSE_CREATE')),
	CONSTRAINT "bank_statement_lines_export" CHECK ("bank_statement_lines"."export_type" IS NULL OR "bank_statement_lines"."export_type" IN ('BANK', 'CASH')),
	CONSTRAINT "bank_statement_lines_side" CHECK (("bank_statement_lines"."debit" > 0 AND "bank_statement_lines"."credit" = 0) OR ("bank_statement_lines"."credit" > 0 AND "bank_statement_lines"."debit" = 0)),
	CONSTRAINT "bank_statement_lines_one_party" CHECK ("bank_statement_lines"."customer_id" IS NULL OR "bank_statement_lines"."supplier_id" IS NULL),
	CONSTRAINT "bank_statement_lines_posted" CHECK (("bank_statement_lines"."posted_at" IS NULL) = ("bank_statement_lines"."posted_by" IS NULL) AND ("bank_statement_lines"."posted_at" IS NULL OR "bank_statement_lines"."payment_id" IS NOT NULL OR "bank_statement_lines"."journal_entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "bank_statement_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"settlement_account_id" bigint,
	"settlement_description" text NOT NULL,
	"settlement_action" text NOT NULL,
	"fee_account_id" bigint,
	"fee_description" text NOT NULL,
	"fee_action" text NOT NULL,
	"fee_export_type" text NOT NULL,
	"party_code" text NOT NULL,
	"counter_account_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
	"updated_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statement_settings_single" CHECK ("bank_statement_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "bank_statements" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bank_statements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_number" text NOT NULL,
	"currency" text NOT NULL,
	"statement_date" date NOT NULL,
	"date_to" date NOT NULL,
	"file_name" text NOT NULL,
	"file_id" bigint,
	"money_account_id" bigint,
	"uploaded_by" bigint NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_statements_account" CHECK (length("bank_statements"."account_number") BETWEEN 1 AND 40),
	CONSTRAINT "bank_statements_dates" CHECK ("bank_statements"."date_to" >= "bank_statements"."statement_date")
);
--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_bank_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."bank_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement_settings" ADD CONSTRAINT "bank_statement_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_lines_dedupe_uq" ON "bank_statement_lines" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_statement_lines_no_uq" ON "bank_statement_lines" USING btree ("statement_id","line_no");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_counterpart_idx" ON "bank_statement_lines" USING btree ("bank_counterpart","id");--> statement-breakpoint
CREATE INDEX "bank_statement_lines_date_idx" ON "bank_statement_lines" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "bank_statements_date_idx" ON "bank_statements" USING btree ("statement_date");--> statement-breakpoint
CREATE INDEX "bank_statements_account_idx" ON "bank_statements" USING btree ("account_number");--> statement-breakpoint
-- By hand (ADR-0169): the rules' row stays, and a line that reached the books is never deleted.
REVOKE DELETE, TRUNCATE ON "bank_statement_settings" FROM app;--> statement-breakpoint
CREATE FUNCTION "bank_statement_line_keep_posted"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."posted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'bank statement line % is in the books', OLD."id" USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bank_statement_lines_keep_posted" BEFORE DELETE ON "bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION "bank_statement_line_keep_posted"();
