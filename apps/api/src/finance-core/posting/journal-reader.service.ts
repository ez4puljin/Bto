import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb } from '../db/fin-db';
import {
  finAccounts,
  finJournalEntries,
  finJournalLines,
  finMoneyAccounts,
  finSourceSystems,
} from '../schema';

/** Where an entry came from: its source system and document type (null: typed, no document). */
export interface FinEntryOrigin {
  system: string;
  /** undefined: any; null: entries without a source document; a list: any of them. */
  docType?: string | null | readonly string[];
  /** true: reversals only; false: no reversals; undefined: both. */
  reversal?: boolean;
}

export interface FinEntrySummary {
  id: number;
  number: string;
  entryDate: string;
  description: string;
  system: string;
  sourceDocType: string | null;
  sourceDocId: string | null;
  reversesId: number | null;
  /** The intake document the entry books (F2); null for a façade entry (POS until H2). */
  documentId: number | null;
  actor: { kind: 'STAFF' | 'SOURCE' | 'SYSTEM'; ref: string; label: string };
  postedAt: Date;
  /** Σ debit (= Σ credit). */
  amount: Decimal;
  lineCount: number;
}

export interface FinEntryLine {
  id: number;
  lineNo: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: Decimal;
  credit: Decimal;
  partyId: string | null;
  moneyAccountId: number | null;
  moneyAccountName: string | null;
  postingKey: string | null;
  description: string | null;
}

export interface FinEntryDetail extends FinEntrySummary {
  lines: FinEntryLine[];
}

export interface FinLedgerRow {
  id: number;
  entryId: number;
  entryNumber: string;
  entryDate: string;
  entryDescription: string;
  system: string;
  sourceDocType: string | null;
  reversesId: number | null;
  lineNo: number;
  debit: Decimal;
  credit: Decimal;
  partyId: string | null;
  description: string | null;
  /** Debit − credit of the account after this line, oldest first. */
  balanceAfter: Decimal;
}

/**
 * The journal's reads (F1, ADR-0089): entries newest first with keyset pages, one entry with its
 * lines, an account's ledger with a running balance, and the turnover of every account. Read by any
 * granted source or a user with `finance.read` in the company. It lives beside the posting code
 * because only `finance-core/posting/**` may name the journal tables (ESLint G2).
 */
@Injectable()
export class FinJournalReader {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  /** `limit + 1` rows at most, newest first by (date, id), after the keyset `after`. */
  async entries(
    ctx: FinCallContext,
    query: {
      company: string;
      from?: string;
      to?: string;
      origin?: FinEntryOrigin;
      accountId?: number;
      partyId?: string;
      after?: { date: string; id: number };
      limit: number;
    },
  ): Promise<FinEntrySummary[]> {
    const scope = await this.scope(this.db, ctx, query.company);
    const filters: SQL[] = [eq(finJournalEntries.companyId, scope.companyId)];
    if (query.from) filters.push(sql`${finJournalEntries.entryDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${finJournalEntries.entryDate} <= ${query.to}`);
    if (query.origin) {
      const [system] = await this.db
        .select({ id: finSourceSystems.id })
        .from(finSourceSystems)
        .where(
          and(
            eq(finSourceSystems.tenantId, scope.tenantId),
            eq(finSourceSystems.code, query.origin.system),
          ),
        );
      if (!system) return [];
      filters.push(...originFilters(system.id, query.origin));
    }
    const lineFilter = (condition: SQL) =>
      exists(
        this.db
          .select({ one: sql`1` })
          .from(finJournalLines)
          .where(
            and(
              eq(finJournalLines.companyId, finJournalEntries.companyId),
              eq(finJournalLines.entryId, finJournalEntries.id),
              condition,
            ),
          ),
      );
    if (query.accountId !== undefined) {
      filters.push(lineFilter(eq(finJournalLines.accountId, query.accountId)));
    }
    if (query.partyId !== undefined) {
      filters.push(lineFilter(eq(finJournalLines.partyId, Number.parseInt(query.partyId, 10))));
    }
    if (query.after) {
      filters.push(
        sql`(${finJournalEntries.entryDate}, ${finJournalEntries.id}) < (${query.after.date}::date, ${query.after.id}::bigint)`,
      );
    }
    const rows = await this.summaryQuery(this.db)
      .where(and(...filters))
      .orderBy(desc(finJournalEntries.entryDate), desc(finJournalEntries.id))
      .limit(query.limit + 1);
    return rows.map(toSummary);
  }

  async entry(
    ctx: FinCallContext,
    query: { company: string; id: number },
    executor: FinExecutor = this.db,
  ): Promise<FinEntryDetail | null> {
    const companyId = await this.companyId(executor, ctx, query.company);
    const [row] = await this.summaryQuery(executor).where(
      and(eq(finJournalEntries.companyId, companyId), eq(finJournalEntries.id, query.id)),
    );
    if (!row) return null;
    const lines = await executor
      .select({
        line: finJournalLines,
        accountCode: finAccounts.code,
        accountName: finAccounts.name,
        moneyAccountName: finMoneyAccounts.name,
      })
      .from(finJournalLines)
      .innerJoin(
        finAccounts,
        and(
          eq(finAccounts.companyId, finJournalLines.companyId),
          eq(finAccounts.id, finJournalLines.accountId),
        ),
      )
      .leftJoin(
        finMoneyAccounts,
        and(
          eq(finMoneyAccounts.companyId, finJournalLines.companyId),
          eq(finMoneyAccounts.id, finJournalLines.moneyAccountId),
        ),
      )
      .where(and(eq(finJournalLines.companyId, companyId), eq(finJournalLines.entryId, query.id)))
      .orderBy(asc(finJournalLines.lineNo));
    return {
      ...toSummary(row),
      lines: lines.map(({ line, accountCode, accountName, moneyAccountName }) => ({
        id: line.id,
        lineNo: line.lineNo,
        accountId: line.accountId,
        accountCode,
        accountName,
        debit: line.debit,
        credit: line.credit,
        partyId: line.partyId === null ? null : String(line.partyId),
        moneyAccountId: line.moneyAccountId,
        moneyAccountName,
        postingKey: line.postingKey,
        description: line.description,
      })),
    };
  }

  /** The numbers of these entries, by id. */
  async numbers(
    ctx: FinCallContext,
    query: { company: string; ids: readonly number[] },
    executor: FinExecutor = this.db,
  ): Promise<Map<number, string>> {
    const ids = [...new Set(query.ids)];
    if (ids.length === 0) return new Map();
    const companyId = await this.companyId(executor, ctx, query.company);
    const rows = await executor
      .select({ id: finJournalEntries.id, number: finJournalEntries.number })
      .from(finJournalEntries)
      .where(and(eq(finJournalEntries.companyId, companyId), inArray(finJournalEntries.id, ids)));
    return new Map(rows.map((row) => [row.id, row.number]));
  }

  /** The reversal of each of these entries that has one, by the original's id. */
  async reversals(
    ctx: FinCallContext,
    query: { company: string; ids: readonly number[] },
    executor: FinExecutor = this.db,
  ): Promise<Map<number, { id: number; number: string }>> {
    const ids = [...new Set(query.ids)];
    if (ids.length === 0) return new Map();
    const companyId = await this.companyId(executor, ctx, query.company);
    const rows = await executor
      .select({
        reversesId: finJournalEntries.reversesId,
        id: finJournalEntries.id,
        number: finJournalEntries.number,
      })
      .from(finJournalEntries)
      .where(
        and(eq(finJournalEntries.companyId, companyId), inArray(finJournalEntries.reversesId, ids)),
      );
    return new Map(
      rows.flatMap((row) =>
        row.reversesId === null ? [] : [[row.reversesId, { id: row.id, number: row.number }]],
      ),
    );
  }

  /** Σ debit and Σ credit of every account with lines dated up to `asOf`, by account id. */
  async accountTotals(
    ctx: FinCallContext,
    query: { company: string; asOf: string },
  ): Promise<Map<number, { debit: Decimal; credit: Decimal }>> {
    const companyId = await this.companyId(this.db, ctx, query.company);
    const rows = await this.db
      .select({
        accountId: finJournalLines.accountId,
        debit: sql<string>`sum(${finJournalLines.debit})`,
        credit: sql<string>`sum(${finJournalLines.credit})`,
      })
      .from(finJournalLines)
      .innerJoin(
        finJournalEntries,
        and(
          eq(finJournalEntries.companyId, finJournalLines.companyId),
          eq(finJournalEntries.id, finJournalLines.entryId),
        ),
      )
      .where(
        and(eq(finJournalLines.companyId, companyId), lte(finJournalEntries.entryDate, query.asOf)),
      )
      .groupBy(finJournalLines.accountId);
    return new Map(
      rows.map((row) => [
        row.accountId,
        { debit: new Decimal(row.debit), credit: new Decimal(row.credit) },
      ]),
    );
  }

  /**
   * An account's lines newest first with the balance after each (`limit + 1` rows at most, after
   * the keyset `after`), and the balance before `from` (0 without `from`).
   */
  async accountLedger(
    ctx: FinCallContext,
    query: {
      company: string;
      accountId: number;
      from?: string;
      to?: string;
      after?: { date: string; entryId: number; lineNo: number };
      limit: number;
    },
  ): Promise<{ rows: FinLedgerRow[]; opening: Decimal }> {
    const companyId = await this.companyId(this.db, ctx, query.company);
    const running = this.db
      .select({
        id: finJournalLines.id,
        entryId: finJournalLines.entryId,
        entryNumber: finJournalEntries.number,
        entryDate: finJournalEntries.entryDate,
        entryDescription: sql<string>`${finJournalEntries.description}`.as('entry_description'),
        system: sql<string>`${finSourceSystems.code}`.as('system'),
        sourceDocType: finJournalEntries.sourceDocType,
        reversesId: finJournalEntries.reversesId,
        lineNo: finJournalLines.lineNo,
        debit: finJournalLines.debit,
        credit: finJournalLines.credit,
        partyId: finJournalLines.partyId,
        description: sql<string | null>`${finJournalLines.description}`.as('line_description'),
        balanceAfter:
          sql<string>`sum(${finJournalLines.debit} - ${finJournalLines.credit}) OVER (ORDER BY ${finJournalEntries.entryDate}, ${finJournalEntries.id}, ${finJournalLines.lineNo})`.as(
            'balance_after',
          ),
      })
      .from(finJournalLines)
      .innerJoin(
        finJournalEntries,
        and(
          eq(finJournalEntries.companyId, finJournalLines.companyId),
          eq(finJournalEntries.id, finJournalLines.entryId),
        ),
      )
      .innerJoin(finSourceSystems, eq(finSourceSystems.id, finJournalEntries.sourceSystemId))
      .where(
        and(
          eq(finJournalLines.companyId, companyId),
          eq(finJournalLines.accountId, query.accountId),
        ),
      )
      .as('running');
    const filters: SQL[] = [];
    if (query.from) filters.push(sql`${running.entryDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${running.entryDate} <= ${query.to}`);
    if (query.after) {
      filters.push(
        sql`(${running.entryDate}, ${running.entryId}, ${running.lineNo}) < (${query.after.date}::date, ${query.after.entryId}::bigint, ${query.after.lineNo}::smallint)`,
      );
    }
    const rows = await this.db
      .select()
      .from(running)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(running.entryDate), desc(running.entryId), desc(running.lineNo))
      .limit(query.limit + 1);
    let opening = new Decimal(0);
    if (query.from) {
      const [before] = await this.db
        .select({
          balance: sql<string>`coalesce(sum(${finJournalLines.debit} - ${finJournalLines.credit}), 0)`,
        })
        .from(finJournalLines)
        .innerJoin(
          finJournalEntries,
          and(
            eq(finJournalEntries.companyId, finJournalLines.companyId),
            eq(finJournalEntries.id, finJournalLines.entryId),
          ),
        )
        .where(
          and(
            eq(finJournalLines.companyId, companyId),
            eq(finJournalLines.accountId, query.accountId),
            sql`${finJournalEntries.entryDate} < ${query.from}`,
          ),
        );
      opening = new Decimal(before?.balance ?? 0);
    }
    return {
      rows: rows.map((row) => ({
        ...row,
        partyId: row.partyId === null ? null : String(row.partyId),
        balanceAfter: new Decimal(row.balanceAfter),
      })),
      opening,
    };
  }

  private scope(executor: FinExecutor, ctx: FinCallContext, company: string) {
    return resolveCompany(executor, ctx, company, { source: true, userAnyOf: ['finance.read'] });
  }

  private async companyId(executor: FinExecutor, ctx: FinCallContext, company: string) {
    return (await this.scope(executor, ctx, company)).companyId;
  }

  private summaryQuery(executor: FinExecutor) {
    return executor
      .select({
        entry: finJournalEntries,
        system: finSourceSystems.code,
        amount: sql<string>`(SELECT coalesce(sum(l.debit), 0) FROM fin.journal_lines l
          WHERE l.company_id = ${finJournalEntries.companyId} AND l.entry_id = ${finJournalEntries.id})`,
        lineCount: sql<string>`(SELECT count(*) FROM fin.journal_lines l
          WHERE l.company_id = ${finJournalEntries.companyId} AND l.entry_id = ${finJournalEntries.id})`,
      })
      .from(finJournalEntries)
      .innerJoin(finSourceSystems, eq(finSourceSystems.id, finJournalEntries.sourceSystemId))
      .$dynamic();
  }
}

function originFilters(systemId: number, origin: FinEntryOrigin): SQL[] {
  const filters: SQL[] = [eq(finJournalEntries.sourceSystemId, systemId)];
  if (origin.docType === null) filters.push(isNull(finJournalEntries.sourceDocType));
  else if (Array.isArray(origin.docType)) {
    filters.push(inArray(finJournalEntries.sourceDocType, [...origin.docType]));
  } else if (typeof origin.docType === 'string') {
    filters.push(eq(finJournalEntries.sourceDocType, origin.docType));
  }
  if (origin.reversal === true) filters.push(isNotNull(finJournalEntries.reversesId));
  if (origin.reversal === false) filters.push(isNull(finJournalEntries.reversesId));
  return filters;
}

function toSummary(row: {
  entry: typeof finJournalEntries.$inferSelect;
  system: string;
  amount: string;
  lineCount: string;
}): FinEntrySummary {
  const { entry } = row;
  return {
    id: entry.id,
    number: entry.number,
    entryDate: entry.entryDate,
    description: entry.description,
    system: row.system,
    sourceDocType: entry.sourceDocType,
    sourceDocId: entry.sourceDocId,
    reversesId: entry.reversesId,
    documentId: entry.documentId,
    actor: { kind: entry.actorKind, ref: entry.actorRef, label: entry.actorLabel },
    postedAt: entry.postedAt,
    amount: new Decimal(row.amount),
    lineCount: Number.parseInt(row.lineCount, 10),
  };
}
