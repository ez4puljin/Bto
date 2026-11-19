import {
  ERKHET_FAILURES,
  ERKHET_LEDGER_DEFAULTS,
  ERKHET_LEDGER_FAILURES,
  ERKHET_LEDGER_RUN_KINDS,
  ERKHET_LEDGER_SIDES,
  ERKHET_LEDGER_STATES,
  ERKHET_OWN_DOCUMENT_CHOICES,
  ERKHET_RESOLUTIONS,
  ERKHET_RUN_STATUSES,
  ERKHET_SYNC_ISSUES,
  ERKHET_SYNC_KINDS,
  type ErkhetSyncIssue,
} from '@tugeel/shared/erkhet';
import type { SettlementGroup } from '@tugeel/shared/finance';
import type { CustomerKind } from '@tugeel/shared/taxpayer';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { money } from '../../common/db/types';
import { users } from '../identity/schema';

// Tables owned by the erkhet module (ADR-0203, docs/modules/erkhet.md): Erkhet's sign-in, the
// checks of its lists against Bto's and what each check found. Erkhet's lists themselves are never
// kept: a check stores only the rows that differ.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const at = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const ERKHET_RUN_TRIGGERS = ['MANUAL', 'NIGHTLY'] as const;
export type ErkhetRunTrigger = (typeof ERKHET_RUN_TRIGGERS)[number];

/** What one list of a check came to. */
export interface ErkhetListSummary {
  /** Rows in Erkhet's list. */
  erkhet: number;
  /** Active rows on Bto's side. */
  bto: number;
  /** Erkhet rows that found their Bto row and agree with it. */
  agreed: number;
  issues: Partial<Record<ErkhetSyncIssue, number>>;
}

export interface ErkhetRunSummary {
  customers: ErkhetListSummary;
  products: ErkhetListSummary;
}

/** What «Bto-д тааруулах» will write for a missing customer, decided when the check ran. */
export interface ErkhetCustomerPlan {
  categoryId: number;
  settlementGroup: SettlementGroup;
  kind: CustomerKind;
  phone: string | null;
}

/**
 * What a product missing in Bto carries from Erkhet's list beside the row's own columns, kept when
 * the check ran (ADR-0222): the cells as Erkhet gave them; «Bto-д нэмэх» reads them into Bto's units.
 */
export interface ErkhetProductPlan {
  /** «Хэмжих нэгж код», «Хэмжих нэгж нэр»: the base unit. */
  unitCode: string | null;
  unitName: string | null;
  /** «Задрах харьцаа», digits as Erkhet gave them. */
  packRatio: string | null;
  /** «Жин», kilograms per base unit, digits as Erkhet gave them. */
  weight: string | null;
}

/** A row's plan: a customer's on CUSTOMER rows, a product's on PRODUCT rows (by the row's kind). */
export type ErkhetItemPlan = ErkhetCustomerPlan | ErkhetProductPlan;

/** The customer's plan of a row, or null. */
export function customerPlanOf(row: {
  kind: string;
  plan: ErkhetItemPlan | null;
}): ErkhetCustomerPlan | null {
  return row.kind === 'CUSTOMER' && row.plan !== null && 'categoryId' in row.plan ? row.plan : null;
}

/** The product's plan of a row, or null (rows of a check before ADR-0222 have none). */
export function productPlanOf(row: {
  kind: string;
  plan: ErkhetItemPlan | null;
}): ErkhetProductPlan | null {
  return row.kind === 'PRODUCT' && row.plan !== null && 'packRatio' in row.plan ? row.plan : null;
}

/**
 * Erkhet's sign-in, one row (ADR-0203 #2). The password is sealed under ERKHET_KEY_SECRET and
 * leaves this table only to reach the address beside it; no response, audit row or log carries it.
 */
export const erkhetSettings = pgTable(
  'erkhet_settings',
  {
    id: smallint('id').primaryKey(),
    baseUrl: text('base_url'),
    companyId: text('company_id'),
    username: text('username'),
    passwordSealed: text('password_sealed'),
    /** A check every night, when the sign-in is complete. */
    nightly: boolean('nightly').notNull().default(true),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('erkhet_settings_single', sql`${t.id} = 1`),
    check('erkhet_settings_url', sql`${t.baseUrl} IS NULL OR ${t.baseUrl} ~ '^https://[^/]+$'`),
    check(
      'erkhet_settings_company',
      sql`${t.companyId} IS NULL OR ${t.companyId} ~ '^[0-9]{4,20}$'`,
    ),
  ],
);

/**
 * One check. `active_slot` is 1 while the check waits or runs and NULL afterwards, so its unique
 * index lets only one check be under way; `business_day` with the NIGHTLY index keeps the nightly
 * one to once a day however often the worker starts.
 */
export const erkhetSyncRuns = pgTable(
  'erkhet_sync_runs',
  {
    id: id(),
    status: text('status', { enum: ERKHET_RUN_STATUSES }).notNull().default('QUEUED'),
    trigger: text('trigger', { enum: ERKHET_RUN_TRIGGERS }).notNull(),
    /** The Ulaanbaatar day the check was asked for. */
    businessDay: date('business_day').notNull(),
    activeSlot: smallint('active_slot'),
    startedBy: userRef('started_by'),
    createdAt: at('created_at').notNull().defaultNow(),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
    failure: text('failure', { enum: ERKHET_FAILURES }),
    summary: jsonb('summary').$type<ErkhetRunSummary>(),
    /** Rows kept for this check; 0 once an older check's rows were cleared. */
    itemCount: integer('item_count').notNull().default(0),
  },
  (t) => [
    check('erkhet_sync_runs_status', sql`${t.status} IN (${inList(ERKHET_RUN_STATUSES)})`),
    check('erkhet_sync_runs_trigger', sql`${t.trigger} IN (${inList(ERKHET_RUN_TRIGGERS)})`),
    check(
      'erkhet_sync_runs_failure',
      sql`(${t.failure} IS NOT NULL) = (${t.status} = 'FAILED') AND (${t.failure} IS NULL OR ${t.failure} IN (${inList(ERKHET_FAILURES)}))`,
    ),
    check(
      'erkhet_sync_runs_slot',
      sql`(${t.activeSlot} IS NOT NULL) = (${t.status} IN ('QUEUED', 'RUNNING')) AND coalesce(${t.activeSlot}, 1) = 1`,
    ),
    check(
      'erkhet_sync_runs_done',
      sql`${t.status} <> 'DONE' OR (${t.summary} IS NOT NULL AND ${t.finishedAt} IS NOT NULL)`,
    ),
    uniqueIndex('erkhet_sync_runs_one_active').on(t.activeSlot),
    uniqueIndex('erkhet_sync_runs_nightly_day')
      .on(t.businessDay)
      .where(sql`${t.trigger} = 'NIGHTLY'`),
  ],
);

/**
 * A row of a check that differs. Erkhet's side is kept as it stood in the list, Bto's side as it
 * was when the check ran; `resolution` says what «Bto-д тааруулах» did with it.
 */
export const erkhetSyncItems = pgTable(
  'erkhet_sync_items',
  {
    id: id(),
    runId: ref('run_id')
      .notNull()
      .references(() => erkhetSyncRuns.id),
    kind: text('kind', { enum: ERKHET_SYNC_KINDS }).notNull(),
    issue: text('issue', { enum: ERKHET_SYNC_ISSUES }).notNull(),
    erkhetCode: text('erkhet_code'),
    erkhetName: text('erkhet_name'),
    /** A customer's group «код нэр», an item's category. */
    erkhetGroup: text('erkhet_group'),
    erkhetBarcodes: text('erkhet_barcodes'),
    erkhetPrice: money('erkhet_price'),
    /** customers.id or products.id, by `kind`; no foreign key for that reason. */
    btoId: ref('bto_id'),
    btoCode: text('bto_code'),
    btoName: text('bto_name'),
    btoPrice: money('bto_price'),
    plan: jsonb('plan').$type<ErkhetItemPlan>(),
    resolution: text('resolution', { enum: ERKHET_RESOLUTIONS }),
    resolvedBy: userRef('resolved_by'),
    resolvedAt: at('resolved_at'),
  },
  (t) => [
    check('erkhet_sync_items_kind', sql`${t.kind} IN (${inList(ERKHET_SYNC_KINDS)})`),
    check('erkhet_sync_items_issue', sql`${t.issue} IN (${inList(ERKHET_SYNC_ISSUES)})`),
    check(
      'erkhet_sync_items_resolution',
      sql`(${t.resolution} IS NULL) = (${t.resolvedAt} IS NULL) AND (${t.resolution} IS NULL OR ${t.resolution} IN (${inList(ERKHET_RESOLUTIONS)}))`,
    ),
    check('erkhet_sync_items_side', sql`${t.erkhetCode} IS NOT NULL OR ${t.btoId} IS NOT NULL`),
    index('erkhet_sync_items_list').on(t.runId, t.kind, t.issue, t.id),
  ],
);

// ------------------------------------------------------------------------------------------------
// «Авлага, өглөгийн гүйлгээ» (ADR-0219): Erkhet's receivable and payable transactions copied into
// Bto's books. These tables hold what the last download showed and where each copy stands; the
// documents themselves are the Finance Core's, posted through fin-bridge.

/** What a run of the copy came to. */
export interface ErkhetLedgerAccountSummary {
  /** Erkhet's account code. */
  account: string;
  side: (typeof ERKHET_LEDGER_SIDES)[number];
  /** Transactions and lines Erkhet shows from the start date. */
  trs: number;
  lines: number;
  /** Erkhet's balance before the start date, its turnover since, and the balance now (MNT). */
  opening: string;
  debit: string;
  credit: string;
  closing: string;
  /** Parties with an opening balance. */
  openingParties: number;
}

export interface ErkhetLedgerCounts {
  /** Not in the books yet. */
  post: number;
  /** Changed in Erkhet since it was posted. */
  revise: number;
  /** No longer in Erkhet. */
  reverse: number;
  /** A party of it is not in Bto. */
  unmatched: number;
}

export interface ErkhetLedgerSummary {
  accounts: ErkhetLedgerAccountSummary[];
  /** What a posting would do (a check), or was asked to do (a post), with transactions. */
  trs: ErkhetLedgerCounts;
  /** The same with the parties' opening balances. */
  openings: ErkhetLedgerCounts;
  /** Party codes Erkhet has and Bto does not. */
  unmatchedParties: number;
  /** Bto's own documents on the copied accounts when the run started. */
  ownDocuments: { count: number; total: string };
  /** What a post or a revert did; null for a check. */
  done: {
    posted: number;
    reversed: number;
    /** Left as they were: Bto's own allocation holds their item. */
    blocked: number;
    /** Bto's own documents reversed with this run. */
    ownReversed: number;
    /** Transactions whose own address in Erkhet was found in this run. */
    links: number;
  } | null;
}

/** The copy's settings, one row: which Erkhet accounts are copied, and from which day. */
export const erkhetLedgerSettings = pgTable(
  'erkhet_ledger_settings',
  {
    id: smallint('id').primaryKey(),
    receivableAccount: text('receivable_account')
      .notNull()
      .default(ERKHET_LEDGER_DEFAULTS.receivableAccount),
    payableAccount: text('payable_account')
      .notNull()
      .default(ERKHET_LEDGER_DEFAULTS.payableAccount),
    startDate: date('start_date').notNull().default(ERKHET_LEDGER_DEFAULTS.startDate),
    /** On once «Bto-д оруулах» ran: the night's run then posts; off again after a revert. */
    posting: boolean('posting').notNull().default(false),
    /** Erkhet's internal ids of the two accounts as the last run found them (for the links). */
    receivableAccountId: text('receivable_account_id'),
    payableAccountId: text('payable_account_id'),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('erkhet_ledger_settings_single', sql`${t.id} = 1`),
    check(
      'erkhet_ledger_settings_accounts',
      sql`${t.receivableAccount} ~ '^[0-9]{3,20}$' AND ${t.payableAccount} ~ '^[0-9]{3,20}$' AND ${t.receivableAccount} <> ${t.payableAccount}`,
    ),
  ],
);

/** One run of the copy; one waits or runs at a time, and the night's is once a day. */
export const erkhetLedgerRuns = pgTable(
  'erkhet_ledger_runs',
  {
    id: id(),
    kind: text('kind', { enum: ERKHET_LEDGER_RUN_KINDS }).notNull(),
    status: text('status', { enum: ERKHET_RUN_STATUSES }).notNull().default('QUEUED'),
    trigger: text('trigger', { enum: ERKHET_RUN_TRIGGERS }).notNull(),
    businessDay: date('business_day').notNull(),
    activeSlot: smallint('active_slot'),
    /** A post that downloads first (the night's, and a manual one once posting is on). */
    download: boolean('download').notNull().default(true),
    /** What the person chose for Bto's own documents; null when there were none. */
    ownChoice: text('own_choice', { enum: ERKHET_OWN_DOCUMENT_CHOICES }),
    /** Bto's own documents reversed in the transaction that started this run. */
    ownReversed: integer('own_reversed').notNull().default(0),
    startedBy: userRef('started_by'),
    createdAt: at('created_at').notNull().defaultNow(),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
    failure: text('failure', { enum: ERKHET_LEDGER_FAILURES }),
    /** What the failure names: a month, an account code, the books' error code. */
    failureDetail: jsonb('failure_detail').$type<Record<string, string>>(),
    summary: jsonb('summary').$type<ErkhetLedgerSummary>(),
  },
  (t) => [
    check('erkhet_ledger_runs_kind', sql`${t.kind} IN (${inList(ERKHET_LEDGER_RUN_KINDS)})`),
    check('erkhet_ledger_runs_status', sql`${t.status} IN (${inList(ERKHET_RUN_STATUSES)})`),
    check('erkhet_ledger_runs_trigger', sql`${t.trigger} IN (${inList(ERKHET_RUN_TRIGGERS)})`),
    check(
      'erkhet_ledger_runs_failure',
      sql`(${t.failure} IS NOT NULL) = (${t.status} = 'FAILED') AND (${t.failure} IS NULL OR ${t.failure} IN (${inList(ERKHET_LEDGER_FAILURES)}))`,
    ),
    check(
      'erkhet_ledger_runs_slot',
      sql`(${t.activeSlot} IS NOT NULL) = (${t.status} IN ('QUEUED', 'RUNNING')) AND coalesce(${t.activeSlot}, 1) = 1`,
    ),
    check(
      'erkhet_ledger_runs_choice',
      sql`${t.ownChoice} IS NULL OR ${t.ownChoice} IN (${inList(ERKHET_OWN_DOCUMENT_CHOICES)})`,
    ),
    uniqueIndex('erkhet_ledger_runs_one_active').on(t.activeSlot),
    uniqueIndex('erkhet_ledger_runs_nightly_day')
      .on(t.businessDay)
      .where(sql`${t.trigger} = 'NIGHTLY'`),
  ],
);

/** The columns that say where a copy stands in the books (transactions and opening balances). */
const copyState = () => ({
  /** What Erkhet shows now, hashed. */
  hash: text('hash').notNull(),
  /** The latest complete download no longer held it. */
  gone: boolean('gone').notNull().default(false),
  state: text('state', { enum: ERKHET_LEDGER_STATES }).notNull().default('PENDING'),
  /** The hash of the revision in the books; null when nothing of it is posted. */
  postedHash: text('posted_hash'),
  /** The revision whose document is live in the books; null when none is. */
  liveRevision: integer('live_revision'),
  /** The highest revision ever sent to the books for it. */
  lastRevision: integer('last_revision').notNull().default(0),
  /** The accounting date of the live document: its reversal is dated the same day. */
  postedDate: date('posted_date'),
  /** Why a reversal was refused (the books' error code). */
  blockedReason: text('blocked_reason'),
  updatedAt: at('updated_at').notNull().defaultNow(),
});

/**
 * An Erkhet transaction on one copied account: the document a copy is made of, keyed by Erkhet's
 * account code and transaction number.
 */
export const erkhetLedgerTrs = pgTable(
  'erkhet_ledger_trs',
  {
    id: id(),
    account: text('account').notNull(),
    /** Which side of Bto's books the account was copied to when the row was first seen. */
    side: text('side', { enum: ERKHET_LEDGER_SIDES }).notNull(),
    trId: bigint('tr_id', { mode: 'number' }).notNull(),
    /** «Ажил гүйлгээний дугаар». */
    ptrId: bigint('ptr_id', { mode: 'number' }),
    trDate: date('tr_date').notNull(),
    debit: money('debit').notNull(),
    credit: money('credit').notNull(),
    lineCount: integer('line_count').notNull(),
    /** The party codes of the revision in the books: their pairings are undone before it is reversed. */
    postedParties: jsonb('posted_parties').$type<string[]>(),
    /** The path that opens it in Erkhet; asked for transaction by transaction, so filled later. */
    updatePath: text('update_path'),
    pathAskedAt: at('path_asked_at'),
    ...copyState(),
  },
  (t) => [
    check('erkhet_ledger_trs_state', sql`${t.state} IN (${inList(ERKHET_LEDGER_STATES)})`),
    check('erkhet_ledger_trs_side', sql`${t.side} IN (${inList(ERKHET_LEDGER_SIDES)})`),
    check(
      'erkhet_ledger_trs_live',
      sql`(${t.liveRevision} IS NULL OR ${t.postedHash} IS NOT NULL) AND coalesce(${t.liveRevision}, 0) <= ${t.lastRevision}`,
    ),
    uniqueIndex('erkhet_ledger_trs_key').on(t.account, t.trId),
    index('erkhet_ledger_trs_state_at').on(t.state, t.trDate, t.id),
  ],
);

/** A transaction's lines on the account, in Erkhet's order (lines carry no id of their own). */
export const erkhetLedgerLines = pgTable(
  'erkhet_ledger_lines',
  {
    id: id(),
    trRowId: ref('tr_row_id')
      .notNull()
      .references(() => erkhetLedgerTrs.id, { onDelete: 'cascade' }),
    n: integer('n').notNull(),
    /** Empty for a line Erkhet shows without a party. */
    partyCode: text('party_code').notNull(),
    partyName: text('party_name').notNull(),
    debit: money('debit').notNull(),
    credit: money('credit').notNull(),
    description: text('description').notNull(),
    billNumber: text('bill_number').notNull(),
  },
  (t) => [
    uniqueIndex('erkhet_ledger_lines_key').on(t.trRowId, t.n),
    index('erkhet_ledger_lines_party').on(t.partyCode),
  ],
);

/**
 * A party's balance on a copied account before the start date, summed once from Erkhet's whole
 * history up to `through`.
 */
export const erkhetLedgerOpenings = pgTable(
  'erkhet_ledger_openings',
  {
    id: id(),
    account: text('account').notNull(),
    side: text('side', { enum: ERKHET_LEDGER_SIDES }).notNull(),
    partyCode: text('party_code').notNull(),
    partyName: text('party_name').notNull(),
    /** The last day summed: the day before the start date. */
    through: date('through').notNull(),
    debit: money('debit').notNull(),
    credit: money('credit').notNull(),
    lineCount: integer('line_count').notNull(),
    ...copyState(),
  },
  (t) => [
    check('erkhet_ledger_openings_state', sql`${t.state} IN (${inList(ERKHET_LEDGER_STATES)})`),
    check('erkhet_ledger_openings_side', sql`${t.side} IN (${inList(ERKHET_LEDGER_SIDES)})`),
    uniqueIndex('erkhet_ledger_openings_key').on(t.account, t.partyCode),
  ],
);

/** What an account's opening balances were computed from, so later runs do not read it again. */
export const erkhetLedgerOpeningReads = pgTable('erkhet_ledger_opening_reads', {
  account: text('account').primaryKey(),
  through: date('through').notNull(),
  pages: integer('pages').notNull(),
  lines: integer('lines').notNull(),
  debit: money('debit').notNull(),
  credit: money('credit').notNull(),
  readAt: at('read_at').notNull().defaultNow(),
});

/**
 * A party whose copied items want pairing (credits close debits oldest first), and the ALLOCATION
 * documents that paired them. `dirty` is set in the transaction that posts or reverses a copy of
 * the party and cleared in the one that pairs, so a run that died is picked up by the next.
 */
export const erkhetLedgerParties = pgTable(
  'erkhet_ledger_parties',
  {
    id: id(),
    side: text('side', { enum: ERKHET_LEDGER_SIDES }).notNull(),
    partyCode: text('party_code').notNull(),
    dirty: boolean('dirty').notNull().default(true),
  },
  (t) => [
    check('erkhet_ledger_parties_side', sql`${t.side} IN (${inList(ERKHET_LEDGER_SIDES)})`),
    uniqueIndex('erkhet_ledger_parties_key').on(t.side, t.partyCode),
  ],
);

export const erkhetLedgerAllocations = pgTable(
  'erkhet_ledger_allocations',
  {
    id: id(),
    partyRowId: ref('party_row_id')
      .notNull()
      .references(() => erkhetLedgerParties.id),
    /** Taken back before a copy of the party is reversed; the items are paired again afterwards. */
    live: boolean('live').notNull().default(true),
    pairs: integer('pairs').notNull(),
    amount: money('amount').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('erkhet_ledger_allocations_party').on(t.partyRowId, t.live)],
);
