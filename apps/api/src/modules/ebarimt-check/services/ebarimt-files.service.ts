import { Inject, Injectable } from '@nestjs/common';
import { type EbarimtFileSource, periodOf } from '@tugeel/shared/ebarimt-check';
import type { Decimal } from '@tugeel/shared/money';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  StorageService,
  type StoredFile,
  UserNamesService,
} from '../../identity';
import { ebarimtCheckEntries, ebarimtCheckFiles } from '../schema';
import { EbarimtDataService, type EbarimtFileRow } from './ebarimt-data.service';
import { EBARIMT_SYNC_LOCK, EbarimtHistoryService } from './ebarimt-history.service';
import { type EbarimtSheet, type EbarimtSheetRow, readEbarimtSheet } from './ebarimt-sheet';

const KIND = 'ebarimt.source';
const CHUNK = 500;

export interface EbarimtMonthFile {
  id: number;
  period: number;
  /** An Excel export uploaded, or a pull from e-Barimt's API (ADR-0228). */
  source: EbarimtFileSource;
  fileName: string;
  rowCount: number;
  vatAmount: Decimal;
  totalAmount: Decimal;
  uploadedAt: Date;
  uploadedByName: string | null;
  /** Lines whose seller's register came hidden by stars. */
  maskedCount: number;
}

export interface EbarimtFileOverview {
  /** The months asked for, each with its file or null: last December and the year's twelve. */
  months: { period: number; file: EbarimtMonthFile | null }[];
  /** The latest month holding a file, whatever the year. */
  latestPeriod: number | null;
}

export interface EbarimtImportResult extends EbarimtMonthFile {
  /** The rows of the file it replaced; null when the month had none. */
  replacedRowCount: number | null;
}

/** What a pull did to its month: a new file, or none because nothing differed (ADR-0228). */
export interface EbarimtPulledMonth {
  period: number;
  changed: boolean;
  /** The month's file now; null when the pull found nothing and the month had none. */
  fileId: number | null;
}

/** A line as two versions of a month are compared: everything but its place in the list. */
function lineSignature(row: Omit<EbarimtSheetRow, 'rowNo'>): string {
  return [
    row.receiptKey,
    row.ddtd ?? '',
    row.deliveryNoteNo ?? '',
    row.docDate,
    row.partnerName ?? '',
    row.ttd,
    row.vatAmount.toFixed(2),
    row.netAmount.toFixed(2),
    row.totalAmount.toFixed(2),
    row.kind ?? '',
  ].join('\u0001');
}

function sameLines(
  a: readonly Omit<EbarimtSheetRow, 'rowNo'>[],
  b: readonly Omit<EbarimtSheetRow, 'rowNo'>[],
): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(lineSignature).sort();
  const right = b.map(lineSignature).sort();
  return left.every((signature, index) => signature === right[index]);
}

/**
 * e-Barimt's file, one per month (owner 2026-11-07, ADR-0168). The month comes from the file's own
 * dates, so it cannot land in the wrong one; a new file for a month replaces the old, which stays.
 */
@Injectable()
export class EbarimtFilesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly userNames: UserNamesService,
    private readonly data: EbarimtDataService,
    private readonly history: EbarimtHistoryService,
  ) {}

  async overview(year: number): Promise<EbarimtFileOverview> {
    const periods = [
      periodOf(year - 1, 12),
      ...Array.from({ length: 12 }, (_, index) => periodOf(year, index + 1)),
    ];
    const files = await this.data.activeFiles(periods);
    const names = await this.userNames.namesOf(
      [...files.values()].flatMap((file) => (file.uploadedBy === null ? [] : [file.uploadedBy])),
    );
    const masked = await this.maskedCounts([...files.values()].map((file) => file.id));
    const latest = await this.data.allActivePeriods();
    return {
      months: periods.map((period) => {
        const file = files.get(period);
        return { period, file: file ? this.toMonthFile(file, names, masked) : null };
      }),
      latestPeriod: latest[0] ?? null,
    };
  }

  async importFile(
    ctx: AuthContext,
    input: { fileId: number; fileName: string },
  ): Promise<EbarimtImportResult> {
    const { body } = await this.storage.openUploaded(input.fileId, KIND);
    // Read before any transaction: a file refused here stays a pending upload and is cleaned up.
    const sheet = await readEbarimtSheet(body);
    const result = await inTransaction(this.db, async (tx) => {
      await this.storage.confirm(tx, input.fileId, KIND);
      return this.storeMonth(tx, ctx, sheet, {
        source: 'FILE',
        fileId: input.fileId,
        fileName: input.fileName,
      });
    });
    const names = await this.userNames.namesOf([actorUserId(ctx)].flatMap((id) => id ?? []));
    const masked = await this.maskedCounts([result.file.id]);
    return {
      ...this.toMonthFile(result.file, names, masked),
      replacedRowCount: result.replacedRowCount,
    };
  }

  /**
   * A month pulled from e-Barimt's API (ADR-0228): written as an upload is, as a file of source API
   * with no stored object, and only when its lines differ from the month's file in force, so an
   * unchanged night adds no file and no history. A pull that found nothing writes nothing: an empty
   * answer never takes a month's receipts away.
   */
  async storePulled(
    actor: Actor,
    sheet: EbarimtSheet,
    fileName: string,
  ): Promise<EbarimtPulledMonth> {
    return inTransaction(this.db, async (tx) => {
      // A pull and an upload of one month take their turns, so neither replaces a file it never saw.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${EBARIMT_SYNC_LOCK}, ${sheet.period})`);
      const [active] = await tx
        .select()
        .from(ebarimtCheckFiles)
        .where(
          and(eq(ebarimtCheckFiles.period, sheet.period), eq(ebarimtCheckFiles.status, 'ACTIVE')),
        );
      if (sheet.rows.length === 0) {
        return { period: sheet.period, changed: false, fileId: active?.id ?? null };
      }
      if (active) {
        const lines = await this.data.entriesOf([active.id], tx);
        if (sameLines(lines, sheet.rows)) {
          return { period: sheet.period, changed: false, fileId: active.id };
        }
      }
      const stored = await this.storeMonth(tx, actor, sheet, {
        source: 'API',
        fileId: null,
        fileName,
      });
      return { period: sheet.period, changed: true, fileId: stored.file.id };
    });
  }

  /**
   * Puts a month's lines in force as its new file, the one before it REPLACED, and notes what moved
   * in each supplier's e-Barimt total. In the caller's transaction.
   */
  private async storeMonth(
    tx: Tx,
    actor: Actor,
    sheet: EbarimtSheet,
    origin: { source: EbarimtFileSource; fileId: number | null; fileName: string },
  ): Promise<{ file: EbarimtFileRow; replacedRowCount: number | null }> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${EBARIMT_SYNC_LOCK}, ${sheet.period})`);
    // A month that ever held a file has had its first reading, even if it matched nobody.
    const [earlier] = await tx
      .select({ id: ebarimtCheckFiles.id })
      .from(ebarimtCheckFiles)
      .where(eq(ebarimtCheckFiles.period, sheet.period))
      .limit(1);
    const [previous] = await tx
      .select()
      .from(ebarimtCheckFiles)
      .where(
        and(eq(ebarimtCheckFiles.period, sheet.period), eq(ebarimtCheckFiles.status, 'ACTIVE')),
      )
      .for('update');
    if (previous) {
      await tx
        .update(ebarimtCheckFiles)
        .set({ status: 'REPLACED', closedBy: actorUserId(actor), closedAt: new Date() })
        .where(eq(ebarimtCheckFiles.id, previous.id));
    }
    const [file] = await tx
      .insert(ebarimtCheckFiles)
      .values({
        period: sheet.period,
        fileId: origin.fileId,
        source: origin.source,
        fileName: origin.fileName,
        rowCount: sheet.rows.length,
        vatAmount: sheet.vatAmount,
        totalAmount: sheet.totalAmount,
        uploadedBy: actorUserId(actor),
      })
      .returning();
    if (!file) throw new Error('the file row did not return');
    for (let start = 0; start < sheet.rows.length; start += CHUNK) {
      await tx
        .insert(ebarimtCheckEntries)
        .values(
          sheet.rows.slice(start, start + CHUNK).map((row) => ({ ...row, ebarimtFileId: file.id })),
        );
    }
    await this.history.syncEbarimt(
      tx,
      actor,
      sheet.period,
      earlier ? 'FILE' : 'INIT',
      origin.fileName,
    );
    await this.audit.record(tx, actor, {
      action: previous ? 'UPDATE' : 'CREATE',
      entity: 'ebarimt_check_files',
      entityId: file.id,
      before: previous
        ? { id: previous.id, fileName: previous.fileName, rowCount: previous.rowCount }
        : null,
      after: {
        period: file.period,
        source: file.source,
        fileName: file.fileName,
        rowCount: file.rowCount,
      },
    });
    return { file, replacedRowCount: previous?.rowCount ?? null };
  }

  /**
   * Takes a month's file out of force; its rows stay, and its links wait for a new file. `fileId`
   * is the file the person saw: a colleague's newer one stays, and they are told.
   */
  async remove(ctx: AuthContext, period: number, fileId: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [file] = await tx
        .select()
        .from(ebarimtCheckFiles)
        .where(and(eq(ebarimtCheckFiles.period, period), eq(ebarimtCheckFiles.status, 'ACTIVE')))
        .for('update');
      if (!file) throw notFound('ebarimt file of period', period);
      if (file.id !== fileId) {
        throw new AppError('EBARIMT_FILE_CHANGED', 'a newer file stands in this month', {
          name: file.fileName,
        });
      }
      await tx
        .update(ebarimtCheckFiles)
        .set({ status: 'REMOVED', closedBy: actorUserId(ctx), closedAt: new Date() })
        .where(eq(ebarimtCheckFiles.id, file.id));
      await this.history.syncEbarimt(tx, ctx, period, 'REMOVE', file.fileName);
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'ebarimt_check_files',
        entityId: file.id,
        before: { period, fileName: file.fileName, rowCount: file.rowCount },
        after: null,
      });
    });
  }

  /** The file as uploaded, any version. */
  async open(id: number): Promise<{ file: StoredFile; body: Readable; fileName: string }> {
    const [row] = await this.db
      .select()
      .from(ebarimtCheckFiles)
      .where(eq(ebarimtCheckFiles.id, id));
    // A pull from the API has no file to give back.
    if (!row || row.fileId === null) throw notFound('ebarimt file', id);
    const opened = await this.storage.openPrivate(row.fileId, KIND);
    return { ...opened, fileName: row.fileName };
  }

  /** Per file, its lines whose seller's register came hidden by stars. */
  private async maskedCounts(fileIds: readonly number[]): Promise<Map<number, number>> {
    if (fileIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        fileId: ebarimtCheckEntries.ebarimtFileId,
        count: sql<number>`count(*)::int`,
      })
      .from(ebarimtCheckEntries)
      .where(
        and(
          inArray(ebarimtCheckEntries.ebarimtFileId, [...fileIds]),
          sql`strpos(${ebarimtCheckEntries.ttd}, '*') > 0`,
        ),
      )
      .groupBy(ebarimtCheckEntries.ebarimtFileId);
    return new Map(rows.map((row) => [row.fileId, row.count]));
  }

  private toMonthFile(
    file: EbarimtFileRow,
    names: Map<number, string>,
    masked: Map<number, number>,
  ): EbarimtMonthFile {
    return {
      id: file.id,
      period: file.period,
      source: file.source,
      fileName: file.fileName,
      rowCount: file.rowCount,
      vatAmount: file.vatAmount,
      totalAmount: file.totalAmount,
      uploadedAt: file.uploadedAt,
      uploadedByName: file.uploadedBy === null ? null : (names.get(file.uploadedBy) ?? null),
      maskedCount: masked.get(file.id) ?? 0,
    };
  }
}
