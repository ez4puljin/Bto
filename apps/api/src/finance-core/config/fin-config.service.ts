import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import { type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb, type FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import type { FinDocumentClass } from '../posting/intake-command';
import { finDocumentTypes, finNumberSeries, finSourceSystems } from '../schema';

export interface FinNumberSeriesView {
  code: string;
  pattern: string;
  digits: number;
  updatedAt: Date;
}

export interface FinDocumentTypeInput {
  company: string;
  code: string;
  system: string;
  class: FinDocumentClass;
  numberMode: 'SOURCE' | 'CORE';
  numberSeries: string | null;
}

const PATTERN_TOKENS = /\{([a-z]+)\}/g;

/**
 * The configuration port (docs/modules/finance-core.md §8), as far as F2 needs it (ADR-0090): the
 * number series a company's documents and entries are numbered from, and its document types.
 * Changes are audited; a user needs `finance.settings.manage` for the series (Bto's number-format
 * page) and `finance.config.manage` for the types.
 */
@Injectable()
export class FinConfig {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  async numberSeries(
    ctx: FinCallContext,
    query: { company: string },
    executor: FinExecutor = this.db,
  ): Promise<FinNumberSeriesView[]> {
    const scope = await resolveCompany(executor, ctx, query.company, {
      source: true,
      userAnyOf: ['finance.read', 'finance.settings.manage'],
    });
    return executor
      .select({
        code: finNumberSeries.code,
        pattern: finNumberSeries.pattern,
        digits: finNumberSeries.digits,
        updatedAt: finNumberSeries.updatedAt,
      })
      .from(finNumberSeries)
      .where(eq(finNumberSeries.companyId, scope.companyId))
      .orderBy(asc(finNumberSeries.code));
  }

  /** Changes a series' format; the counters keep counting per rendered prefix. */
  async setNumberSeriesInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; code: string; pattern: string; digits: number },
  ): Promise<void> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: ['finance.settings.manage', 'finance.config.manage'],
    });
    const pattern = input.pattern.trim();
    const tokens = [...pattern.matchAll(PATTERN_TOKENS)].map((match) => match[1] ?? '');
    if (
      pattern.length < 1 ||
      pattern.length > 24 ||
      /[0-9}]$/.test(pattern) ||
      tokens.some((token) => !['year', 'month', 'day'].includes(token))
    ) {
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'pattern' });
    }
    if (!Number.isInteger(input.digits) || input.digits < 1 || input.digits > 8) {
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'digits' });
    }
    const [before] = await tx
      .select({ pattern: finNumberSeries.pattern, digits: finNumberSeries.digits })
      .from(finNumberSeries)
      .where(
        and(eq(finNumberSeries.companyId, scope.companyId), eq(finNumberSeries.code, input.code)),
      )
      .for('update');
    if (!before) throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'code' });
    if (before.pattern === pattern && before.digits === input.digits) return;
    await tx
      .update(finNumberSeries)
      .set({ pattern, digits: input.digits, updatedAt: sql`now()` })
      .where(
        and(eq(finNumberSeries.companyId, scope.companyId), eq(finNumberSeries.code, input.code)),
      );
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'UPDATE',
      entity: 'number_series',
      entityId: input.code,
      before,
      after: { pattern, digits: input.digits },
    });
  }

  /** Adds a series or a document type (tests, a new source); an existing one is left as it is. */
  async ensureNumberSeriesInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; code: string; pattern: string; digits: number },
  ): Promise<void> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: ['finance.config.manage'],
    });
    await tx
      .insert(finNumberSeries)
      .values({
        companyId: scope.companyId,
        code: input.code,
        pattern: input.pattern,
        digits: input.digits,
      })
      .onConflictDoNothing();
  }

  async upsertDocumentTypeInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: FinDocumentTypeInput,
  ): Promise<void> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: ['finance.config.manage'],
    });
    const [system] = await tx
      .select({ id: finSourceSystems.id })
      .from(finSourceSystems)
      .where(
        and(eq(finSourceSystems.tenantId, scope.tenantId), eq(finSourceSystems.code, input.system)),
      );
    if (!system) throw new FinError('FIN_SOURCE_NOT_GRANTED', undefined, { system: input.system });
    const inserted = await tx
      .insert(finDocumentTypes)
      .values({
        companyId: scope.companyId,
        code: input.code,
        sourceSystemId: system.id,
        class: input.class,
        numberMode: input.numberMode,
        numberSeries: input.numberSeries,
      })
      .onConflictDoNothing({ target: [finDocumentTypes.companyId, finDocumentTypes.code] })
      .returning({ id: finDocumentTypes.id });
    if (inserted[0]) {
      await recordFinAudit(tx, ctx, {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        action: 'CREATE',
        entity: 'document_type',
        entityId: input.code,
        after: input,
      });
    }
  }
}
