import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { jsonValue, money } from '../common/db/types';

/**
 * The Finance Core's tables (ADR-0069 #4, ADR-0070, ADR-0076; docs/modules/finance-core.md §4): the
 * PostgreSQL schema `fin`, P1's organisation. Scope rules: every row carries `company_id` or
 * `tenant_id`; a company-owned table with an `id` is `UNIQUE (company_id, id)`; foreign keys between
 * company-owned tables include `company_id`; tenant-level rows (parties, source systems) are reached
 * from a company only through the bridge rows `party_companies` / `source_grants` with composite keys;
 * every unique index leads with the scope; no foreign key leaves `fin` (Bto keeps plain ids). The
 * TypeScript names carry a `fin` prefix so they never collide with Bto's in the aggregated schema.
 * `test/integrity/fin-isolation.spec.ts` checks all of it in the catalog.
 *
 * Migration 0032_fin_foundation adds by hand what drizzle-kit cannot express: the schema grants, the
 * append-only triggers, the seed and the backfill from Bto's customers.
 */
export const finSchema = pgSchema('fin');

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const FIN_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const status = () => text('status', { enum: FIN_STATUSES }).notNull().default('ACTIVE');

/** A tenant, company, source, branch or key code: the contract's CODE_PATTERN (`@tugeel/fin-contract`). */
const codeShape = (column: AnyPgColumn): SQL =>
  sql`${column} ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'`;
/** A display name: 1–200 characters after trimming. */
const nameShape = (column: AnyPgColumn): SQL => sql`length(btrim(${column})) BETWEEN 1 AND 200`;
/** An optional identifier typed by a person or sent by a source: ≤ 32 characters, no control characters. */
const idShape = (column: AnyPgColumn): SQL =>
  sql`${column} IS NULL OR (length(${column}) BETWEEN 1 AND 32 AND ${column} !~ '[[:cntrl:]]')`;
const statusShape = (column: AnyPgColumn): SQL => sql`${column} IN ('ACTIVE', 'INACTIVE')`;

/** The isolation boundary: one row, the owner's group (ADR-0070 #1). */
export const finTenants = finSchema.table(
  'tenants',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_tenants_code_key').on(t.code),
    check('fin_tenants_code', codeShape(t.code)),
    check('fin_tenants_name', nameShape(t.name)),
    check('fin_tenants_status', statusShape(t.status)),
  ],
);

/** A legal entity with its own books (ADR-0070 #2): BO now, RES when the PMS starts. */
export const finCompanies = finSchema.table(
  'companies',
  {
    id: id(),
    tenantId: ref('tenant_id')
      .notNull()
      .references(() => finTenants.id),
    code: text('code').notNull(),
    legalName: text('legal_name').notNull(),
    /** The state register number; typed by the owner, never seeded (the repository is public). */
    registerNo: text('register_no'),
    tin: text('tin'),
    functionalCurrency: char('functional_currency', { length: 3 }).notNull().default('MNT'),
    timezone: text('timezone').notNull().default('Asia/Ulaanbaatar'),
    /** TODO-VERIFY (accountant): January unless told otherwise. */
    fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(1),
    /** The later group control system may read this company (ADR-0076). */
    controlApproved: boolean('control_approved').notNull().default(false),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_companies_tenant_code_key').on(t.tenantId, t.code),
    unique('fin_companies_tenant_id_key').on(t.tenantId, t.id),
    check('fin_companies_code', codeShape(t.code)),
    check('fin_companies_legal_name', nameShape(t.legalName)),
    check('fin_companies_register_no', idShape(t.registerNo)),
    check('fin_companies_tin', idShape(t.tin)),
    check('fin_companies_currency', sql`${t.functionalCurrency} ~ '^[A-Z]{3}$'`),
    check('fin_companies_timezone', sql`length(${t.timezone}) BETWEEN 1 AND 64`),
    check('fin_companies_fiscal_month', sql`${t.fiscalYearStartMonth} BETWEEN 1 AND 12`),
    check('fin_companies_status', statusShape(t.status)),
  ],
);

/**
 * A company's registration for a tax kind from a date (ADR-0070 #3): effective-dated and never
 * updated (append-only by trigger). Rates come with the tax codes in P3.
 */
export const finCompanyTaxRegistrations = finSchema.table(
  'company_tax_registrations',
  {
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    /** A tax kind of `@tugeel/shared/mn` (`VAT`, `CITY_TAX`). */
    taxKind: text('tax_kind').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    registered: boolean('registered').notNull(),
    activityCode: text('activity_code'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'fin_company_tax_registrations_pkey',
      columns: [t.companyId, t.taxKind, t.effectiveFrom],
    }),
    check('fin_company_tax_registrations_kind', sql`${t.taxKind} ~ '^[A-Z][A-Z_]{0,31}$'`),
    check('fin_company_tax_registrations_activity', idShape(t.activityCode)),
  ],
);

/** A company's branch: a dimension on every journal line (ADR-0070 #4). */
export const finBranches = finSchema.table(
  'branches',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_branches_company_id_key').on(t.companyId, t.id),
    unique('fin_branches_company_code_key').on(t.companyId, t.code),
    check('fin_branches_code', codeShape(t.code)),
    check('fin_branches_name', nameShape(t.name)),
    check('fin_branches_status', statusShape(t.status)),
  ],
);

/** A system that posts into the core: BTO, FIN (the core's own screens), later PMS and HR. */
export const finSourceSystems = finSchema.table(
  'source_systems',
  {
    id: id(),
    tenantId: ref('tenant_id')
      .notNull()
      .references(() => finTenants.id),
    code: text('code').notNull(),
    /** The URL of a source document in the source's screens (drill-down; set in P4). */
    linkTemplate: text('link_template'),
    status: status(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('fin_source_systems_tenant_code_key').on(t.tenantId, t.code),
    unique('fin_source_systems_tenant_id_key').on(t.tenantId, t.id),
    check('fin_source_systems_code', codeShape(t.code)),
    check(
      'fin_source_systems_link',
      sql`${t.linkTemplate} IS NULL OR length(${t.linkTemplate}) <= 512`,
    ),
    check('fin_source_systems_status', statusShape(t.status)),
  ],
);

/** A source system may post into a company only through an ACTIVE grant (ADR-0071). */
export const finSourceGrants = finSchema.table(
  'source_grants',
  {
    tenantId: ref('tenant_id').notNull(),
    companyId: ref('company_id').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    status: status(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'fin_source_grants_pkey', columns: [t.companyId, t.sourceSystemId] }),
    foreignKey({
      name: 'fin_source_grants_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [finCompanies.tenantId, finCompanies.id],
    }),
    foreignKey({
      name: 'fin_source_grants_source_fk',
      columns: [t.tenantId, t.sourceSystemId],
      foreignColumns: [finSourceSystems.tenantId, finSourceSystems.id],
    }),
    index('fin_source_grants_tenant_source_idx').on(t.tenantId, t.sourceSystemId),
    check('fin_source_grants_status', statusShape(t.status)),
  ],
);

/** A source's own id of a branch → the core's branch (Bto: `identity.branches.id`, codes are editable). */
export const finBranchRefs = finSchema.table(
  'branch_refs',
  {
    companyId: ref('company_id').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    externalId: text('external_id').notNull(),
    branchId: ref('branch_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({
      name: 'fin_branch_refs_pkey',
      columns: [t.companyId, t.sourceSystemId, t.externalId],
    }),
    foreignKey({
      name: 'fin_branch_refs_grant_fk',
      columns: [t.companyId, t.sourceSystemId],
      foreignColumns: [finSourceGrants.companyId, finSourceGrants.sourceSystemId],
    }),
    foreignKey({
      name: 'fin_branch_refs_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [finBranches.companyId, finBranches.id],
    }),
    unique('fin_branch_refs_branch_key').on(t.companyId, t.sourceSystemId, t.branchId),
    check('fin_branch_refs_external_id', sql`length(${t.externalId}) BETWEEN 1 AND 128`),
  ],
);

export const FIN_ACCOUNT_CONTROLS = [
  'NONE',
  'RECEIVABLE',
  'PAYABLE',
  'ADVANCE_RECEIVED',
  'ADVANCE_PAID',
  'MONEY',
] as const;

/** A company's posting keys (ADR-0072): what a line means; rules turn keys into accounts (F1's ledger). */
export const finPostingKeys = finSchema.table(
  'posting_keys',
  {
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    code: text('code').notNull(),
    requiredControl: text('required_control', { enum: FIN_ACCOUNT_CONTROLS }).notNull(),
    requiresTaxCode: boolean('requires_tax_code').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'fin_posting_keys_pkey', columns: [t.companyId, t.code] }),
    check('fin_posting_keys_code', codeShape(t.code)),
    check(
      'fin_posting_keys_control',
      sql`${t.requiredControl} IN ('NONE', 'RECEIVABLE', 'PAYABLE', 'ADVANCE_RECEIVED', 'ADVANCE_PAID', 'MONEY')`,
    ),
  ],
);

export const FIN_PARTY_KINDS = [
  'COMPANY',
  'INDIVIDUAL',
  'INTERNAL',
  'TAX_AUTHORITY',
  'EMPLOYEE',
  'OTHER',
] as const;

/**
 * The financial identity of a counterparty, per tenant (ADR-0070 #8). Sources reach it through
 * `party_refs`; a company through `party_companies`. Never matched by TIN (stores share TINs).
 */
export const finParties = finSchema.table(
  'parties',
  {
    id: id(),
    tenantId: ref('tenant_id')
      .notNull()
      .references(() => finTenants.id),
    kind: text('kind', { enum: FIN_PARTY_KINDS }).notNull(),
    name: text('name').notNull(),
    tin: text('tin'),
    registerNo: text('register_no'),
    /** The other company of the group for an INTERNAL party (intercompany, ADR-0070 #9). */
    intercompanyCompanyId: ref('intercompany_company_id'),
    mergedIntoId: ref('merged_into_id'),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_parties_tenant_id_key').on(t.tenantId, t.id),
    foreignKey({
      name: 'fin_parties_intercompany_fk',
      columns: [t.tenantId, t.intercompanyCompanyId],
      foreignColumns: [finCompanies.tenantId, finCompanies.id],
    }),
    foreignKey({
      name: 'fin_parties_merged_into_fk',
      columns: [t.tenantId, t.mergedIntoId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check(
      'fin_parties_kind',
      sql`${t.kind} IN ('COMPANY', 'INDIVIDUAL', 'INTERNAL', 'TAX_AUTHORITY', 'EMPLOYEE', 'OTHER')`,
    ),
    check(
      'fin_parties_internal',
      sql`(${t.kind} = 'INTERNAL') = (${t.intercompanyCompanyId} IS NOT NULL)`,
    ),
    check('fin_parties_name', nameShape(t.name)),
    check('fin_parties_tin', idShape(t.tin)),
    check('fin_parties_register_no', idShape(t.registerNo)),
    check('fin_parties_status', statusShape(t.status)),
  ],
);

/** A source's own reference of a party (Bto: `customer:<id>`, `supplier:<id>`). */
export const finPartyRefs = finSchema.table(
  'party_refs',
  {
    tenantId: ref('tenant_id').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    externalId: text('external_id').notNull(),
    partyId: ref('party_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      name: 'fin_party_refs_pkey',
      columns: [t.tenantId, t.sourceSystemId, t.externalId],
    }),
    foreignKey({
      name: 'fin_party_refs_source_fk',
      columns: [t.tenantId, t.sourceSystemId],
      foreignColumns: [finSourceSystems.tenantId, finSourceSystems.id],
    }),
    foreignKey({
      name: 'fin_party_refs_party_fk',
      columns: [t.tenantId, t.partyId],
      foreignColumns: [finParties.tenantId, finParties.id],
    }),
    index('fin_party_refs_party_idx').on(t.tenantId, t.partyId),
    check('fin_party_refs_external_id', sql`length(${t.externalId}) BETWEEN 1 AND 128`),
  ],
);

/** A party known to a company: the lock row of every balance-changing write (ADR-0072). */
export const finPartyCompanies = finSchema.table(
  'party_companies',
  {
    companyId: ref('company_id').notNull(),
    partyId: ref('party_id').notNull(),
    tenantId: ref('tenant_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'fin_party_companies_pkey', columns: [t.companyId, t.partyId] }),
    foreignKey({
      name: 'fin_party_companies_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [finCompanies.tenantId, finCompanies.id],
    }),
    foreignKey({
      name: 'fin_party_companies_party_fk',
      columns: [t.tenantId, t.partyId],
      foreignColumns: [finParties.tenantId, finParties.id],
    }),
    index('fin_party_companies_party_idx').on(t.tenantId, t.partyId),
  ],
);

export const FIN_ACTOR_KINDS = ['STAFF', 'SOURCE', 'SYSTEM'] as const;

/** The core's own audit trail (append-only by trigger); the actor is given by value, never a Bto id. */
export const finAuditLog = finSchema.table(
  'audit_log',
  {
    id: id(),
    tenantId: ref('tenant_id')
      .notNull()
      .references(() => finTenants.id),
    companyId: ref('company_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorKind: text('actor_kind', { enum: FIN_ACTOR_KINDS }).notNull(),
    actorRef: text('actor_ref').notNull(),
    actorLabel: text('actor_label').notNull(),
    /** `SOURCE:<system>` or `USER:<ref>`, or `SYSTEM` for a boot step. */
    principal: text('principal').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonValue('before'),
    after: jsonValue('after'),
    requestId: text('request_id'),
  },
  (t) => [
    foreignKey({
      name: 'fin_audit_log_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [finCompanies.tenantId, finCompanies.id],
    }),
    index('fin_audit_log_entity_idx').on(t.tenantId, t.entity, t.entityId, t.id),
    check('fin_audit_log_actor_kind', sql`${t.actorKind} IN ('STAFF', 'SOURCE', 'SYSTEM')`),
    check('fin_audit_log_action', sql`${t.action} ~ '^[A-Z][A-Z_]{0,31}$'`),
  ],
);

// ---------------------------------------------------------------------------------------------------
// The ledger (F1, ADR-0089; docs/modules/finance-core.md §4): the chart, money accounts, posting
// rules, periods and the journal. Migration 0033_fin_ledger adds by hand: the REVOKEs, the
// append-only triggers, the deferred balance trigger, and the copy of Bto's chart and money accounts.
// ---------------------------------------------------------------------------------------------------

export const FIN_ACCOUNT_KINDS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export const FIN_SIDES = ['DEBIT', 'CREDIT'] as const;
export const FIN_MONEY_ACCOUNT_KINDS = ['CASH', 'BANK', 'CLEARING'] as const;
export const FIN_PERIOD_STATUSES = ['OPEN', 'CLOSED'] as const;

/**
 * A company's account (ADR-0072): its kind and normal side, and the control that says what every
 * line on it must carry once the intake enforces it (F2). Never deleted: deactivated.
 */
export const finAccounts = finSchema.table(
  'accounts',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: FIN_ACCOUNT_KINDS }).notNull(),
    normalSide: text('normal_side', { enum: FIN_SIDES }).notNull(),
    control: text('control', { enum: FIN_ACCOUNT_CONTROLS }).notNull().default('NONE'),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_accounts_company_id_key').on(t.companyId, t.id),
    unique('fin_accounts_company_code_key').on(t.companyId, t.code),
    check('fin_accounts_code', codeShape(t.code)),
    check('fin_accounts_name', nameShape(t.name)),
    check(
      'fin_accounts_kind',
      sql`${t.kind} IN ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE')`,
    ),
    check('fin_accounts_normal_side', sql`${t.normalSide} IN ('DEBIT', 'CREDIT')`),
    check(
      'fin_accounts_control',
      sql`${t.control} IN ('NONE', 'RECEIVABLE', 'PAYABLE', 'ADVANCE_RECEIVED', 'ADVANCE_PAID', 'MONEY')`,
    ),
    check('fin_accounts_status', statusShape(t.status)),
  ],
);

/** A cash box, a bank account or a clearing account, on a branch, booked to an account (ADR-0072). */
export const finMoneyAccounts = finSchema.table(
  'money_accounts',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: FIN_MONEY_ACCOUNT_KINDS }).notNull(),
    branchId: ref('branch_id'),
    accountId: ref('account_id').notNull(),
    bankName: text('bank_name'),
    bankAccountNo: text('bank_account_no'),
    /** Listed to the company's customers to pay into (Bto's «Харилцагчид харуулах», ADR-0079 #7). */
    showToCustomers: boolean('show_to_customers').notNull().default(false),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_money_accounts_company_id_key').on(t.companyId, t.id),
    unique('fin_money_accounts_company_code_key').on(t.companyId, t.code),
    foreignKey({
      name: 'fin_money_accounts_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [finAccounts.companyId, finAccounts.id],
    }),
    foreignKey({
      name: 'fin_money_accounts_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [finBranches.companyId, finBranches.id],
    }),
    check('fin_money_accounts_code', codeShape(t.code)),
    check('fin_money_accounts_name', nameShape(t.name)),
    check('fin_money_accounts_kind', sql`${t.kind} IN ('CASH', 'BANK', 'CLEARING')`),
    check('fin_money_accounts_shown', sql`NOT ${t.showToCustomers} OR ${t.kind} = 'BANK'`),
    check(
      'fin_money_accounts_bank',
      sql`(${t.bankName} IS NULL OR length(${t.bankName}) BETWEEN 1 AND 120) AND (${t.bankAccountNo} IS NULL OR length(${t.bankAccountNo}) BETWEEN 1 AND 40)`,
    ),
    check('fin_money_accounts_status', statusShape(t.status)),
  ],
);

/**
 * Where a posting key lands (ADR-0072 #2): append-only, the newest row effective on the accounting
 * date wins; a NULL account says "no account from this date" (a missing mapping rejects). F1 has
 * the company defaults only; document type, branch and source selectors are later columns.
 */
export const finPostingRules = finSchema.table(
  'posting_rules',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    postingKey: text('posting_key').notNull(),
    accountId: ref('account_id'),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('fin_posting_rules_company_id_key').on(t.companyId, t.id),
    foreignKey({
      name: 'fin_posting_rules_key_fk',
      columns: [t.companyId, t.postingKey],
      foreignColumns: [finPostingKeys.companyId, finPostingKeys.code],
    }),
    foreignKey({
      name: 'fin_posting_rules_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [finAccounts.companyId, finAccounts.id],
    }),
    index('fin_posting_rules_key_idx').on(t.companyId, t.postingKey, t.effectiveFrom, t.id),
  ],
);

/** A month of a company's books (ADR-0075, F1: OPEN / CLOSED only; closing comes in F5). */
export const finFiscalPeriods = finSchema.table(
  'fiscal_periods',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    /** `YYYY-MM`. */
    code: text('code').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    endsOn: date('ends_on', { mode: 'string' }).notNull(),
    status: text('status', { enum: FIN_PERIOD_STATUSES }).notNull().default('OPEN'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_fiscal_periods_company_id_key').on(t.companyId, t.id),
    unique('fin_fiscal_periods_company_code_key').on(t.companyId, t.code),
    check('fin_fiscal_periods_code', sql`${t.code} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('fin_fiscal_periods_dates', sql`${t.endsOn} >= ${t.startsOn}`),
    check('fin_fiscal_periods_status', sql`${t.status} IN ('OPEN', 'CLOSED')`),
  ],
);

/**
 * A journal entry (ADR-0072): numbered, dated in an open month, from a source document (its source
 * key) or typed on the core's screens (source FIN); never changed, reversed once by an entry that
 * names it. The deferred trigger of 0033 keeps it balanced at commit.
 */
export const finJournalEntries = finSchema.table(
  'journal_entries',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    number: text('number').notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    periodId: ref('period_id').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    sourceDocType: text('source_doc_type'),
    sourceDocId: text('source_doc_id'),
    reversesId: ref('reverses_id'),
    /** The intake document it books (F2); null for the POS entries of the façade until H2. */
    documentId: ref('document_id'),
    description: text('description').notNull(),
    actorKind: text('actor_kind', { enum: FIN_ACTOR_KINDS }).notNull(),
    actorRef: text('actor_ref').notNull(),
    actorLabel: text('actor_label').notNull(),
    requestId: text('request_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fin_journal_entries_company_id_key').on(t.companyId, t.id),
    unique('fin_journal_entries_company_number_key').on(t.companyId, t.number),
    unique('fin_journal_entries_company_reverses_key').on(t.companyId, t.reversesId),
    unique('fin_journal_entries_company_document_key').on(t.companyId, t.documentId),
    foreignKey({
      name: 'fin_journal_entries_document_fk',
      columns: [t.companyId, t.documentId],
      foreignColumns: [finDocuments.companyId, finDocuments.id],
    }),
    foreignKey({
      name: 'fin_journal_entries_period_fk',
      columns: [t.companyId, t.periodId],
      foreignColumns: [finFiscalPeriods.companyId, finFiscalPeriods.id],
    }),
    foreignKey({
      name: 'fin_journal_entries_source_fk',
      columns: [t.companyId, t.sourceSystemId],
      foreignColumns: [finSourceGrants.companyId, finSourceGrants.sourceSystemId],
    }),
    foreignKey({
      name: 'fin_journal_entries_reverses_fk',
      columns: [t.companyId, t.reversesId],
      foreignColumns: [t.companyId, t.id],
    }),
    index('fin_journal_entries_date_idx').on(t.companyId, t.entryDate, t.id),
    index('fin_journal_entries_source_doc_idx').on(
      t.companyId,
      t.sourceSystemId,
      t.sourceDocType,
      t.sourceDocId,
    ),
    check('fin_journal_entries_number', sql`length(${t.number}) BETWEEN 1 AND 64`),
    check(
      'fin_journal_entries_source_doc',
      sql`(${t.sourceDocType} IS NULL) = (${t.sourceDocId} IS NULL) AND (${t.sourceDocType} IS NULL OR (${codeShape(t.sourceDocType)} AND length(${t.sourceDocId}) BETWEEN 1 AND 128))`,
    ),
    check(
      'fin_journal_entries_description',
      sql`length(btrim(${t.description})) BETWEEN 1 AND 500`,
    ),
    check('fin_journal_entries_actor_kind', sql`${t.actorKind} IN ('STAFF', 'SOURCE', 'SYSTEM')`),
  ],
);

/** One side of an entry (ADR-0072): its account, and the key and rule that chose it. */
export const finJournalLines = finSchema.table(
  'journal_lines',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    entryId: ref('entry_id').notNull(),
    lineNo: smallint('line_no').notNull(),
    accountId: ref('account_id').notNull(),
    debit: money('debit')
      .notNull()
      .default(sql`0`),
    credit: money('credit')
      .notNull()
      .default(sql`0`),
    partyId: ref('party_id'),
    moneyAccountId: ref('money_account_id'),
    branchId: ref('branch_id'),
    postingKey: text('posting_key'),
    postingRuleId: ref('posting_rule_id'),
    /** A tax line's code (`MN.VAT.STD`) and its base, as the sender gave them (F2). */
    taxCode: text('tax_code'),
    taxBase: money('tax_base'),
    description: text('description'),
  },
  (t) => [
    unique('fin_journal_lines_company_id_key').on(t.companyId, t.id),
    /** The target of an open item's key: the item is on this line's party and account. */
    unique('fin_journal_lines_item_key').on(t.companyId, t.id, t.partyId, t.accountId),
    unique('fin_journal_lines_entry_line_key').on(t.companyId, t.entryId, t.lineNo),
    foreignKey({
      name: 'fin_journal_lines_entry_fk',
      columns: [t.companyId, t.entryId],
      foreignColumns: [finJournalEntries.companyId, finJournalEntries.id],
    }),
    foreignKey({
      name: 'fin_journal_lines_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [finAccounts.companyId, finAccounts.id],
    }),
    foreignKey({
      name: 'fin_journal_lines_party_fk',
      columns: [t.companyId, t.partyId],
      foreignColumns: [finPartyCompanies.companyId, finPartyCompanies.partyId],
    }),
    foreignKey({
      name: 'fin_journal_lines_money_account_fk',
      columns: [t.companyId, t.moneyAccountId],
      foreignColumns: [finMoneyAccounts.companyId, finMoneyAccounts.id],
    }),
    foreignKey({
      name: 'fin_journal_lines_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [finBranches.companyId, finBranches.id],
    }),
    foreignKey({
      name: 'fin_journal_lines_key_fk',
      columns: [t.companyId, t.postingKey],
      foreignColumns: [finPostingKeys.companyId, finPostingKeys.code],
    }),
    foreignKey({
      name: 'fin_journal_lines_rule_fk',
      columns: [t.companyId, t.postingRuleId],
      foreignColumns: [finPostingRules.companyId, finPostingRules.id],
    }),
    index('fin_journal_lines_account_idx').on(t.companyId, t.accountId, t.id),
    index('fin_journal_lines_party_idx').on(t.companyId, t.partyId, t.id),
    check(
      'fin_journal_lines_amounts',
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0) AND (${t.debit} <> 0 OR ${t.credit} <> 0)`,
    ),
    check(
      'fin_journal_lines_description',
      sql`${t.description} IS NULL OR length(btrim(${t.description})) BETWEEN 1 AND 500`,
    ),
    check(
      'fin_journal_lines_tax',
      sql`(${t.taxCode} IS NULL) = (${t.taxBase} IS NULL) AND (${t.taxCode} IS NULL OR ${codeShape(t.taxCode)})`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------------
// The intake and the sub-ledger (F2, ADR-0090; docs/modules/finance-core.md §4, §6): document types and
// number series, the intake log, documents, open items, allocations, party balances and reconcile
// runs. Migration 0034_fin_intake adds by hand: the REVOKEs, the append-only triggers, the column
// grant on `open_items.open_amount`, the one-item-per-control-line trigger and Bto's data.
// ---------------------------------------------------------------------------------------------------

export const FIN_DOCUMENT_CLASSES = [
  'AR_INVOICE',
  'AR_CREDIT',
  'RECEIPT',
  'PAYMENT',
  'ALLOCATION',
  'SETTLEMENT',
  'JOURNAL',
  'OPENING',
  'AP_BILL',
  'AP_CREDIT',
] as const;
export const FIN_NUMBER_MODES = ['SOURCE', 'CORE'] as const;
export const FIN_INTAKE_ACTIONS = ['POST', 'REVERSE'] as const;
export const FIN_INTAKE_STATUSES = ['POSTED', 'HELD', 'REJECTED', 'CANCELLED'] as const;
export const FIN_INTAKE_VIAS = ['INPROC', 'JOB', 'HTTP', 'UI', 'MIGRATION'] as const;
export const FIN_RECONCILE_KINDS = ['CACHE', 'ITEMS', 'SUBLEDGER_GL'] as const;

/** A company's number series (ADR-0090): a pattern with `{year}{month}{day}` and the counter's digits. */
export const finNumberSeries = finSchema.table(
  'number_series',
  {
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    code: text('code').notNull(),
    pattern: text('pattern').notNull(),
    digits: smallint('digits').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'fin_number_series_pkey', columns: [t.companyId, t.code] }),
    check('fin_number_series_code', codeShape(t.code)),
    check(
      'fin_number_series_pattern',
      sql`length(${t.pattern}) BETWEEN 1 AND 24 AND ${t.pattern} !~ '[0-9}]$'`,
    ),
    check('fin_number_series_digits', sql`${t.digits} BETWEEN 1 AND 8`),
  ],
);

/** The gap-free counters of a series: one row per rendered prefix (the day), taken last. */
export const finNumberCounters = finSchema.table(
  'number_counters',
  {
    companyId: ref('company_id').notNull(),
    scope: text('scope').notNull(),
    period: text('period').notNull(),
    value: bigint('value', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ name: 'fin_number_counters_pkey', columns: [t.companyId, t.scope, t.period] }),
    foreignKey({
      name: 'fin_number_counters_series_fk',
      columns: [t.companyId, t.scope],
      foreignColumns: [finNumberSeries.companyId, finNumberSeries.code],
    }),
    check('fin_number_counters_value', sql`${t.value} >= 1`),
  ],
);

/**
 * A kind of document a source system sends (ADR-0072 #1): its class, who numbers it (the sender, or
 * the core from a series), and where an unapplied remainder goes (NULL: stays an open item, D6).
 */
export const finDocumentTypes = finSchema.table(
  'document_types',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    code: text('code').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    class: text('class', { enum: FIN_DOCUMENT_CLASSES }).notNull(),
    numberMode: text('number_mode', { enum: FIN_NUMBER_MODES }).notNull(),
    numberSeries: text('number_series'),
    unappliedKey: text('unapplied_key'),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('fin_document_types_company_id_key').on(t.companyId, t.id),
    unique('fin_document_types_company_code_key').on(t.companyId, t.code),
    foreignKey({
      name: 'fin_document_types_source_fk',
      columns: [t.companyId, t.sourceSystemId],
      foreignColumns: [finSourceGrants.companyId, finSourceGrants.sourceSystemId],
    }),
    foreignKey({
      name: 'fin_document_types_series_fk',
      columns: [t.companyId, t.numberSeries],
      foreignColumns: [finNumberSeries.companyId, finNumberSeries.code],
    }),
    foreignKey({
      name: 'fin_document_types_unapplied_fk',
      columns: [t.companyId, t.unappliedKey],
      foreignColumns: [finPostingKeys.companyId, finPostingKeys.code],
    }),
    check('fin_document_types_code', codeShape(t.code)),
    check(
      'fin_document_types_class',
      sql`${t.class} IN ('AR_INVOICE', 'AR_CREDIT', 'RECEIPT', 'PAYMENT', 'ALLOCATION', 'SETTLEMENT', 'JOURNAL', 'OPENING', 'AP_BILL', 'AP_CREDIT')`,
    ),
    check(
      'fin_document_types_number',
      sql`${t.numberMode} IN ('SOURCE', 'CORE') AND (${t.numberMode} = 'SOURCE' OR ${t.numberSeries} IS NOT NULL)`,
    ),
    check('fin_document_types_status', statusShape(t.status)),
  ],
);

/**
 * The intake log (ADR-0071 #2, #5): one row per business key — the source's document, its revision
 * and the action. The company is in the hashed payload, so the same key for another company is a
 * conflict, never a second booking.
 */
export const finIntakeRequests = finSchema.table(
  'intake_requests',
  {
    id: id(),
    tenantId: ref('tenant_id').notNull(),
    companyId: ref('company_id').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    sourceDocType: text('source_doc_type').notNull(),
    sourceDocId: text('source_doc_id').notNull(),
    revision: integer('revision').notNull(),
    action: text('action', { enum: FIN_INTAKE_ACTIONS }).notNull(),
    sourceDocNo: text('source_doc_no'),
    contract: text('contract').notNull(),
    lastCommandId: text('last_command_id').notNull(),
    payload: jsonValue('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status', { enum: FIN_INTAKE_STATUSES }).notNull(),
    errorCode: text('error_code'),
    errorParams: jsonValue('error_params'),
    attempts: integer('attempts').notNull().default(1),
    via: text('via', { enum: FIN_INTAKE_VIAS }).notNull(),
    documentId: ref('document_id'),
    result: jsonValue('result'),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fin_intake_requests_key').on(
      t.tenantId,
      t.sourceSystemId,
      t.sourceDocType,
      t.sourceDocId,
      t.revision,
      t.action,
    ),
    unique('fin_intake_requests_company_id_key').on(t.companyId, t.id),
    foreignKey({
      name: 'fin_intake_requests_company_fk',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [finCompanies.tenantId, finCompanies.id],
    }),
    foreignKey({
      name: 'fin_intake_requests_source_fk',
      columns: [t.companyId, t.sourceSystemId],
      foreignColumns: [finSourceGrants.companyId, finSourceGrants.sourceSystemId],
    }),
    index('fin_intake_requests_status_idx').on(t.companyId, t.status, t.id),
    check('fin_intake_requests_doc_type', codeShape(t.sourceDocType)),
    check('fin_intake_requests_doc_id', sql`length(${t.sourceDocId}) BETWEEN 1 AND 128`),
    check('fin_intake_requests_revision', sql`${t.revision} BETWEEN 1 AND 1000000`),
    check('fin_intake_requests_action', sql`${t.action} IN ('POST', 'REVERSE')`),
    check(
      'fin_intake_requests_status',
      sql`${t.status} IN ('POSTED', 'HELD', 'REJECTED', 'CANCELLED') AND (${t.status} <> 'POSTED' OR ${t.documentId} IS NOT NULL OR ${t.action} = 'REVERSE')`,
    ),
    check('fin_intake_requests_via', sql`${t.via} IN ('INPROC', 'JOB', 'HTTP', 'UI', 'MIGRATION')`),
    check('fin_intake_requests_attempts', sql`${t.attempts} >= 1`),
  ],
);

/** Every try at the intake, kept (append-only); a refusal before the company is known has none. */
export const finIntakeAttempts = finSchema.table(
  'intake_attempts',
  {
    id: id(),
    tenantId: ref('tenant_id')
      .notNull()
      .references(() => finTenants.id),
    sourceSystemId: ref('source_system_id'),
    companyId: ref('company_id'),
    requestId: ref('request_id'),
    commandId: text('command_id').notNull(),
    payloadHash: text('payload_hash'),
    outcome: text('outcome').notNull(),
    errorCode: text('error_code'),
    transport: text('transport', { enum: FIN_INTAKE_VIAS }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'fin_intake_attempts_request_fk',
      columns: [t.companyId, t.requestId],
      foreignColumns: [finIntakeRequests.companyId, finIntakeRequests.id],
    }),
    index('fin_intake_attempts_request_idx').on(t.companyId, t.requestId, t.id),
    check(
      'fin_intake_attempts_outcome',
      sql`${t.outcome} IN ('POSTED', 'DUPLICATE', 'CANCELLED', 'HELD', 'REJECTED', 'CONFLICT')`,
    ),
  ],
);

/**
 * A posted document (ADR-0072): what a source sent, as the core booked it. Append-only; a correction
 * is a reversal document that names it (once). An ALLOCATION has no journal entry.
 */
export const finDocuments = finSchema.table(
  'documents',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    branchId: ref('branch_id'),
    documentTypeId: ref('document_type_id').notNull(),
    class: text('class', { enum: FIN_DOCUMENT_CLASSES }).notNull(),
    number: text('number').notNull(),
    documentDate: date('document_date', { mode: 'string' }).notNull(),
    accountingDate: date('accounting_date', { mode: 'string' }).notNull(),
    periodId: ref('period_id').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    partyId: ref('party_id'),
    dueDate: date('due_date', { mode: 'string' }),
    amount: money('amount').notNull(),
    description: text('description').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    sourceDocType: text('source_doc_type').notNull(),
    sourceDocId: text('source_doc_id').notNull(),
    sourceRevision: integer('source_revision').notNull(),
    sourceDocNo: text('source_doc_no'),
    attributes: jsonValue('attributes')
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The money line's account of a RECEIPT or PAYMENT (the cash book reads it). */
    moneyAccountId: ref('money_account_id'),
    intakeRequestId: ref('intake_request_id').notNull(),
    reversesDocumentId: ref('reverses_document_id'),
    reverseReason: text('reverse_reason'),
    actorKind: text('actor_kind', { enum: FIN_ACTOR_KINDS }).notNull(),
    actorRef: text('actor_ref').notNull(),
    actorLabel: text('actor_label').notNull(),
    requestId: text('request_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fin_documents_company_id_key').on(t.companyId, t.id),
    unique('fin_documents_company_request_key').on(t.companyId, t.intakeRequestId),
    unique('fin_documents_company_reverses_key').on(t.companyId, t.reversesDocumentId),
    uniqueIndex('fin_documents_company_type_number_key')
      .on(t.companyId, t.documentTypeId, t.number, t.sourceRevision)
      .where(sql`${t.reversesDocumentId} IS NULL`),
    foreignKey({
      name: 'fin_documents_type_fk',
      columns: [t.companyId, t.documentTypeId],
      foreignColumns: [finDocumentTypes.companyId, finDocumentTypes.id],
    }),
    foreignKey({
      name: 'fin_documents_period_fk',
      columns: [t.companyId, t.periodId],
      foreignColumns: [finFiscalPeriods.companyId, finFiscalPeriods.id],
    }),
    foreignKey({
      name: 'fin_documents_party_fk',
      columns: [t.companyId, t.partyId],
      foreignColumns: [finPartyCompanies.companyId, finPartyCompanies.partyId],
    }),
    foreignKey({
      name: 'fin_documents_branch_fk',
      columns: [t.companyId, t.branchId],
      foreignColumns: [finBranches.companyId, finBranches.id],
    }),
    foreignKey({
      name: 'fin_documents_money_account_fk',
      columns: [t.companyId, t.moneyAccountId],
      foreignColumns: [finMoneyAccounts.companyId, finMoneyAccounts.id],
    }),
    foreignKey({
      name: 'fin_documents_source_fk',
      columns: [t.companyId, t.sourceSystemId],
      foreignColumns: [finSourceGrants.companyId, finSourceGrants.sourceSystemId],
    }),
    foreignKey({
      name: 'fin_documents_request_fk',
      columns: [t.companyId, t.intakeRequestId],
      foreignColumns: [finIntakeRequests.companyId, finIntakeRequests.id],
    }),
    foreignKey({
      name: 'fin_documents_reverses_fk',
      columns: [t.companyId, t.reversesDocumentId],
      foreignColumns: [t.companyId, t.id],
    }),
    index('fin_documents_source_idx').on(
      t.companyId,
      t.sourceSystemId,
      t.sourceDocType,
      t.sourceDocId,
    ),
    index('fin_documents_party_idx').on(t.companyId, t.partyId, t.id),
    index('fin_documents_date_idx').on(t.companyId, t.documentDate, t.id),
    index('fin_documents_money_idx').on(t.companyId, t.moneyAccountId, t.documentDate, t.id),
    check(
      'fin_documents_class',
      sql`${t.class} IN ('AR_INVOICE', 'AR_CREDIT', 'RECEIPT', 'PAYMENT', 'ALLOCATION', 'SETTLEMENT', 'JOURNAL', 'OPENING', 'AP_BILL', 'AP_CREDIT')`,
    ),
    check('fin_documents_number', sql`length(${t.number}) BETWEEN 1 AND 64`),
    check('fin_documents_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('fin_documents_amount', sql`${t.amount} >= 0`),
    check('fin_documents_description', sql`length(btrim(${t.description})) BETWEEN 1 AND 300`),
    check(
      'fin_documents_source_doc',
      sql`${codeShape(t.sourceDocType)} AND length(${t.sourceDocId}) BETWEEN 1 AND 128`,
    ),
    check(
      'fin_documents_reverse',
      sql`(${t.reversesDocumentId} IS NULL) = (${t.reverseReason} IS NULL) AND (${t.reverseReason} IS NULL OR length(btrim(${t.reverseReason})) BETWEEN 1 AND 500)`,
    ),
    check('fin_documents_actor_kind', sql`${t.actorKind} IN ('STAFF', 'SOURCE', 'SYSTEM')`),
  ],
);

/**
 * An open item (ADR-0072 #5): every line on a party-control account opens exactly one, on that line's
 * party and account. Only `open_amount` changes, between 0 and the amount, by allocations.
 */
export const finOpenItems = finSchema.table(
  'open_items',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    partyId: ref('party_id').notNull(),
    accountId: ref('account_id').notNull(),
    side: text('side', { enum: FIN_SIDES }).notNull(),
    documentId: ref('document_id').notNull(),
    journalLineId: ref('journal_line_id').notNull(),
    sourceSystemId: ref('source_system_id').notNull(),
    groupRef: text('group_ref'),
    itemRef: text('item_ref'),
    itemDate: date('item_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    amount: money('amount').notNull(),
    openAmount: money('open_amount').notNull(),
  },
  (t) => [
    unique('fin_open_items_company_id_key').on(t.companyId, t.id),
    /** The target of an allocation's key: the item is on this party and account. */
    unique('fin_open_items_allocation_key').on(t.companyId, t.id, t.partyId, t.accountId),
    unique('fin_open_items_line_key').on(t.companyId, t.journalLineId),
    foreignKey({
      name: 'fin_open_items_line_fk',
      columns: [t.companyId, t.journalLineId, t.partyId, t.accountId],
      foreignColumns: [
        finJournalLines.companyId,
        finJournalLines.id,
        finJournalLines.partyId,
        finJournalLines.accountId,
      ],
    }),
    foreignKey({
      name: 'fin_open_items_document_fk',
      columns: [t.companyId, t.documentId],
      foreignColumns: [finDocuments.companyId, finDocuments.id],
    }),
    foreignKey({
      name: 'fin_open_items_party_fk',
      columns: [t.companyId, t.partyId],
      foreignColumns: [finPartyCompanies.companyId, finPartyCompanies.partyId],
    }),
    index('fin_open_items_open_idx')
      .on(t.companyId, t.partyId, t.accountId, t.side, t.dueDate, t.id)
      .where(sql`${t.openAmount} > 0`),
    index('fin_open_items_document_idx').on(t.companyId, t.documentId),
    check('fin_open_items_side', sql`${t.side} IN ('DEBIT', 'CREDIT')`),
    check(
      'fin_open_items_amounts',
      sql`${t.amount} > 0 AND ${t.openAmount} >= 0 AND ${t.openAmount} <= ${t.amount}`,
    ),
    check(
      'fin_open_items_refs',
      sql`(${t.groupRef} IS NULL OR length(${t.groupRef}) BETWEEN 1 AND 128) AND (${t.itemRef} IS NULL OR length(${t.itemRef}) BETWEEN 1 AND 128)`,
    ),
  ],
);

/**
 * A debit item paired with a credit item of the same party on the same account (ADR-0072 #6):
 * append-only; undone by an allocation that names it. `mirror` marks the pairing of a reversed
 * document's item with its reversal's.
 */
export const finAllocations = finSchema.table(
  'allocations',
  {
    id: id(),
    companyId: ref('company_id').notNull(),
    partyId: ref('party_id').notNull(),
    accountId: ref('account_id').notNull(),
    debitItemId: ref('debit_item_id').notNull(),
    creditItemId: ref('credit_item_id').notNull(),
    amount: money('amount').notNull(),
    documentId: ref('document_id').notNull(),
    reversesAllocationId: ref('reverses_allocation_id'),
    mirror: boolean('mirror').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('fin_allocations_company_id_key').on(t.companyId, t.id),
    unique('fin_allocations_company_reverses_key').on(t.companyId, t.reversesAllocationId),
    foreignKey({
      name: 'fin_allocations_debit_fk',
      columns: [t.companyId, t.debitItemId, t.partyId, t.accountId],
      foreignColumns: [
        finOpenItems.companyId,
        finOpenItems.id,
        finOpenItems.partyId,
        finOpenItems.accountId,
      ],
    }),
    foreignKey({
      name: 'fin_allocations_credit_fk',
      columns: [t.companyId, t.creditItemId, t.partyId, t.accountId],
      foreignColumns: [
        finOpenItems.companyId,
        finOpenItems.id,
        finOpenItems.partyId,
        finOpenItems.accountId,
      ],
    }),
    foreignKey({
      name: 'fin_allocations_document_fk',
      columns: [t.companyId, t.documentId],
      foreignColumns: [finDocuments.companyId, finDocuments.id],
    }),
    foreignKey({
      name: 'fin_allocations_reverses_fk',
      columns: [t.companyId, t.reversesAllocationId],
      foreignColumns: [t.companyId, t.id],
    }),
    index('fin_allocations_debit_idx').on(t.companyId, t.debitItemId),
    index('fin_allocations_credit_idx').on(t.companyId, t.creditItemId),
    index('fin_allocations_document_idx').on(t.companyId, t.documentId),
    check('fin_allocations_amount', sql`${t.amount} > 0`),
    check('fin_allocations_items', sql`${t.debitItemId} <> ${t.creditItemId}`),
  ],
);

/** The open amounts per party and account (ADR-0072 #8), rewritten under the party lock. */
export const finPartyBalances = finSchema.table(
  'party_balances',
  {
    companyId: ref('company_id').notNull(),
    partyId: ref('party_id').notNull(),
    accountId: ref('account_id').notNull(),
    openDebit: money('open_debit')
      .notNull()
      .default(sql`0`),
    openCredit: money('open_credit')
      .notNull()
      .default(sql`0`),
    /** The oldest due date of an open debit item. */
    oldestDueDate: date('oldest_due_date', { mode: 'string' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({
      name: 'fin_party_balances_pkey',
      columns: [t.companyId, t.partyId, t.accountId],
    }),
    foreignKey({
      name: 'fin_party_balances_party_fk',
      columns: [t.companyId, t.partyId],
      foreignColumns: [finPartyCompanies.companyId, finPartyCompanies.partyId],
    }),
    foreignKey({
      name: 'fin_party_balances_account_fk',
      columns: [t.companyId, t.accountId],
      foreignColumns: [finAccounts.companyId, finAccounts.id],
    }),
    index('fin_party_balances_account_idx').on(t.companyId, t.accountId),
    check('fin_party_balances_amounts', sql`${t.openDebit} >= 0 AND ${t.openCredit} >= 0`),
  ],
);

/** One check of the sub-ledger (ADR-0072 #8): the cache, the items, the sub-ledger against the GL. */
export const finReconcileRuns = finSchema.table(
  'reconcile_runs',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => finCompanies.id),
    kind: text('kind', { enum: FIN_RECONCILE_KINDS }).notNull(),
    trigger: text('trigger', { enum: ['NIGHTLY', 'MANUAL'] }).notNull(),
    status: text('status', { enum: ['OK', 'DRIFT'] }).notNull(),
    checked: integer('checked').notNull(),
    drifted: integer('drifted').notNull(),
    details: jsonValue('details')
      .notNull()
      .default(sql`'[]'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('fin_reconcile_runs_company_id_key').on(t.companyId, t.id),
    index('fin_reconcile_runs_company_idx').on(t.companyId, t.kind, t.id),
    check('fin_reconcile_runs_kind', sql`${t.kind} IN ('CACHE', 'ITEMS', 'SUBLEDGER_GL')`),
    check('fin_reconcile_runs_trigger', sql`${t.trigger} IN ('NIGHTLY', 'MANUAL')`),
    check('fin_reconcile_runs_status', sql`${t.status} IN ('OK', 'DRIFT')`),
  ],
);
