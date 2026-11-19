import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { customers } from '../partners/schema';
import { users } from '../identity/schema';
import { salesOrders } from '../sales/schema';

// Tables owned by the erxes module (ADR-0218, docs/modules/erxes.md): the sign-in to the company's
// erxes, the erxes pipelines whose new deals are copied, erxes's users beside Bto's, and every
// deal that was seen, whole as it came, with the order it became.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const at = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** WAITING: seen, not an order yet; COPIED: it is an order; DISMISSED: a person set it aside. */
export const ERXES_DEAL_STATUSES = ['WAITING', 'COPIED', 'DISMISSED'] as const;
export type ErxesDealStatus = (typeof ERXES_DEAL_STATUSES)[number];

/** Why a deal waits (ADR-0218 #6); the page says each in plain words. */
export const ERXES_WAIT_REASONS = [
  /** The erxes pipeline has no live Bto stage chosen for its copies. */
  'NO_STAGE',
  /** The deal names no customer and no company. */
  'NO_CUSTOMER',
  /** None of its customers or companies is a Bto customer by code, register number or phone. */
  'CUSTOMER_NOT_FOUND',
  /** Several Bto customers fit and none by code. */
  'CUSTOMER_AMBIGUOUS',
  /** A product's code is neither a Bto code nor a barcode. */
  'PRODUCT_NOT_FOUND',
  /** A product's barcode belongs to several Bto products. */
  'PRODUCT_AMBIGUOUS',
  /** A line is in a unit the Bto product does not have. */
  'UNIT_NOT_FOUND',
  /** A line's quantity is not a positive number. */
  'BAD_QUANTITY',
  /** Bto's own order rules refused the draft (`code`: the rule). */
  'ORDER_REFUSED',
] as const;
export type ErxesWaitReason = (typeof ERXES_WAIT_REASONS)[number];

/** One reason a deal waits, with what the page needs to name it. */
export interface ErxesWaitIssue {
  reason: ErxesWaitReason;
  /** The erxes product's id, for the product reasons. */
  erxesProductId?: string;
  /** An erxes code, a product's or a customer's. */
  code?: string;
  name?: string;
  /** ORDER_REFUSED: Bto's error code. */
  errorCode?: string;
}

/** What a person chose for a waiting deal: the customer, and a Bto unit per erxes product. */
export interface ErxesDealChoices {
  customerId?: number;
  /** erxes product id → product_units.id. */
  units?: Record<string, number>;
}

/** Why the last pull failed. */
export const ERXES_PULL_FAILURES = [
  'NOT_CONFIGURED',
  'KEY_UNREADABLE',
  'LOGIN_FAILED',
  'UNREACHABLE',
  'TIMEOUT',
  'UNEXPECTED_ANSWER',
  'INTERNAL',
] as const;
export type ErxesPullFailure = (typeof ERXES_PULL_FAILURES)[number];

/**
 * The sign-in to erxes, one row (ADR-0218 #2). The password is sealed under ERKHET_KEY_SECRET with
 * this column's own context and leaves the table only to reach the address beside it.
 */
export const erxesSettings = pgTable(
  'erxes_settings',
  {
    id: smallint('id').primaryKey(),
    baseUrl: text('base_url'),
    email: text('email'),
    passwordSealed: text('password_sealed'),
    /** The master switch: off, nothing is pulled. */
    enabled: boolean('enabled').notNull().default(false),
    lastPullAt: at('last_pull_at'),
    /** The last pull that reached erxes and read every ticked pipeline. */
    lastOkAt: at('last_ok_at'),
    lastFailure: text('last_failure', { enum: ERXES_PULL_FAILURES }),
    /** English detail for the person who looks into it; never a password or a token. */
    lastFailureDetail: text('last_failure_detail'),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('erxes_settings_single', sql`${t.id} = 1`),
    check('erxes_settings_url', sql`${t.baseUrl} IS NULL OR ${t.baseUrl} ~ '^https://[^/]+$'`),
    check(
      'erxes_settings_failure',
      sql`${t.lastFailure} IS NULL OR ${t.lastFailure} IN (${inList(ERXES_PULL_FAILURES)})`,
    ),
  ],
);

/**
 * A pipeline of erxes as the last «Шинэчлэх» read it. `enabled_at` is the moment it was ticked:
 * only deals created after it are copied. `last_seen_created_at` is the newest deal a pull has
 * read, where the next pull stops.
 */
export const erxesPipelines = pgTable(
  'erxes_pipelines',
  {
    id: id(),
    erxesId: text('erxes_id').notNull(),
    name: text('name').notNull(),
    boardErxesId: text('board_erxes_id'),
    boardName: text('board_name'),
    /** A board that is never copied (Kharkhorin has its own installation, ADR-0218 #3). */
    blocked: boolean('blocked').notNull().default(false),
    /** erxes no longer lists it. */
    gone: boolean('gone').notNull().default(false),
    enabled: boolean('enabled').notNull().default(false),
    enabledAt: at('enabled_at'),
    enabledBy: userRef('enabled_by'),
    /** sales_pipelines.id and sales_stages.id; no foreign key: sales validates at each copy. */
    btoPipelineId: ref('bto_pipeline_id'),
    btoStageId: ref('bto_stage_id'),
    lastSeenCreatedAt: at('last_seen_created_at'),
    lastPullAt: at('last_pull_at'),
    /** The first answers erxes gave for this pipeline, kept to compare with the expected shape. */
    firstPull: jsonb('first_pull').$type<unknown>(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('erxes_pipelines_erxes_id').on(t.erxesId),
    check('erxes_pipelines_enabled', sql`NOT ${t.enabled} OR ${t.enabledAt} IS NOT NULL`),
    check('erxes_pipelines_blocked', sql`NOT (${t.enabled} AND ${t.blocked})`),
    check('erxes_pipelines_place', sql`(${t.btoPipelineId} IS NULL) = (${t.btoStageId} IS NULL)`),
  ],
);

/**
 * A user of erxes and the Bto user who is the same person. `bto_user_id` is the choice of a
 * person on the settings page; without one the name and the phone are compared at each copy.
 */
export const erxesUsers = pgTable(
  'erxes_users',
  {
    id: id(),
    erxesId: text('erxes_id').notNull(),
    email: text('email'),
    username: text('username'),
    fullName: text('full_name'),
    phone: text('phone'),
    btoUserId: userRef('bto_user_id'),
    mappedBy: userRef('mapped_by'),
    mappedAt: at('mapped_at'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('erxes_users_erxes_id').on(t.erxesId)],
);

/**
 * A deal of erxes that a pull saw (ADR-0218 #4, #5). `erxes_id` is unique, so a deal is one row
 * however often it is read, and `order_id` is unique, so it becomes one order. `raw` is the deal as
 * erxes answered and is never rewritten; `products` and `field_labels` are what erxes said of its
 * products and custom fields at that moment.
 */
export const erxesDeals = pgTable(
  'erxes_deals',
  {
    id: id(),
    erxesId: text('erxes_id').notNull(),
    pipelineErxesId: text('pipeline_erxes_id').notNull(),
    name: text('name'),
    number: text('number'),
    erxesCreatedAt: at('erxes_created_at'),
    creatorErxesId: text('creator_erxes_id'),
    /** The creator's name in erxes: what the order panel shows when no Bto user is the same. */
    creatorName: text('creator_name'),
    /** The Bto user the creator was matched to when the order was made. */
    creatorUserId: userRef('creator_user_id'),
    status: text('status', { enum: ERXES_DEAL_STATUSES }).notNull().default('WAITING'),
    issues: jsonb('issues').$type<ErxesWaitIssue[]>().notNull().default([]),
    choices: jsonb('choices').$type<ErxesDealChoices>().notNull().default({}),
    /** erxes product id → the product_units.id its line became, written with the order. */
    matchedUnits: jsonb('matched_units').$type<Record<string, number>>(),
    raw: jsonb('raw').$type<unknown>().notNull(),
    products: jsonb('products').$type<unknown>(),
    fieldLabels: jsonb('field_labels').$type<Record<string, string>>(),
    orderId: ref('order_id').references(() => salesOrders.id),
    /** The Bto customer the order was made for. */
    customerId: ref('customer_id').references(() => customers.id),
    attempts: integer('attempts').notNull().default(0),
    lastTriedAt: at('last_tried_at'),
    copiedAt: at('copied_at'),
    /** The person who pressed «Bto руу хуулах»; null when the pull copied it. */
    copiedBy: userRef('copied_by'),
    dismissedAt: at('dismissed_at'),
    dismissedBy: userRef('dismissed_by'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('erxes_deals_erxes_id').on(t.erxesId),
    uniqueIndex('erxes_deals_order').on(t.orderId),
    index('erxes_deals_status_idx').on(t.status, t.id),
    check('erxes_deals_status', sql`${t.status} IN (${inList(ERXES_DEAL_STATUSES)})`),
    check(
      'erxes_deals_copied',
      sql`(${t.status} = 'COPIED') = (${t.orderId} IS NOT NULL) AND (${t.orderId} IS NULL) = (${t.copiedAt} IS NULL)`,
    ),
    check(
      'erxes_deals_dismissed',
      sql`(${t.status} = 'DISMISSED') = (${t.dismissedAt} IS NOT NULL)`,
    ),
  ],
);
