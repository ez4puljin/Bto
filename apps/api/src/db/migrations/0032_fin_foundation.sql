CREATE SCHEMA "fin";
--> statement-breakpoint
CREATE TABLE "fin"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"company_id" bigint,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_label" text NOT NULL,
	"principal" text NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	CONSTRAINT "fin_audit_log_actor_kind" CHECK ("fin"."audit_log"."actor_kind" IN ('STAFF', 'SOURCE', 'SYSTEM')),
	CONSTRAINT "fin_audit_log_action" CHECK ("fin"."audit_log"."action" ~ '^[A-Z][A-Z_]{0,31}$')
);
--> statement-breakpoint
CREATE TABLE "fin"."branch_refs" (
	"company_id" bigint NOT NULL,
	"source_system_id" bigint NOT NULL,
	"external_id" text NOT NULL,
	"branch_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_branch_refs_pkey" PRIMARY KEY("company_id","source_system_id","external_id"),
	CONSTRAINT "fin_branch_refs_branch_key" UNIQUE("company_id","source_system_id","branch_id"),
	CONSTRAINT "fin_branch_refs_external_id" CHECK (length("fin"."branch_refs"."external_id") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "fin"."branches" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"company_id" bigint NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_branches_company_id_key" UNIQUE("company_id","id"),
	CONSTRAINT "fin_branches_company_code_key" UNIQUE("company_id","code"),
	CONSTRAINT "fin_branches_code" CHECK ("fin"."branches"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
	CONSTRAINT "fin_branches_name" CHECK (length(btrim("fin"."branches"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "fin_branches_status" CHECK ("fin"."branches"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "fin"."companies" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"register_no" text,
	"tin" text,
	"functional_currency" char(3) DEFAULT 'MNT' NOT NULL,
	"timezone" text DEFAULT 'Asia/Ulaanbaatar' NOT NULL,
	"fiscal_year_start_month" smallint DEFAULT 1 NOT NULL,
	"control_approved" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_companies_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "fin_companies_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "fin_companies_code" CHECK ("fin"."companies"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
	CONSTRAINT "fin_companies_legal_name" CHECK (length(btrim("fin"."companies"."legal_name")) BETWEEN 1 AND 200),
	CONSTRAINT "fin_companies_register_no" CHECK ("fin"."companies"."register_no" IS NULL OR (length("fin"."companies"."register_no") BETWEEN 1 AND 32 AND "fin"."companies"."register_no" !~ '[[:cntrl:]]')),
	CONSTRAINT "fin_companies_tin" CHECK ("fin"."companies"."tin" IS NULL OR (length("fin"."companies"."tin") BETWEEN 1 AND 32 AND "fin"."companies"."tin" !~ '[[:cntrl:]]')),
	CONSTRAINT "fin_companies_currency" CHECK ("fin"."companies"."functional_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fin_companies_timezone" CHECK (length("fin"."companies"."timezone") BETWEEN 1 AND 64),
	CONSTRAINT "fin_companies_fiscal_month" CHECK ("fin"."companies"."fiscal_year_start_month" BETWEEN 1 AND 12),
	CONSTRAINT "fin_companies_status" CHECK ("fin"."companies"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "fin"."company_tax_registrations" (
	"company_id" bigint NOT NULL,
	"tax_kind" text NOT NULL,
	"effective_from" date NOT NULL,
	"registered" boolean NOT NULL,
	"activity_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_company_tax_registrations_pkey" PRIMARY KEY("company_id","tax_kind","effective_from"),
	CONSTRAINT "fin_company_tax_registrations_kind" CHECK ("fin"."company_tax_registrations"."tax_kind" ~ '^[A-Z][A-Z_]{0,31}$'),
	CONSTRAINT "fin_company_tax_registrations_activity" CHECK ("fin"."company_tax_registrations"."activity_code" IS NULL OR (length("fin"."company_tax_registrations"."activity_code") BETWEEN 1 AND 32 AND "fin"."company_tax_registrations"."activity_code" !~ '[[:cntrl:]]'))
);
--> statement-breakpoint
CREATE TABLE "fin"."parties" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."parties_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"tin" text,
	"register_no" text,
	"intercompany_company_id" bigint,
	"merged_into_id" bigint,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_parties_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "fin_parties_kind" CHECK ("fin"."parties"."kind" IN ('COMPANY', 'INDIVIDUAL', 'INTERNAL', 'TAX_AUTHORITY', 'EMPLOYEE', 'OTHER')),
	CONSTRAINT "fin_parties_internal" CHECK (("fin"."parties"."kind" = 'INTERNAL') = ("fin"."parties"."intercompany_company_id" IS NOT NULL)),
	CONSTRAINT "fin_parties_name" CHECK (length(btrim("fin"."parties"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "fin_parties_tin" CHECK ("fin"."parties"."tin" IS NULL OR (length("fin"."parties"."tin") BETWEEN 1 AND 32 AND "fin"."parties"."tin" !~ '[[:cntrl:]]')),
	CONSTRAINT "fin_parties_register_no" CHECK ("fin"."parties"."register_no" IS NULL OR (length("fin"."parties"."register_no") BETWEEN 1 AND 32 AND "fin"."parties"."register_no" !~ '[[:cntrl:]]')),
	CONSTRAINT "fin_parties_status" CHECK ("fin"."parties"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "fin"."party_companies" (
	"company_id" bigint NOT NULL,
	"party_id" bigint NOT NULL,
	"tenant_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_party_companies_pkey" PRIMARY KEY("company_id","party_id")
);
--> statement-breakpoint
CREATE TABLE "fin"."party_refs" (
	"tenant_id" bigint NOT NULL,
	"source_system_id" bigint NOT NULL,
	"external_id" text NOT NULL,
	"party_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_party_refs_pkey" PRIMARY KEY("tenant_id","source_system_id","external_id"),
	CONSTRAINT "fin_party_refs_external_id" CHECK (length("fin"."party_refs"."external_id") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "fin"."posting_keys" (
	"company_id" bigint NOT NULL,
	"code" text NOT NULL,
	"required_control" text NOT NULL,
	"requires_tax_code" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_posting_keys_pkey" PRIMARY KEY("company_id","code"),
	CONSTRAINT "fin_posting_keys_code" CHECK ("fin"."posting_keys"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
	CONSTRAINT "fin_posting_keys_control" CHECK ("fin"."posting_keys"."required_control" IN ('NONE', 'RECEIVABLE', 'PAYABLE', 'ADVANCE_RECEIVED', 'ADVANCE_PAID', 'MONEY'))
);
--> statement-breakpoint
CREATE TABLE "fin"."source_grants" (
	"tenant_id" bigint NOT NULL,
	"company_id" bigint NOT NULL,
	"source_system_id" bigint NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_source_grants_pkey" PRIMARY KEY("company_id","source_system_id"),
	CONSTRAINT "fin_source_grants_status" CHECK ("fin"."source_grants"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "fin"."source_systems" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."source_systems_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"code" text NOT NULL,
	"link_template" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_source_systems_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "fin_source_systems_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "fin_source_systems_code" CHECK ("fin"."source_systems"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
	CONSTRAINT "fin_source_systems_link" CHECK ("fin"."source_systems"."link_template" IS NULL OR length("fin"."source_systems"."link_template") <= 512),
	CONSTRAINT "fin_source_systems_status" CHECK ("fin"."source_systems"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "fin"."tenants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fin"."tenants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fin_tenants_code_key" UNIQUE("code"),
	CONSTRAINT "fin_tenants_code" CHECK ("fin"."tenants"."code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'),
	CONSTRAINT "fin_tenants_name" CHECK (length(btrim("fin"."tenants"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "fin_tenants_status" CHECK ("fin"."tenants"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "user_company_roles" (
	"user_id" bigint NOT NULL,
	"company_code" text NOT NULL,
	"role_id" bigint NOT NULL,
	CONSTRAINT "user_company_roles_user_id_company_code_role_id_pk" PRIMARY KEY("user_id","company_code","role_id"),
	CONSTRAINT "user_company_roles_company_code" CHECK ("user_company_roles"."company_code" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE "fin"."audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "fin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."audit_log" ADD CONSTRAINT "fin_audit_log_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "fin"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."branch_refs" ADD CONSTRAINT "fin_branch_refs_grant_fk" FOREIGN KEY ("company_id","source_system_id") REFERENCES "fin"."source_grants"("company_id","source_system_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."branch_refs" ADD CONSTRAINT "fin_branch_refs_branch_fk" FOREIGN KEY ("company_id","branch_id") REFERENCES "fin"."branches"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "fin"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."companies" ADD CONSTRAINT "companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "fin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."company_tax_registrations" ADD CONSTRAINT "company_tax_registrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "fin"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."parties" ADD CONSTRAINT "parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "fin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."parties" ADD CONSTRAINT "fin_parties_intercompany_fk" FOREIGN KEY ("tenant_id","intercompany_company_id") REFERENCES "fin"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."parties" ADD CONSTRAINT "fin_parties_merged_into_fk" FOREIGN KEY ("tenant_id","merged_into_id") REFERENCES "fin"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."party_companies" ADD CONSTRAINT "fin_party_companies_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "fin"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."party_companies" ADD CONSTRAINT "fin_party_companies_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "fin"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."party_refs" ADD CONSTRAINT "fin_party_refs_source_fk" FOREIGN KEY ("tenant_id","source_system_id") REFERENCES "fin"."source_systems"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."party_refs" ADD CONSTRAINT "fin_party_refs_party_fk" FOREIGN KEY ("tenant_id","party_id") REFERENCES "fin"."parties"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."posting_keys" ADD CONSTRAINT "posting_keys_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "fin"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."source_grants" ADD CONSTRAINT "fin_source_grants_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "fin"."companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."source_grants" ADD CONSTRAINT "fin_source_grants_source_fk" FOREIGN KEY ("tenant_id","source_system_id") REFERENCES "fin"."source_systems"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fin"."source_systems" ADD CONSTRAINT "source_systems_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "fin"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_company_roles" ADD CONSTRAINT "user_company_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fin_audit_log_entity_idx" ON "fin"."audit_log" USING btree ("tenant_id","entity","entity_id","id");--> statement-breakpoint
CREATE INDEX "fin_party_companies_party_idx" ON "fin"."party_companies" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "fin_party_refs_party_idx" ON "fin"."party_refs" USING btree ("tenant_id","party_id");--> statement-breakpoint
CREATE INDEX "fin_source_grants_tenant_source_idx" ON "fin"."source_grants" USING btree ("tenant_id","source_system_id");--> statement-breakpoint
CREATE INDEX "user_company_roles_role_id_idx" ON "user_company_roles" USING btree ("role_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------
-- Hand-written below (ADR-0069 #4, ADR-0070, ADR-0076, ADR-0084; docs/modules/finance-core.md §4).
-- ---------------------------------------------------------------------------------------------

-- Schema `fin`: only the core writes it; `app` may use it, nobody else (ai_reader gets nothing).
REVOKE ALL ON SCHEMA fin FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA fin TO app;
--> statement-breakpoint
-- No `fin` row is ever deleted or truncated by the application: rows end by status.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA fin FROM app;
--> statement-breakpoint
-- Append-only: tax registrations are effective-dated, the audit trail is history.
REVOKE UPDATE ON fin.company_tax_registrations, fin.audit_log FROM app;
--> statement-breakpoint
-- The core's own copy of the foundation's guard, so `pg_dump -n fin` is self-contained.
CREATE FUNCTION fin.forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %.%: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';  -- 23001, distinct from 42501 raised by a REVOKE
END $$;
--> statement-breakpoint
CREATE TRIGGER company_tax_registrations_append_only BEFORE UPDATE OR DELETE ON fin.company_tax_registrations
  FOR EACH ROW EXECUTE FUNCTION fin.forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER company_tax_registrations_no_truncate BEFORE TRUNCATE ON fin.company_tax_registrations
  FOR EACH STATEMENT EXECUTE FUNCTION fin.forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON fin.audit_log
  FOR EACH ROW EXECUTE FUNCTION fin.forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON fin.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION fin.forbid_update_delete();
--> statement-breakpoint

-- fin_foundation:data:begin
-- The installation's tenant and company (owner, 2026-10-20). BO's register number and TIN are typed
-- by the owner on «Компани»: never seeded here, the repository is public. The api's boot step
-- (fin-bridge, ensureDefaultCompany) repeats this for empty databases and adds the posting keys and
-- the branches; nothing here overwrites a row that exists.
INSERT INTO fin.tenants (code, name) VALUES ('BUTEN_ORGIL', 'Бүтэн-Оргил групп');
--> statement-breakpoint
INSERT INTO fin.companies (tenant_id, code, legal_name)
  SELECT id, 'BO', 'Бүтэн-Оргил ХХК' FROM fin.tenants WHERE code = 'BUTEN_ORGIL';
--> statement-breakpoint
INSERT INTO fin.source_systems (tenant_id, code)
  SELECT t.id, s.code FROM fin.tenants t CROSS JOIN (VALUES ('BTO'), ('FIN')) AS s (code)
   WHERE t.code = 'BUTEN_ORGIL';
--> statement-breakpoint
INSERT INTO fin.source_grants (tenant_id, company_id, source_system_id)
  SELECT c.tenant_id, c.id, s.id
    FROM fin.companies c JOIN fin.source_systems s ON s.tenant_id = c.tenant_id
   WHERE c.code = 'BO';
--> statement-breakpoint
-- Tax registrations from today's settings (ADR-0070 #3); the rates follow with the tax codes in P3.
INSERT INTO fin.company_tax_registrations (company_id, tax_kind, effective_from, registered)
  SELECT c.id,
         CASE s.key WHEN 'company.vat_payer' THEN 'VAT' ELSE 'CITY_TAX' END,
         s.effective_from,
         s.value = 'true'::jsonb
    FROM public.settings s CROSS JOIN fin.companies c
   WHERE c.code = 'BO' AND s.key IN ('company.vat_payer', 'company.city_tax_payer');
--> statement-breakpoint
-- The party that takes control-account lines without a known counterparty when P2 moves the journal.
WITH t AS (SELECT id FROM fin.tenants WHERE code = 'BUTEN_ORGIL'),
     p AS (INSERT INTO fin.parties (tenant_id, kind, name)
             SELECT id, 'OTHER', 'LEGACY_UNASSIGNED' FROM t RETURNING id, tenant_id),
     r AS (INSERT INTO fin.party_refs (tenant_id, source_system_id, external_id, party_id)
             SELECT p.tenant_id, s.id, 'LEGACY_UNASSIGNED', p.id
               FROM p JOIN fin.source_systems s ON s.tenant_id = p.tenant_id AND s.code = 'FIN')
INSERT INTO fin.party_companies (company_id, party_id, tenant_id)
  SELECT c.id, p.id, p.tenant_id FROM p JOIN fin.companies c ON c.tenant_id = p.tenant_id AND c.code = 'BO';
--> statement-breakpoint
-- One party per Bto customer (a store is a customer; never matched by TIN, ADR-0032), its ref
-- `customer:<id>` and its place in BO. One statement: the ids are drawn once in `src`.
WITH t AS (SELECT id FROM fin.tenants WHERE code = 'BUTEN_ORGIL'),
     src AS MATERIALIZED (
       SELECT cu.id AS customer_id, cu.kind, cu.name, cu.tin, cu.reg_no,
              nextval(pg_get_serial_sequence('fin.parties', 'id')) AS party_id
         FROM public.customers cu),
     p AS (INSERT INTO fin.parties (id, tenant_id, kind, name, tin, register_no)
             OVERRIDING SYSTEM VALUE
             SELECT src.party_id, t.id, src.kind, src.name, src.tin, src.reg_no FROM src, t
           RETURNING id),
     r AS (INSERT INTO fin.party_refs (tenant_id, source_system_id, external_id, party_id)
             SELECT t.id, s.id, 'customer:' || src.customer_id, src.party_id
               FROM src, t JOIN fin.source_systems s ON s.tenant_id = t.id AND s.code = 'BTO')
INSERT INTO fin.party_companies (company_id, party_id, tenant_id)
  SELECT c.id, src.party_id, c.tenant_id FROM src, fin.companies c WHERE c.code = 'BO';
--> statement-breakpoint
-- Every user keeps today's rights inside BO (ADR-0075 #8; the mirror of ADR-0084).
INSERT INTO public.user_company_roles (user_id, company_code, role_id)
  SELECT user_id, 'BO', role_id FROM public.user_roles;
--> statement-breakpoint
DO $$
BEGIN
  IF (SELECT count(*) FROM fin.party_refs WHERE external_id LIKE 'customer:%')
       <> (SELECT count(*) FROM public.customers)
  OR (SELECT count(*) FROM fin.party_companies) <> (SELECT count(*) FROM fin.parties)
  OR (SELECT count(*) FROM public.user_company_roles) <> (SELECT count(*) FROM public.user_roles)
  OR (SELECT count(*) FROM fin.company_tax_registrations)
       <> (SELECT count(*) FROM public.settings WHERE key IN ('company.vat_payer', 'company.city_tax_payer'))
  THEN
    RAISE EXCEPTION 'fin_foundation: the backfill does not match its sources';
  END IF;
END $$;
-- fin_foundation:data:end
