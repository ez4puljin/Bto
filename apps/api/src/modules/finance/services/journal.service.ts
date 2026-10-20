import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_LIMITS,
  type GlRole,
  JOURNAL_SOURCE_DOC_TYPES,
  type JournalSource,
  type JournalSourceDocType,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { inArray } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  type FinCallContext,
  type FinEntryOrigin,
  type FinEntrySummary,
  FinError,
  FinJournalPosting,
  FinJournalReader,
} from '../../../finance-core';
import {
  BTO_SOURCE,
  FIN_SOURCE,
  FinPartiesBridge,
  POSTING_KEY_OF_ROLE,
  ROLE_OF_POSTING_KEY,
} from '../../fin-bridge';
import { type Actor, AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { creditNotes, invoices, payments } from '../schema';
import { FinanceSettingsService } from './finance-settings.service';
import { FinBooks, staffContext } from './fin-books';
import { GlAccountsService } from './gl-accounts.service';

/**
 * One side of an entry: the account by role (an automatic entry), by id (a manual entry, a
 * voucher's other account) or through a money account (its account), never two of them.
 */
export interface JournalLineInput {
  role?: GlRole;
  accountId?: number;
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
  sourceType?: JournalSourceDocType | null;
  sourceId?: number | null;
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
  sourceType: JournalSourceDocType | null;
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
const DOC_SOURCE: Partial<Record<string, JournalSource>> = {
  INVOICE: 'AUTO_INVOICE',
  PAYMENT: 'AUTO_PAYMENT',
  CREDIT_NOTE: 'AUTO_CREDIT_NOTE',
  POS_SHIFT: 'AUTO_POS_SHIFT',
};

/**
 * The general journal (ADR-0060 #7), kept by the Finance Core since F1's ledger (ADR-0089):
 * numbered, balanced, append-only entries in `fin.journal_*`; the automatic ones from documents
 * (posted as source BTO), the manual ones from the accountant (posted as the staff member, source
 * FIN). An entry is never changed; a correction is a reversing entry that names it. Σ debit =
 * Σ credit is checked here, again by the core and once more by the database at commit.
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
    private readonly posting: FinJournalPosting,
    private readonly reader: FinJournalReader,
    private readonly parties: FinPartiesBridge,
    private readonly books: FinBooks,
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
    const explicit = lines.flatMap((line, index) =>
      line.accountId === undefined ? [] : [{ id: line.accountId, index }],
    );
    if (explicit.length) {
      await this.accounts.activeByIds(
        explicit.map((own) => own.id),
        (at) => `lines[${explicit[at]?.index ?? at}].accountId`,
        tx,
      );
    }
    const description = checkedDescription(input.description);
    const number = await this.settings.allocateNumber(tx, 'JOURNAL', input.entryDate);
    const partyOf = new Map<number, string>();
    for (const line of lines) {
      if (line.customerId == null || partyOf.has(line.customerId)) continue;
      partyOf.set(
        line.customerId,
        await this.parties.customerPartyInTx(tx, actor, line.customerId),
      );
    }
    const company = await this.books.company();
    return this.translated(
      (index) => lines[index]?.role,
      () =>
        this.posting.postEntryInTx(tx, this.contextFor(input.source, actor), {
          company,
          number,
          entryDate: input.entryDate,
          description,
          sourceDoc:
            input.sourceType && input.sourceId != null
              ? { type: input.sourceType, id: String(input.sourceId) }
              : null,
          lines: lines.map((line) => ({
            key: line.role === undefined ? null : POSTING_KEY_OF_ROLE[line.role].code,
            accountId: line.accountId ?? null,
            moneyAccountId: line.moneyAccountId ?? null,
            partyId: line.customerId == null ? null : (partyOf.get(line.customerId) ?? null),
            debit: line.debit,
            credit: line.credit,
            description: line.description?.trim() || null,
          })),
        }),
    );
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
    const company = await this.books.company();
    const original = await this.reader.entry(this.books.source(), { company, id: entryId }, tx);
    if (!original) throw notFound('journal_entry', entryId);
    const already = (
      await this.reader.reversals(this.books.source(), { company, ids: [entryId] }, tx)
    ).get(entryId);
    if (already) {
      throw invalid(
        'entryId',
        'notReversed',
        `entry ${original.number} is reversed by ${already.number}`,
      );
    }
    const description = checkedDescription(input.description);
    const number = await this.settings.allocateNumber(tx, 'JOURNAL', input.entryDate);
    return this.translated(
      () => undefined,
      () =>
        this.posting.reverseEntryInTx(tx, this.contextFor(input.source, actor), {
          company,
          entryId,
          number,
          entryDate: input.entryDate,
          description,
        }),
    );
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
      const original = await this.reader.entry(
        this.books.source(),
        { company: await this.books.company(), id: entryId },
        tx,
      );
      if (!original) throw notFound('journal_entry', entryId);
      const source = sourceOf(original);
      if (source !== 'MANUAL' && source !== 'OPENING') {
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
    let partyId: string | undefined;
    if (query.customerId) {
      partyId = (await this.parties.partiesOfCustomers([query.customerId])).get(query.customerId);
      if (partyId === undefined) return { data: [], nextCursor: null };
    }
    const rows = await this.reader.entries(this.books.source(), {
      company: await this.books.company(),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.source ? { origin: originOf(query.source) } : {}),
      ...(query.accountId ? { accountId: query.accountId } : {}),
      ...(partyId !== undefined ? { partyId } : {}),
      ...(typeof after?.date === 'string' && typeof after?.id === 'number'
        ? { after: { date: after.date, id: after.id } }
        : {}),
      limit,
    });
    const page = toPage(rows, limit, (row) => ({ date: row.entryDate, id: row.id }));
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<JournalEntryDetail> {
    const entry = await this.reader.entry(this.books.source(), {
      company: await this.books.company(),
      id,
    });
    if (!entry) throw notFound('journal_entry', id);
    const [summary] = await this.summaries([entry]);
    if (!summary) throw notFound('journal_entry', id);
    const customerOf = await this.parties.customersOfParties(
      entry.lines.flatMap((line) => (line.partyId === null ? [] : [line.partyId])),
    );
    const customerNames = await this.customerNames([...customerOf.values()]);
    return {
      ...summary,
      lines: entry.lines.map((line) => {
        const customerId = line.partyId === null ? null : (customerOf.get(line.partyId) ?? null);
        return {
          id: line.id,
          lineNo: line.lineNo,
          accountId: line.accountId,
          accountCode: line.accountCode,
          accountName: line.accountName,
          debit: line.debit,
          credit: line.credit,
          customerId,
          customerName: customerId === null ? null : (customerNames.get(customerId) ?? null),
          moneyAccountId: line.moneyAccountId,
          moneyAccountName: line.moneyAccountName,
          description: line.description,
        };
      }),
    };
  }

  /** The numbers of these entries (a document's «Ж-…» fact), by id. */
  async numbersOf(
    ids: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    return this.reader.numbers(
      this.books.source(),
      { company: await this.books.company(), ids },
      this.books.executor(executor),
    );
  }

  /** An account's lines newest first with the balance after each, and the opening balance. */
  async accountLedger(accountId: number, query: AccountLedgerQuery): Promise<AccountLedgerPage> {
    await this.accounts.get(accountId);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const { rows, opening } = await this.reader.accountLedger(this.books.source(), {
      company: await this.books.company(),
      accountId,
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(typeof after?.date === 'string' &&
      typeof after?.entryId === 'number' &&
      typeof after?.lineNo === 'number'
        ? { after: { date: after.date, entryId: after.entryId, lineNo: after.lineNo } }
        : {}),
      limit,
    });
    const page = toPage(rows, limit, (row) => ({
      date: row.entryDate,
      entryId: row.entryId,
      lineNo: row.lineNo,
    }));
    const customerOf = await this.parties.customersOfParties(
      page.data.flatMap((row) => (row.partyId === null ? [] : [row.partyId])),
    );
    const customerNames = await this.customerNames([...customerOf.values()]);
    return {
      data: page.data.map((row) => {
        const customerId = row.partyId === null ? null : (customerOf.get(row.partyId) ?? null);
        return {
          id: row.id,
          entryId: row.entryId,
          entryNumber: row.entryNumber,
          entryDate: row.entryDate,
          entryDescription: row.entryDescription,
          source: sourceOf(row),
          lineNo: row.lineNo,
          debit: row.debit,
          credit: row.credit,
          customerId,
          customerName: customerId === null ? null : (customerNames.get(customerId) ?? null),
          description: row.description,
          balanceAfter: row.balanceAfter,
        };
      }),
      nextCursor: page.nextCursor,
      opening,
    };
  }

  /** Automatic entries post as Bto (source BTO); a manual one as the staff member (source FIN). */
  private contextFor(source: JournalSource, actor: Actor): FinCallContext {
    return source === 'MANUAL' || source === 'OPENING'
      ? this.books.user(staffContext(actor))
      : this.books.source(actor);
  }

  /**
   * Runs a posting with the company filled in and turns the core's refusals back into today's
   * answers: a role without an active account is 409 ACCOUNT_ROLE_MISSING, an inactive account
   * named by id a field error.
   */
  private async translated<T>(
    roleAt: (index: number) => GlRole | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof FinError)) throw error;
      if (error.code === 'FIN_MAPPING_MISSING') {
        const key = typeof error.params?.key === 'string' ? error.params.key : '';
        const role = ROLE_OF_POSTING_KEY.get(key) ?? key;
        throw new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, {
          role,
        });
      }
      if (error.code === 'FIN_ACCOUNT_INACTIVE') {
        const path = typeof error.params?.path === 'string' ? error.params.path : 'lines';
        const index = Number.parseInt(/\[(\d+)\]/.exec(path)?.[1] ?? '-1', 10);
        const role = roleAt(index);
        if (role !== undefined) {
          throw new AppError('ACCOUNT_ROLE_MISSING', `no active account holds the role ${role}`, {
            role,
          });
        }
        throw invalid(path, 'active', 'the account is inactive');
      }
      throw error;
    }
  }

  private async summaries(rows: readonly FinEntrySummary[]): Promise<JournalEntrySummary[]> {
    if (rows.length === 0) return [];
    const company = await this.books.company();
    const ctx = this.books.source();
    const reversedBy = await this.reader.reversals(ctx, {
      company,
      ids: rows.map((row) => row.id),
    });
    const reverses = await this.reader.numbers(ctx, {
      company,
      ids: rows.flatMap((row) => (row.reversesId === null ? [] : [row.reversesId])),
    });
    const docs = rows.map((row) => sourceDocOf(row));
    const sourceNumbers = await this.sourceNumbers(docs);
    const userIds = rows.flatMap((row) => {
      const id = userIdOf(row.actor.ref);
      return id === null ? [] : [id];
    });
    const names = await this.names.namesOf(userIds);
    return rows.map((row, index) => {
      const doc = docs[index] ?? null;
      const userId = userIdOf(row.actor.ref);
      return {
        id: row.id,
        number: row.number,
        entryDate: row.entryDate,
        description: row.description,
        source: sourceOf(row),
        sourceType: doc?.type ?? null,
        sourceId: doc?.id ?? null,
        sourceNumber: doc === null ? null : (sourceNumbers.get(`${doc.type}:${doc.id}`) ?? null),
        reversesId: row.reversesId,
        reversesNumber: row.reversesId === null ? null : (reverses.get(row.reversesId) ?? null),
        reversedById: reversedBy.get(row.id)?.id ?? null,
        reversedByNumber: reversedBy.get(row.id)?.number ?? null,
        amount: row.amount,
        lineCount: row.lineCount,
        postedByName: userId === null ? null : (names.get(userId) ?? null),
        createdAt: row.postedAt,
      };
    });
  }

  /** The numbers of the documents behind automatic entries, by `${type}:${id}`. */
  private async sourceNumbers(
    docs: readonly ({ type: JournalSourceDocType; id: number } | null)[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const idsOf = (type: JournalSourceDocType) =>
      docs.flatMap((doc) => (doc !== null && doc.type === type ? [doc.id] : []));
    const tables = [
      ['INVOICE', invoices] as const,
      ['PAYMENT', payments] as const,
      ['CREDIT_NOTE', creditNotes] as const,
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
    for (const [id, number] of await this.numbersOf(idsOf('JOURNAL'))) {
      result.set(`JOURNAL:${id}`, number);
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

/** Today's `source` of an entry, from where the core says it came from (ADR-0089 #3). */
function sourceOf(row: {
  system: string;
  sourceDocType: string | null;
  reversesId: number | null;
}): JournalSource {
  if (row.system === FIN_SOURCE) return row.sourceDocType === 'OPENING' ? 'OPENING' : 'MANUAL';
  if (row.reversesId !== null) return 'AUTO_VOID';
  return (row.sourceDocType === null ? undefined : DOC_SOURCE[row.sourceDocType]) ?? 'MANUAL';
}

/** The core's origin filter of a `source`. */
function originOf(source: JournalSource): FinEntryOrigin {
  switch (source) {
    case 'MANUAL':
      return { system: FIN_SOURCE };
    case 'OPENING':
      return { system: FIN_SOURCE, docType: 'OPENING' };
    case 'AUTO_VOID':
      return { system: BTO_SOURCE, reversal: true };
    case 'AUTO_INVOICE':
      return { system: BTO_SOURCE, docType: 'INVOICE', reversal: false };
    case 'AUTO_PAYMENT':
      return { system: BTO_SOURCE, docType: 'PAYMENT', reversal: false };
    case 'AUTO_CREDIT_NOTE':
      return { system: BTO_SOURCE, docType: 'CREDIT_NOTE', reversal: false };
    case 'AUTO_POS_SHIFT':
      return { system: BTO_SOURCE, docType: 'POS_SHIFT', reversal: false };
  }
}

/** The document behind an automatic entry as today's API names it (none on a reversal). */
function sourceDocOf(row: FinEntrySummary): { type: JournalSourceDocType; id: number } | null {
  if (sourceOf(row) === 'AUTO_VOID' || row.sourceDocType === null || row.sourceDocId === null) {
    return null;
  }
  const type = JOURNAL_SOURCE_DOC_TYPES.find((own) => own === row.sourceDocType);
  if (type === undefined || !/^\d+$/.test(row.sourceDocId)) return null;
  return { type, id: Number.parseInt(row.sourceDocId, 10) };
}

/** The users.id of a `user:<id>` actor ref, or null for Bto itself or a job. */
function userIdOf(ref: string): number | null {
  const match = /^user:(\d+)$/.exec(ref);
  return match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
}

function checkedDescription(value: string): string {
  const description = value.trim();
  if (description.length === 0 || description.length > FINANCE_LIMITS.maxDescription) {
    throw invalid('description', 'length', `1 to ${FINANCE_LIMITS.maxDescription} characters`);
  }
  return description;
}

/** A document date is today or earlier (Ulaanbaatar). */
export function assertNotFuture(date: string, path = 'entryDate'): void {
  if (date > businessDate()) throw invalid(path, 'notFuture', 'today or earlier');
}
