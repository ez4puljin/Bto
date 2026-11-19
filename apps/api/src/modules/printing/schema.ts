import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  customType,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from '../identity/schema';
import { posTills } from '../pos/schema';
import {
  PRINT_JOB_STATUSES,
  PRINT_LIMITS,
  PRINT_STATION_KINDS,
  PRINT_STATION_STATUSES,
  PRINT_WIDTHS,
} from './printing.rules';

// The tables owned by the printing module (docs/modules/printing.md, ADR-0226). Migration
// 0115_printing adds by hand: the REVOKEs (stations and jobs are never deleted).

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly (string | number)[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(typeof value === 'number' ? String(value) : `'${value}'`)),
    sql`, `,
  )})`;
const lim = (value: number): SQL => sql.raw(String(value));

/** The ESC/POS bytes of a job, as PostgreSQL's bytea (node-postgres reads it as a Buffer). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * A printer the staff print price labels on (ADR-0226 #4): `NETWORK` is an 80 mm printer on the
 * LAN that the api writes to at `host:port` itself; `BRIDGE` is a printer on a Windows PC whose
 * bridge (`tools/print-bridge`) asks for its jobs with a key, kept here as a sha-256 of the whole
 * key. `printer_name` is the Windows printer the bridge last said it writes to; `last_seen_at`
 * the bridge's last call or the api's last successful send. `DISABLED` takes no jobs.
 */
export const printStations = pgTable(
  'print_stations',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: PRINT_STATION_KINDS }).notNull(),
    host: text('host'),
    port: integer('port'),
    keyHash: text('key_hash'),
    printerName: text('printer_name'),
    widthDots: smallint('width_dots').notNull().default(576),
    status: text('status', { enum: PRINT_STATION_STATUSES }).notNull().default('ACTIVE'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'print_stations_name',
      sql`char_length(${t.name}) BETWEEN 1 AND ${lim(PRINT_LIMITS.nameMax)}`,
    ),
    check('print_stations_kind', inList(t.kind, PRINT_STATION_KINDS)),
    check('print_stations_status', inList(t.status, PRINT_STATION_STATUSES)),
    check('print_stations_width', inList(t.widthDots, PRINT_WIDTHS)),
    check(
      'print_stations_network',
      sql`${t.kind} <> 'NETWORK' OR (${t.host} IS NOT NULL AND char_length(${t.host}) BETWEEN 1 AND 253 AND ${t.port} BETWEEN 1 AND 65535)`,
    ),
    check('print_stations_bridge', sql`${t.kind} <> 'BRIDGE' OR ${t.keyHash} IS NOT NULL`),
    check(
      'print_stations_printer_name',
      sql`${t.printerName} IS NULL OR char_length(${t.printerName}) BETWEEN 1 AND 200`,
    ),
  ],
);

/**
 * One print of labels (ADR-0226 #5): the ESC/POS bytes made by the api, sent to a station.
 * QUEUED → PRINTING (the bridge took it, or the api is sending it) → DONE or FAILED with an
 * `error` code; a job not taken in two minutes fails `PRINTER_OFFLINE`. The bytes are cleared
 * when it ends. `till_id` is the till whose prices the labels carry (null: the office's test label).
 */
export const printJobs = pgTable(
  'print_jobs',
  {
    id: id(),
    stationId: ref('station_id')
      .notNull()
      .references(() => printStations.id),
    tillId: ref('till_id').references(() => posTills.id),
    payload: bytea('payload'),
    labels: integer('labels').notNull(),
    status: text('status', { enum: PRINT_JOB_STATUSES }).notNull().default('QUEUED'),
    error: text('error'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    pickedAt: timestamp('picked_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check('print_jobs_status', inList(t.status, PRINT_JOB_STATUSES)),
    check('print_jobs_labels', sql`${t.labels} BETWEEN 1 AND ${lim(PRINT_LIMITS.maxLabels)}`),
    check(
      'print_jobs_error',
      sql`(${t.status} = 'FAILED') = (${t.error} IS NOT NULL) AND (${t.error} IS NULL OR char_length(${t.error}) BETWEEN 1 AND 500)`,
    ),
    check(
      'print_jobs_finished',
      sql`(${t.status} IN ('DONE', 'FAILED')) = (${t.finishedAt} IS NOT NULL)`,
    ),
    index('print_jobs_queued_idx')
      .on(t.stationId, t.id)
      .where(sql`${t.status} = 'QUEUED'`),
  ],
);
