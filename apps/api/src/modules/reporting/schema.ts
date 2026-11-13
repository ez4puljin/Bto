import {
  PERIOD_PRESETS,
  REPORT_VIEW_NAME_MAX_LENGTH,
  REPORT_VIEW_PAGE_KEYS,
  REPORT_VIEW_QUERY_MAX_LENGTH,
} from '@tugeel/shared/reports';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from '../identity/schema';

// Tables owned by the reporting module (docs/modules/reporting.md). The schema `reporting` with
// its views is written by hand in migration 0046; this file holds the module's ordinary tables.

const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;

/**
 * A saved view of a report page (ADR-0194): the page's address parameters under a name, its
 * author's alone or shared with everyone who may open the page. `period` names a moving period
 * (the dates are then not in `query`).
 */
export const reportViews = pgTable(
  'report_views',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    page: text('page').notNull(),
    name: text('name').notNull(),
    query: text('query').notNull(),
    period: text('period'),
    shared: boolean('shared').notNull().default(false),
    createdBy: bigint('created_by', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('report_views_name_key').on(t.createdBy, t.page, sql`lower(${t.name})`),
    index('report_views_shared_idx')
      .on(t.page)
      .where(sql`${t.shared}`),
    check('report_views_page', inList(t.page, REPORT_VIEW_PAGE_KEYS)),
    check(
      'report_views_name',
      sql`length(btrim(${t.name})) BETWEEN 1 AND ${sql.raw(String(REPORT_VIEW_NAME_MAX_LENGTH))}`,
    ),
    check(
      'report_views_query',
      sql`length(${t.query}) <= ${sql.raw(String(REPORT_VIEW_QUERY_MAX_LENGTH))}`,
    ),
    check('report_views_period', sql`${t.period} IS NULL OR ${inList(t.period, PERIOD_PRESETS)}`),
  ],
);
