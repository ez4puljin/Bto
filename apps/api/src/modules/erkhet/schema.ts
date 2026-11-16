import {
  ERKHET_FAILURES,
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
    plan: jsonb('plan').$type<ErkhetCustomerPlan>(),
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
