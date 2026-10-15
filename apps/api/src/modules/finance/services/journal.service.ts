import { Inject, Injectable } from '@nestjs/common';
import { FINANCE_LIMITS, type FinanceDocKind, type JournalSource } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  type Actor,
  actorUserId,
  AuditService,
  type AuthContext,
  UserNamesService,
} from '../../identity';
import { CustomersService } from '../../partners';
import {
  creditNotes,
  glAccounts,
  invoices,
  journalEntries,
  journalLines,
  moneyAccounts,
  payments,
} from '../schema';
import { FinanceSettingsService } from './finance-settings.service';
import { GlAccountsService } from './gl-accounts.service';

export interface JournalLineInput {
  accountId: number;
  debit: Decimal;
  credit: Decimal;
  customerId?: number | null;
  moneyAccountId?: number | null;
  description?: string | null;
}

export interface JournalEntryInput {
  entryDate: string;
  description: string;
  source: JournalSource;
  sourceType?: FinanceDocKind | null;
  sourceId?: number | null;
  reversesId?: number | null;
  lines: readonly JournalLineInput[];
}

export interface JournalEntryRef {
  id: number;
  number: string;
}

export interface JournalEntrySummary {
  id: number;
  number: string;
  entryDate: string;
  description: string;
  source: JournalSource;
  sourceType: FinanceDocKind | null;
  sourceId: number | null;
  sourceNumber: string | null;
  reversesId: number | null;
  reversesNumber: string | null;
  reversedById: number | null;
  reversedByNumber: string | null;
  /** Σ debit (= Σ credit). */
  amount: Decimal;
  lineCount: number;
  postedByName: string | null;
  createdAt: Date;
}

export interface JournalLineView {
  id: number;
  lineNo: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: Decimal;
  credit: Decimal;
  customerId: number | null;
  customerName: string | null;
  moneyAccountId: number | null;
  moneyAccountName: string | null;
  description: string | null;
}

export interface JournalEntryDetail extends JournalEntrySummary {
  lines: JournalLineView[];
}

export interface JournalQuery {
  from?: string;
  to?: string;
  source?: JournalSource;
  accountId?: number;
  customerId?: number;
  cursor?: string;
  limit?: number;
}

export interface AccountLedgerLine {
  id: number;
  entryId: number;
  entryNumber: string;
  entryDate: string;
  entryDescription: string;
  source: JournalSource;
  lineNo: number;
  debit: Decimal;
  credit: Decimal;
  customerId: number | null;
  customerName: string | null;
  description: string | null;
  /** Debit − credit of the account after this line, oldest first. */
  balanceAfter: Decimal;
}

export interface AccountLedgerQuery {
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface AccountLedgerPage {
  data: AccountLedgerLine[];
  nextCursor: string | null;
  /** Debit − credit before `from` (0 without `from`). */
  opening: Decimal;
}

const MONEY_SCALE = 2;

/**
 * The general journal (ADR-0060 #7): numbered, balanced, append-only entries; the automatic ones
 * from documents, the manual ones from the accountant. An entry is never changed; a correction is
 * a reversing entry that names it. Σ debit = Σ credit is checked here and again by the database
 * at commit (0026, `journal_entry_balanced`).
 */
@Injectable()
export class JournalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: FinanceSettingsService,
    private readonly accounts: GlAccountsService,
    private readonly customers: CustomersService,
    private readonly names: UserNamesService,
  ) {}

  /** Posts an entry inside the caller's transaction; 422 JOURNAL_UNBALANCED when Σ differ. */
  async post(tx: Tx, actor: Actor, input: JournalEntryInput): Promise<JournalEntryRef> {
    const lines = input.lines;
    if (lines.length < 2) throw invalid('lines', 'min', 'an entry has at least two lines');
    if (lines.length > FINANCE_LIMITS.maxJournalLines) {
      throw invalid('lines', 'max', `at most ${FINANCE_LIMITS.maxJournalLines} lines`);
    }
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    lines.forEach((line, index) => {
      const path = `lines[${index}]`;
      for (const [side, value] of [
        ['debit', line.debit],
        ['credit', line.credit],
      ] as const) {
        if (value.isNegative() || value.decimalPlaces() > MONEY_SCALE) {
          throw invalid(`${path}.${side}`, 'money', 'a non-negative amount with 2 decimals');
        }
      }
      if (line.debit.isZero() === line.credit.isZero()) {
        throw invalid(path, 'oneSide', 'a line is either a debit or a credit');
      }
      debit = debit.plus(line.debit);
      credit = credit.plus(line.credit);
    });
    if (!debit.eq(credit)) {
      throw new AppError('JOURNAL_UNBALANCED', 'the debits and the credits differ', {
        debit: debit.toFixed(MONEY_SCALE),
        credit: credit.toFixed(MONEY_SCALE),
      });
    }
    await this.accounts.activeByIds(
      lines.map((line) => line.accountId),
      (index) => `lines[${index}].accountId`,
      tx,
    );
    const description = input.description.trim();
    if (description.length === 0 || description.length > FINANCE_LIMITS.maxDescription) {
      throw invalid('description', 'length', `1 to ${FINANCE_LIMITS.maxDescription} characters`);
    }
    const number = await this.settings.allocateNumber(tx, 'JOURNAL', input.entryDate);
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        number,
        entryDate: input.entryDate,
        description,
        source: input.source,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        reversesId: input.reversesId ?? null,
        postedBy: actorUserId(actor),
      })
      .returning({ id: journalEntries.id });
    if (!entry) throw new Error('journal_entries insert returned no row');
    await tx.insert(journalLines).values(
      lines.map((line, index) => ({
        entryId: entry.id,
        lineNo: index + 1,
        accountId: line.accountId,
        debit: line.debit,
        credit: line.credit,
        customerId: line.customerId ?? null,
        moneyAccountId: line.moneyAccountId ?? null,
        description: line.description?.trim() || null,
      })),
    );
    return { id: entry.id, number };
  }

  /**
   * Reverses an entry: the same lines with the sides swapped, dated `entryDate`, naming the
   * original. An entry is reversed once.
   */
  async reverse(
    tx: Tx,
    actor: Actor,
    entryId: number,
    input: { entryDate: string; description: string; source: JournalSource },
  ): Promise<JournalEntryRef> {
    const [original] = await tx
      .select({ id: journalEntries.id, number: journalEntries.number })
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId));
    if (!original) throw notFound('journal_entry', entryId);
    const [already] = await tx
      .select({ number: journalEntries.number })
      .from(journalEntries)
      .where(eq(journalEntries.reversesId, entryId));
    if (already) {
      throw invalid(
        'entryId',
        'notReversed',
        `entry ${original.number} is reversed by ${already.number}`,
      );
    }
    const lines = await tx
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entryId))
      .orderBy(asc(journalLines.lineNo));
    return this.post(tx, actor, {
      ...input,
      reversesId: entryId,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
        customerId: line.customerId,
        moneyAccountId: line.moneyAccountId,
        description: line.description,
      })),
    });
  }

  /** A manual entry (`finance.journal.manage`), dated today or earlier. */
  async postManual(
    ctx: AuthContext,
    input: { entryDate: string; description: string; lines: readonly JournalLineInput[] },
  ): Promise<JournalEntryDetail> {
    assertNotFuture(input.entryDate);
    const ref = await inTransaction(this.db, async (tx) => {
      const posted = await this.post(tx, ctx, { ...input, source: 'MANUAL' });
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'journal_entries',
        entityId: posted.id,
        after: {
          number: posted.number,
          entryDate: input.entryDate,
          lines: input.lines.map((line) => ({
            accountId: line.accountId,
            debit: line.debit.toFixed(MONEY_SCALE),
            credit: line.credit.toFixed(MONEY_SCALE),
          })),
        },
      });
      return posted;
    });
    return this.get(ref.id);
  }

  /** Reverses a manual or opening entry by hand; automatic entries go through their document. */
  async reverseManual(
    ctx: AuthContext,
    entryId: number,
    input: { description: string },
  ): Promise<JournalEntryDetail> {
    const ref = await inTransaction(this.db, async (tx) => {
      const [original] = await tx
        .select({ source: journalEntries.source, number: journalEntries.number })
        .from(journalEntries)
        .where(eq(journalEntries.id, entryId));
      if (!original) throw notFound('journal_entry', entryId);
      if (original.source !== 'MANUAL' && original.source !== 'OPENING') {
        throw invalid('entryId', 'manual', 'only a manual or opening entry is reversed by hand');
      }
      const reversed = await this.reverse(tx, ctx, entryId, {
        entryDate: businessDate(),
        description: input.description,
        source: 'MANUAL',
      });
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'journal_entries',
        entityId: reversed.id,
        after: { number: reversed.number, reverses: original.number },
      });
      return reversed;
    });
    return this.get(ref.id);
  }

  async list(query: JournalQuery): Promise<{
    data: JournalEntrySummary[];
    nextCursor: string | null;
  }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const filters: SQL[] = [];
    if (query.from) filters.push(sql`${journalEntries.entryDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${journalEntries.entryDate} <= ${query.to}`);
    if (query.source) filters.push(eq(journalEntries.source, query.source));
    if (query.accountId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id = journal_entries.id AND l.account_id = ${query.accountId})`,
      );
    }
    if (query.customerId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM journal_lines l WHERE l.entry_id = journal_entries.id AND l.customer_id = ${query.customerId})`,
      );
    }
    if (typeof after?.date === 'string' && typeof after?.id === 'number') {
      filters.push(
        sql`(${journalEntries.entryDate}, ${journalEntries.id}) < (${after.date}::date, ${after.id}::bigint)`,
      );
    }
    const rows = await this.db
      .select({
        entry: journalEntries,
        amount: sql<string>`(SELECT coalesce(sum(l.debit), 0) FROM journal_lines l WHERE l.entry_id = journal_entries.id)`,
        lineCount: sql<string>`(SELECT count(*) FROM journal_lines l WHERE l.entry_id = journal_entries.id)`,
      })
      .from(journalEntries)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(journalEntries.entryDate), desc(journalEntries.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({
      date: row.entry.entryDate,
      id: row.entry.id,
    }));
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<JournalEntryDetail> {
    const [row] = await this.db
      .select({
        entry: journalEntries,
        amount: sql<string>`(SELECT coalesce(sum(l.debit), 0) FROM journal_lines l WHERE l.entry_id = journal_entries.id)`,
        lineCount: sql<string>`(SELECT count(*) FROM journal_lines l WHERE l.entry_id = journal_entries.id)`,
      })
      .from(journalEntries)
      .where(eq(journalEntries.id, id));
    if (!row) throw notFound('journal_entry', id);
    const [summary] = await this.summaries([row]);
    if (!summary) throw notFound('journal_entry', id);
    const lines = await this.db
      .select({
        line: journalLines,
        accountCode: glAccounts.code,
        accountName: glAccounts.name,
        moneyAccountName: moneyAccounts.name,
      })
      .from(journalLines)
      .innerJoin(glAccounts, eq(glAccounts.id, journalLines.accountId))
      .leftJoin(moneyAccounts, eq(moneyAccounts.id, journalLines.moneyAccountId))
      .where(eq(journalLines.entryId, id))
      .orderBy(asc(journalLines.lineNo));
    const customerNames = await this.customerNames(
      lines.flatMap((row) => (row.line.customerId === null ? [] : [row.line.customerId])),
    );
    return {
      ...summary,
      lines: lines.map(({ line, accountCode, accountName, moneyAccountName }) => ({
        id: line.id,
        lineNo: line.lineNo,
        accountId: line.accountId,
        accountCode,
        accountName,
        debit: line.debit,
        credit: line.credit,
        customerId: line.customerId,
        customerName:
          line.customerId === null ? null : (customerNames.get(line.customerId) ?? null),
        moneyAccountId: line.moneyAccountId,
        moneyAccountName,
        description: line.description,
      })),
    };
  }

  /** An account's lines newest first with the balance after each, and the opening balance. */
  async accountLedger(accountId: number, query: AccountLedgerQuery): Promise<AccountLedgerPage> {
    await this.accounts.get(accountId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const running = this.db
      .select({
        id: journalLines.id,
        entryId: journalLines.entryId,
        entryNumber: journalEntries.number,
        entryDate: journalEntries.entryDate,
        entryDescription: sql<string>`${journalEntries.description}`.as('entry_description'),
        source: journalEntries.source,
        lineNo: journalLines.lineNo,
        debit: journalLines.debit,
        credit: journalLines.credit,
        customerId: journalLines.customerId,
        description: sql<string | null>`${journalLines.description}`.as('line_description'),
        balanceAfter:
          sql<string>`sum(${journalLines.debit} - ${journalLines.credit}) OVER (ORDER BY ${journalEntries.entryDate}, ${journalEntries.id}, ${journalLines.lineNo})`.as(
            'balance_after',
          ),
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(eq(journalLines.accountId, accountId))
      .as('running');
    const filters: SQL[] = [];
    if (query.from) filters.push(sql`${running.entryDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${running.entryDate} <= ${query.to}`);
    if (
      typeof after?.date === 'string' &&
      typeof after?.entryId === 'number' &&
      typeof after?.lineNo === 'number'
    ) {
      filters.push(
        sql`(${running.entryDate}, ${running.entryId}, ${running.lineNo}) < (${after.date}::date, ${after.entryId}::bigint, ${after.lineNo}::smallint)`,
      );
    }
    const rows = await this.db
      .select()
      .from(running)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(running.entryDate), desc(running.entryId), desc(running.lineNo))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({
      date: row.entryDate,
      entryId: row.entryId,
      lineNo: row.lineNo,
    }));
    let opening = new Decimal(0);
    if (query.from) {
      const [before] = await this.db
        .select({
          balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            eq(journalLines.accountId, accountId),
            sql`${journalEntries.entryDate} < ${query.from}`,
          ),
        );
      opening = new Decimal(before?.balance ?? 0);
    }
    const customerNames = await this.customerNames(
      page.data.flatMap((row) => (row.customerId === null ? [] : [row.customerId])),
    );
    return {
      data: page.data.map((row) => ({
        ...row,
        customerName: row.customerId === null ? null : (customerNames.get(row.customerId) ?? null),
        balanceAfter: new Decimal(row.balanceAfter),
      })),
      nextCursor: page.nextCursor,
      opening,
    };
  }

  private async summaries(
    rows: { entry: typeof journalEntries.$inferSelect; amount: string; lineCount: string }[],
  ): Promise<JournalEntrySummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.entry.id);
    const reversedBy = new Map(
      (
        await this.db
          .select({
            reversesId: journalEntries.reversesId,
            id: journalEntries.id,
            number: journalEntries.number,
          })
          .from(journalEntries)
          .where(inArray(journalEntries.reversesId, ids))
      ).map((row) => [row.reversesId, row]),
    );
    const reversesIds = rows.flatMap((row) =>
      row.entry.reversesId === null ? [] : [row.entry.reversesId],
    );
    const reverses = new Map(
      reversesIds.length
        ? (
            await this.db
              .select({ id: journalEntries.id, number: journalEntries.number })
              .from(journalEntries)
              .where(inArray(journalEntries.id, reversesIds))
          ).map((row) => [row.id, row.number])
        : [],
    );
    const sourceNumbers = await this.sourceNumbers(rows.map((row) => row.entry));
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.entry.postedBy === null ? [] : [row.entry.postedBy])),
    );
    return rows.map(({ entry, amount, lineCount }) => ({
      id: entry.id,
      number: entry.number,
      entryDate: entry.entryDate,
      description: entry.description,
      source: entry.source,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      sourceNumber:
        entry.sourceType === null || entry.sourceId === null
          ? null
          : (sourceNumbers.get(`${entry.sourceType}:${entry.sourceId}`) ?? null),
      reversesId: entry.reversesId,
      reversesNumber: entry.reversesId === null ? null : (reverses.get(entry.reversesId) ?? null),
      reversedById: reversedBy.get(entry.id)?.id ?? null,
      reversedByNumber: reversedBy.get(entry.id)?.number ?? null,
      amount: new Decimal(amount),
      lineCount: Number.parseInt(lineCount, 10),
      postedByName: entry.postedBy === null ? null : (names.get(entry.postedBy) ?? null),
      createdAt: entry.createdAt,
    }));
  }

  /** The numbers of the documents behind automatic entries, by `${type}:${id}`. */
  private async sourceNumbers(
    entries: readonly { sourceType: FinanceDocKind | null; sourceId: number | null }[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const idsOf = (type: FinanceDocKind) =>
      entries.flatMap((entry) =>
        entry.sourceType === type && entry.sourceId !== null ? [entry.sourceId] : [],
      );
    const tables = [
      ['INVOICE', invoices] as const,
      ['PAYMENT', payments] as const,
      ['CREDIT_NOTE', creditNotes] as const,
      ['JOURNAL', journalEntries] as const,
    ];
    for (const [type, table] of tables) {
      const ids = idsOf(type);
      if (ids.length === 0) continue;
      const rows = await this.db
        .select({ id: table.id, number: table.number })
        .from(table)
        .where(inArray(table.id, ids));
      for (const row of rows) result.set(`${type}:${row.id}`, row.number);
    }
    return result;
  }

  private async customerNames(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    return new Map(
      (await this.customers.getMany([...new Set(ids)])).map((customer) => [
        customer.id,
        customer.name,
      ]),
    );
  }
}

/** A document date is today or earlier (Ulaanbaatar). */
export function assertNotFuture(date: string, path = 'entryDate'): void {
  if (date > businessDate()) throw invalid(path, 'notFuture', 'today or earlier');
}
