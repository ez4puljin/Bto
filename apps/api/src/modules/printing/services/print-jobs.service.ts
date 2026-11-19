import { setTimeout as sleep } from 'node:timers/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { RawSendError, sendRaw } from '../label/raw-socket';
import { PrintError } from '../printing.errors';
import { PRINT_LIMITS, type PrintJobStatus } from '../printing.rules';
import { printJobs } from '../schema';
import { type PrintStation, PrintStationsService } from './print-stations.service';

export interface PrintJobView {
  id: number;
  stationId: number;
  labels: number;
  status: PrintJobStatus;
  /** Why it failed: PRINTER_OFFLINE, PRINTER_UNREACHABLE or PRINTER_REFUSED; null otherwise. */
  error: string | null;
  /** What the bridge or the socket said, for the office; null without. */
  detail: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

type JobRow = typeof printJobs.$inferSelect;

/** Who may read any job: the office that manages the printers. */
const MANAGE = 'pos.manage';

/**
 * Print jobs (ADR-0226 #5): a row per print with the ESC/POS bytes. A NETWORK station's job is sent
 * by this api right after it is written, outside any transaction; a BRIDGE station's waits for its
 * bridge to take it (`next`, a long poll) and report it (`finish`). A job not taken within two
 * minutes, or taken and not reported within two more, fails PRINTER_OFFLINE; that is applied
 * whenever jobs are read, so no timer is needed. The bytes are cleared when a job ends.
 */
@Injectable()
export class PrintJobsService {
  private readonly logger = new Logger(PrintJobsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly stations: PrintStationsService,
  ) {}

  /** Writes a QUEUED job; a NETWORK station's bytes leave at once, in the background. */
  async create(
    ctx: AuthContext,
    input: { station: PrintStation; tillId: number | null; payload: Buffer; labels: number },
  ): Promise<PrintJobView> {
    const [row] = await this.db
      .insert(printJobs)
      .values({
        stationId: input.station.id,
        tillId: input.tillId,
        payload: input.payload,
        labels: input.labels,
        createdBy: ctx.userId,
      })
      .returning();
    if (!row) throw new Error('print job not inserted');
    if (input.station.kind === 'NETWORK') {
      void this.sendNetwork(row.id, input.station).catch((error: unknown) => {
        this.logger.error({ err: error, jobId: row.id }, 'network print failed unexpectedly');
      });
    }
    return view(row);
  }

  /** A job as its maker (or the office) sees it; NOT_FOUND for anyone else's. */
  async get(ctx: AuthContext, id: number): Promise<PrintJobView> {
    await this.expire();
    const [row] = await this.db.select().from(printJobs).where(eq(printJobs.id, id));
    if (!row || (row.createdBy !== ctx.userId && !ctx.permissions.has(MANAGE))) {
      throw new PrintError('PRINT_JOB_NOT_FOUND', `print job ${id} not found`, { id });
    }
    return view(row);
  }

  /**
   * The bridge's long poll: the station's oldest waiting job, taken (PRINTING), or null after
   * about 25 seconds without one. `signal` ends the wait when the bridge hangs up.
   */
  async next(
    station: PrintStation,
    signal?: AbortSignal,
    waitMs: number = PRINT_LIMITS.longPollMs,
  ): Promise<{ id: number; labels: number; payload: Buffer } | null> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      await this.expire();
      const taken = await this.db.execute<{ id: string | number; labels: number; payload: Buffer }>(
        sql`UPDATE print_jobs SET status = 'PRINTING', picked_at = now()
            WHERE id = (
              SELECT id FROM print_jobs
              WHERE station_id = ${station.id} AND status = 'QUEUED'
              ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED
            )
            RETURNING id, labels, payload`,
      );
      const row = taken.rows[0];
      if (row?.payload) {
        return {
          id: Number.parseInt(String(row.id), 10),
          labels: row.labels,
          payload: row.payload,
        };
      }
      if (signal?.aborted || Date.now() >= deadline) return null;
      await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    }
  }

  /** The bridge's report on a job it took. */
  async finish(
    station: PrintStation,
    id: number,
    outcome: { ok: boolean; message?: string | null },
  ): Promise<PrintJobView> {
    const detail = outcome.message?.trim().slice(0, 400) || null;
    const [row] = await this.db
      .update(printJobs)
      .set({
        status: outcome.ok ? 'DONE' : 'FAILED',
        error: outcome.ok ? null : detail ? `PRINTER_REFUSED: ${detail}` : 'PRINTER_REFUSED',
        payload: null,
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(printJobs.id, id),
          eq(printJobs.stationId, station.id),
          eq(printJobs.status, 'PRINTING'),
        ),
      )
      .returning();
    if (!row) {
      throw new PrintError('PRINT_JOB_STATE', `print job ${id} is not being printed here`, { id });
    }
    return view(row);
  }

  /** Fails the jobs nobody took, or took and never reported, in time. */
  async expire(): Promise<void> {
    const cutoff = new Date(Date.now() - PRINT_LIMITS.pickupSeconds * 1000);
    const failed = {
      status: 'FAILED' as const,
      error: 'PRINTER_OFFLINE',
      payload: null,
      finishedAt: new Date(),
    };
    await this.db
      .update(printJobs)
      .set(failed)
      .where(and(eq(printJobs.status, 'QUEUED'), lt(printJobs.createdAt, cutoff)));
    await this.db
      .update(printJobs)
      .set(failed)
      .where(and(eq(printJobs.status, 'PRINTING'), lt(printJobs.pickedAt, cutoff)));
  }

  /** A NETWORK station's job: taken, written to host:port, reported. */
  private async sendNetwork(id: number, station: PrintStation): Promise<void> {
    const [taken] = await this.db
      .update(printJobs)
      .set({ status: 'PRINTING', pickedAt: new Date() })
      .where(and(eq(printJobs.id, id), eq(printJobs.status, 'QUEUED')))
      .returning();
    if (!taken?.payload || !station.host || !station.port) return;
    let error: string | null = null;
    try {
      await sendRaw(station.host, station.port, taken.payload, PRINT_LIMITS.socketTimeoutMs);
      await this.stations.touch(station.id);
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : 'unknown';
      error =
        cause instanceof RawSendError && cause.reason === 'TIMEOUT'
          ? `PRINTER_OFFLINE: ${message}`
          : `PRINTER_UNREACHABLE: ${message}`;
    }
    await this.db
      .update(printJobs)
      .set({
        status: error ? 'FAILED' : 'DONE',
        error: error?.slice(0, 500) ?? null,
        payload: null,
        finishedAt: new Date(),
      })
      .where(and(eq(printJobs.id, id), eq(printJobs.status, 'PRINTING')));
  }
}

function view(row: JobRow): PrintJobView {
  const [code, ...rest] = (row.error ?? '').split(': ');
  return {
    id: row.id,
    stationId: row.stationId,
    labels: row.labels,
    status: row.status,
    error: row.error ? (code ?? null) : null,
    detail: rest.length > 0 ? rest.join(': ') : null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}
