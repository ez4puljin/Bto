import { ATTENDANCE_KINDS, ATTENDANCE_SOURCES } from '@tugeel/shared/hr';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { coordinate } from '../../common/db/types';
import { branches, users } from '../identity/schema';

// The tables owned by the hr module (docs/modules/hr.md, ADR-0131): attendance from the staff
// app. Migration 0064_hr_attendance adds by hand the REVOKEs that keep the events from being
// deleted or rewritten: a wrong punch is struck out (its `deleted_*` columns, the one UPDATE the
// app role may make) and a corrected one typed beside it.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/**
 * A work site (ADR-0131 #1): a named point with a radius; a punch counts only inside one. Kept
 * by HR; archived, never deleted (events point at it).
 */
export const hrWorkSites = pgTable(
  'hr_work_sites',
  {
    id: id(),
    name: text('name').notNull(),
    lat: coordinate('lat').notNull(),
    lng: coordinate('lng').notNull(),
    radiusM: smallint('radius_m').notNull().default(150),
    branchId: ref('branch_id').references(() => branches.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('hr_work_sites_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check('hr_work_sites_name_present', sql`length(btrim(${t.name})) BETWEEN 1 AND 60`),
    check('hr_work_sites_radius', sql`${t.radiusM} BETWEEN 30 AND 2000`),
    // @tugeel/shared/geo MONGOLIA_BOUNDS, as the customer addresses.
    check(
      'hr_work_sites_in_mongolia',
      sql`${t.lat} BETWEEN 41.5 AND 52.2 AND ${t.lng} BETWEEN 87.7 AND 120`,
    ),
  ],
);

/** The company's one schedule (ADR-0131 #2): the day's start and end, the grace, the workdays. */
export const hrSettings = pgTable(
  'hr_settings',
  {
    id: smallint('id').primaryKey(),
    workStart: text('work_start').notNull().default('09:00'),
    workEnd: text('work_end').notNull().default('18:00'),
    graceMinutes: smallint('grace_minutes').notNull().default(10),
    /** Seven flags, Monday first. */
    workdays: text('workdays').notNull().default('1111110'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('hr_settings_single', sql`${t.id} = 1`),
    check('hr_settings_work_start', sql`${t.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('hr_settings_work_end', sql`${t.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('hr_settings_grace', sql`${t.graceMinutes} BETWEEN 0 AND 120`),
    check('hr_settings_workdays', sql`${t.workdays} ~ '^[01]{7}$'`),
  ],
);

/**
 * One employee's own terms (ADR-0131 #2): a schedule of their own where set, and `tracked` off
 * for staff whose attendance is not counted (the owner). No row = the company schedule, tracked.
 */
export const hrEmployees = pgTable(
  'hr_employees',
  {
    userId: ref('user_id')
      .primaryKey()
      .references(() => users.id),
    tracked: boolean('tracked').notNull().default(true),
    workStart: text('work_start'),
    workEnd: text('work_end'),
    graceMinutes: smallint('grace_minutes'),
    workdays: text('workdays'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'hr_employees_work_start',
      sql`${t.workStart} IS NULL OR ${t.workStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'hr_employees_work_end',
      sql`${t.workEnd} IS NULL OR ${t.workEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      'hr_employees_grace',
      sql`${t.graceMinutes} IS NULL OR ${t.graceMinutes} BETWEEN 0 AND 120`,
    ),
    check('hr_employees_workdays', sql`${t.workdays} IS NULL OR ${t.workdays} ~ '^[01]{7}$'`),
  ],
);

/** The sites an employee may punch at (ADR-0131 #1); no row = every active site. */
export const hrEmployeeSites = pgTable(
  'hr_employee_sites',
  {
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    siteId: ref('site_id')
      .notNull()
      .references(() => hrWorkSites.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.siteId] })],
);

/**
 * A punch (ADR-0131 #3): IN or OUT at a server instant, on the Ulaanbaatar date it fell on, with
 * the phone's fix and the site it was inside (APP), or typed by HR with a note (OFFICE). Never
 * updated or deleted; struck out with `deleted_*` and a reason.
 */
export const hrAttendanceEvents = pgTable(
  'hr_attendance_events',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: ATTENDANCE_KINDS }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    businessDate: date('business_date').notNull(),
    source: text('source', { enum: ATTENDANCE_SOURCES }).notNull(),
    siteId: ref('site_id').references(() => hrWorkSites.id),
    lat: coordinate('lat'),
    lng: coordinate('lng'),
    accuracyM: integer('accuracy_m'),
    distanceM: integer('distance_m'),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: userRef('deleted_by'),
    deleteReason: text('delete_reason'),
  },
  (t) => [
    index('hr_attendance_events_user_date_idx').on(t.userId, t.businessDate, t.at),
    index('hr_attendance_events_date_idx').on(t.businessDate, t.at),
    check('hr_attendance_events_kind', sql`${t.kind} IN ('IN', 'OUT')`),
    check('hr_attendance_events_source', sql`${t.source} IN ('APP', 'OFFICE')`),
    check('hr_attendance_events_gps_pair', sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    check(
      'hr_attendance_events_app_fix',
      sql`${t.source} <> 'APP' OR (${t.lat} IS NOT NULL AND ${t.siteId} IS NOT NULL AND ${t.distanceM} IS NOT NULL)`,
    ),
    check(
      'hr_attendance_events_note',
      sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 200`,
    ),
    check(
      'hr_attendance_events_deleted',
      sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL) AND (${t.deletedAt} IS NULL) = (${t.deleteReason} IS NULL)`,
    ),
  ],
);
