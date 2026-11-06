import { Inject, Injectable } from '@nestjs/common';
import { periodOf } from '@tugeel/shared/ebarimt-check';
import type { Decimal } from '@tugeel/shared/money';
import { and, eq } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, notFound } from '../../../common/errors/app-error';
import {
  actorUserId,
  type AuthContext,
  AuditService,
  StorageService,
  type StoredFile,
  UserNamesService,
} from '../../identity';
import { ebarimtCheckEntries, ebarimtCheckFiles } from '../schema';
import { EbarimtDataService, type EbarimtFileRow } from './ebarimt-data.service';
import { EbarimtHistoryService } from './ebarimt-history.service';
import { readEbarimtSheet } from './ebarimt-sheet';

const KIND = 'ebarimt.source';
const CHUNK = 500;

export interface EbarimtMonthFile {
  id: number;
  period: number;
  fileName: string;
  rowCount: number;
  vatAmount: Decimal;
  totalAmount: Decimal;
  uploadedAt: Date;
  uploadedByName: string | null;
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
    const latest = await this.data.allActivePeriods();
    return {
      months: periods.map((period) => {
        const file = files.get(period);
        return { period, file: file ? this.toMonthFile(file, names) : null };
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
          .set({ status: 'REPLACED', closedBy: actorUserId(ctx), closedAt: new Date() })
          .where(eq(ebarimtCheckFiles.id, previous.id));
      }
      const [file] = await tx
        .insert(ebarimtCheckFiles)
        .values({
          period: sheet.period,
          fileId: input.fileId,
          fileName: input.fileName,
          rowCount: sheet.rows.length,
          vatAmount: sheet.vatAmount,
          totalAmount: sheet.totalAmount,
          uploadedBy: actorUserId(ctx),
        })
        .returning();
      if (!file) throw new Error('the file row did not return');
      for (let start = 0; start < sheet.rows.length; start += CHUNK) {
        await tx
          .insert(ebarimtCheckEntries)
          .values(
            sheet.rows
              .slice(start, start + CHUNK)
              .map((row) => ({ ...row, ebarimtFileId: file.id })),
          );
      }
      await this.history.syncEbarimt(
        tx,
        ctx,
        sheet.period,
        earlier ? 'FILE' : 'INIT',
        input.fileName,
      );
      await this.audit.record(tx, ctx, {
        action: previous ? 'UPDATE' : 'CREATE',
        entity: 'ebarimt_check_files',
        entityId: file.id,
        before: previous
          ? { id: previous.id, fileName: previous.fileName, rowCount: previous.rowCount }
          : null,
        after: { period: file.period, fileName: file.fileName, rowCount: file.rowCount },
      });
      return { file, replacedRowCount: previous?.rowCount ?? null };
    });
    const names = await this.userNames.namesOf([actorUserId(ctx)].flatMap((id) => id ?? []));
    return {
      ...this.toMonthFile(result.file, names),
      replacedRowCount: result.replacedRowCount,
    };
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
    if (!row) throw notFound('ebarimt file', id);
    const opened = await this.storage.openPrivate(row.fileId, KIND);
    return { ...opened, fileName: row.fileName };
  }

  private toMonthFile(file: EbarimtFileRow, names: Map<number, string>): EbarimtMonthFile {
    return {
      id: file.id,
      period: file.period,
      fileName: file.fileName,
      rowCount: file.rowCount,
      vatAmount: file.vatAmount,
      totalAmount: file.totalAmount,
      uploadedAt: file.uploadedAt,
      uploadedByName: file.uploadedBy === null ? null : (names.get(file.uploadedBy) ?? null),
    };
  }
}
