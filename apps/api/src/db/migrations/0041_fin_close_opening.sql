CREATE TABLE "fin"."account_groups" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."account_groups_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_account_groups_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "fin_account_groups_company_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "fin_account_groups_code" CHECK ("fin"."account_groups"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
	CONSTRAINT "fin_account_groups_name" CHECK (length(btrim("fin"."account_groups"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "fin_account_groups_status" CHECK ("fin"."account_groups"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "fin"."period_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."period_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" bigint NOT NULL,
	"period_id" bigint NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_label" text NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_period_events_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "fin_period_events_action" CHECK ("fin"."period_events"."action" IN ('CLOSE', 'REOPEN')),
	CONSTRAINT "fin_period_events_reason" CHECK (("fin"."period_events"."action" = 'CLOSE' AND "fin"."period_events"."reason" IS NULL) OR ("fin"."period_events"."action" = 'REOPEN' AND length(btrim("fin"."period_events"."reason")) BETWEEN 1 AND 500)),
	CONSTRAINT "fin_period_events_actor_kind" CHECK ("fin"."period_events"."actor_kind" IN ('STAFF', 'SOURCE', 'SYSTEM'))
);
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_kind";--> statement-breakpoint
ALTER TABLE "fin"."accounts" ADD COLUMN "group_id" bigint;--> statement-breakpoint
ALTER TABLE "fin"."account_groups" ADD CONSTRAINT "account_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "fin"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."period_events" ADD CONSTRAINT "fin_period_events_period_fk" FOREIGN KEY ("company_id","period_id") REFERENCES "fin"."fiscal_periods"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fin_period_events_period_idx" ON "fin"."period_events" USING btree ("company_id","period_id","id");--> statement-breakpoint
ALTER TABLE "fin"."accounts" ADD CONSTRAINT "fin_accounts_group_fk" FOREIGN KEY ("company_id","group_id") REFERENCES "fin"."account_groups"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_kind" CHECK ("import_jobs"."kind" IN ('PRODUCTS', 'CUSTOMERS', 'SUPPLIERS', 'OPENING_STOCK', 'LEVELS', 'PRICES', 'RECEIPTS', 'ISSUES', 'FIN_CHART', 'FIN_OPENING'));
--> statement-breakpoint
-- Hand-written (ADR-0102): the month's events are append-only for every role; groups are never
-- deleted, only deactivated.
REVOKE DELETE, TRUNCATE ON fin.account_groups, fin.period_events FROM app;
--> statement-breakpoint
REVOKE UPDATE ON fin.period_events FROM app;
--> statement-breakpoint
CREATE TRIGGER period_events_append_only BEFORE UPDATE OR DELETE ON fin.period_events
  FOR EACH ROW EXECUTE FUNCTION fin.forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER period_events_no_truncate BEFORE TRUNCATE ON fin.period_events
  FOR EACH STATEMENT EXECUTE FUNCTION fin.forbid_update_delete();
--> statement-breakpoint
-- fin_close_opening:data:begin
-- The opening document's type (class OPENING, typed by the accountant through the import, numbered
-- from the journal's series), as the api's boot step makes it (ensureDefaultCompany).
INSERT INTO fin.document_types (company_id, code, source_system_id, class, number_mode, number_series)
  SELECT c.id, 'FIN.OPENING', s.id, 'OPENING', 'CORE', 'JOURNAL'
    FROM fin.companies c
    JOIN fin.source_systems s ON s.tenant_id = c.tenant_id AND s.code = 'FIN'
   WHERE c.code = 'BO'
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM fin.companies WHERE code = 'BO')
     AND NOT EXISTS (SELECT 1 FROM fin.document_types WHERE code = 'FIN.OPENING') THEN
    RAISE EXCEPTION 'fin_close_opening: the opening document type is missing';
  END IF;
END $$;
-- fin_close_opening:data:end
