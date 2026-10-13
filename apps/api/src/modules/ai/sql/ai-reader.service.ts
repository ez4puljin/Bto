import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { AI_EXPORT_MAX_ROWS, AI_MAX_ROWS } from '@tugeel/shared/ai';
import { type FieldDef, Pool, type PoolClient, type QueryArrayConfig, type QueryConfig } from 'pg';
import { AppConfig } from '../../../common/config/app-config';
import { cursorStatement, guardSql } from './sql-guard';

/** How the web shows a column, from its PostgreSQL type. */
export type AiColumnKind = 'number' | 'text' | 'date' | 'datetime' | 'boolean';

export interface AiResultColumn {
  name: string;
  kind: AiColumnKind;
}

/** Values are the database's own text (numbers keep their scale; booleans are t / f). */
export type AiRow = (string | null)[];

export interface AiResult {
  columns: AiResultColumn[];
  rows: AiRow[];
  /** More rows existed than the limit. */
  truncated: boolean;
}

export interface ReadLimits {
  maxRows: number;
  timeoutMs: number;
}

export const SCREEN_LIMITS: ReadLimits = { maxRows: AI_MAX_ROWS, timeoutMs: 15_000 };
export const EXPORT_LIMITS: ReadLimits = { maxRows: AI_EXPORT_MAX_ROWS, timeoutMs: 30_000 };
const EXPORT_BATCH = 1_000;
const CURSOR = 'ai_c';

/**
 * Why a query did not run: the guard refused it, or the database (or the connection) failed. Only
 * a refusal or a query mistake goes back to the model for a repair; a timeout or a resource
 * error never does (ADR-0045 #6).
 */
export class AiQueryError extends Error {
  constructor(
    readonly source: 'GUARD' | 'DATABASE',
    /** A guard reason, an SQLSTATE, or CONNECTION. */
    readonly code: string,
    message: string,
    readonly repairable: boolean,
  ) {
    super(message);
    this.name = 'AiQueryError';
  }
}

/** Not repairable by rewriting the query: timeouts, resources, privileges, the connection. */
const FINAL_SQLSTATES = /^(57|53|54|08|25|42501|XX)/;

const RAW_TEXT = { getTypeParser: () => (value: string) => value };
/** node-postgres 8.23 supports queryMode, its typings do not: one statement per message. */
type Extended<T> = T & { queryMode: 'extended' };

/**
 * Runs the assistant's SQL as role ai_reader (ADR-0045 #5), after the guard, in a read-only
 * transaction with its own timeouts: the cursor stops after the rows it needs, and the
 * connection is destroyed afterwards so no session state survives. The pool (AI_POOL_MAX over
 * AI_DATABASE_URL) is created on first use; the api runs without it while the assistant is off.
 */
@Injectable()
export class AiReaderService implements OnApplicationShutdown {
  private readonly logger = new Logger(AiReaderService.name);
  private pool: Pool | null = null;

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return Boolean(this.config.get('AI_DATABASE_URL'));
  }

  /** The first rows of a query, for the screen. */
  async run(sql: string, limits: ReadLimits = SCREEN_LIMITS): Promise<AiResult> {
    let columns: AiResultColumn[] = [];
    const rows: AiRow[] = [];
    const { truncated } = await this.stream(sql, limits, (batchColumns, batch) => {
      columns = batchColumns;
      rows.push(...batch);
    });
    return { columns, rows, truncated };
  }

  /** Feeds the rows in batches (an Excel export) without holding them all in memory. */
  async stream(
    sql: string,
    limits: ReadLimits,
    onBatch: (columns: AiResultColumn[], rows: AiRow[]) => Promise<void> | void,
  ): Promise<{ rowCount: number; truncated: boolean }> {
    const checked = await guardSql(sql);
    if (!checked.ok) throw new AiQueryError('GUARD', checked.reason, checked.detail, true);
    const declare = await cursorStatement(checked.sql, CURSOR);
    const client = await this.connect();
    try {
      await client.query('BEGIN READ ONLY');
      for (const statement of sessionSettings(limits.timeoutMs)) await client.query(statement);
      const declareQuery: Extended<QueryConfig> = { text: declare, queryMode: 'extended' };
      await client.query(declareQuery);
      let rowCount = 0;
      for (;;) {
        const wanted = Math.min(EXPORT_BATCH, limits.maxRows + 1 - rowCount);
        const query: Extended<QueryArrayConfig> = {
          text: `FETCH ${wanted} FROM ${CURSOR}`,
          rowMode: 'array',
          types: RAW_TEXT,
          queryMode: 'extended',
        };
        const batch = await client.query<AiRow>(query);
        const room = limits.maxRows - rowCount;
        const rows = batch.rows.slice(0, room);
        rowCount += rows.length;
        if (rows.length > 0 || rowCount === 0) await onBatch(columnsOf(batch.fields), rows);
        if (batch.rows.length > room) {
          await client.query('ROLLBACK');
          return { rowCount, truncated: true };
        }
        if (batch.rows.length < wanted) break;
      }
      await client.query('ROLLBACK');
      return { rowCount, truncated: false };
    } catch (error: unknown) {
      throw toQueryError(error);
    } finally {
      // Destroyed, never returned to the pool: no cursor, setting or lock outlives the query.
      client.release(true);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end();
  }

  private async connect(): Promise<PoolClient> {
    try {
      return await this.poolOf().connect();
    } catch (error: unknown) {
      this.logger.error({ err: error }, 'ai_reader connection failed');
      throw new AiQueryError('DATABASE', 'CONNECTION', 'the read-only connection failed', false);
    }
  }

  private poolOf(): Pool {
    if (this.pool) return this.pool;
    const url = this.config.get('AI_DATABASE_URL');
    if (!url) throw new Error('AI_DATABASE_URL is not configured');
    const pool = new Pool({
      connectionString: url,
      max: this.config.require('AI_POOL_MAX'),
      application_name: 'tugeel-ai',
      // Queued questions wait for a free connection rather than fail fast.
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 1_000,
    });
    pool.on('error', (err) => this.logger.error({ err }, 'ai_reader idle client error'));
    this.pool = pool;
    return pool;
  }
}

/** Transaction-local limits on top of the role's defaults (each its own statement). */
export function sessionSettings(timeoutMs: number): string[] {
  return [
    `SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`,
    "SET LOCAL lock_timeout = '2s'",
    "SET LOCAL TIME ZONE 'Asia/Ulaanbaatar'",
    'SET LOCAL search_path = ai',
    "SET LOCAL work_mem = '16MB'",
    'SET LOCAL jit = off',
    'SET LOCAL max_parallel_workers_per_gather = 0',
  ];
}

function columnsOf(fields: readonly FieldDef[]): AiResultColumn[] {
  return fields.map((field) => ({ name: field.name, kind: kindOf(field.dataTypeID) }));
}

/** By type OID: int8, int2, int4, float4, float8, numeric; bool; date; timestamp(tz). */
function kindOf(oid: number): AiColumnKind {
  if ([20, 21, 23, 700, 701, 1700].includes(oid)) return 'number';
  if (oid === 16) return 'boolean';
  if (oid === 1082) return 'date';
  if (oid === 1114 || oid === 1184) return 'datetime';
  return 'text';
}

function toQueryError(error: unknown): AiQueryError {
  if (error instanceof AiQueryError) return error;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
    const text = typeof message === 'string' ? message : 'the query failed';
    return new AiQueryError('DATABASE', code, text, !FINAL_SQLSTATES.test(code));
  }
  return new AiQueryError('DATABASE', 'CONNECTION', 'the read-only connection failed', false);
}
