import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LineV1 } from '@tugeel/fin-contract';
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
  FinReader,
} from '../../../finance-core';
import {
  BTO_SOURCE,
  FIN_DOC_TYPES,
  FIN_SOURCE,
  FinPartiesBridge,
  MANUAL_KEY,
  POSTING_KEY_OF_ROLE,
} from '../../fin-bridge';
import { type Actor, AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { creditNotes, invoices } from '../schema';
import { FinBooks, staffContext } from './fin-books';
import { FinPosting, translated } from './fin-posting';
import { GlAccountsService } from './gl-accounts.service';
import { MoneyAccountsService } from './money-accounts.service';

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
/** The vouchers' source document types under source FIN (F2, ADR-0090). */
const VOUCHER_DOC_TYPES = [
  FIN_DOC_TYPES.CUSTOMER_RECEIPT.docType,
  FIN_DOC_TYPES.CUSTOMER_REFUND.docType,
] as const;
const MANUAL_DOC_TYPE = FIN_DOC_TYPES.JOURNAL.docType;

/**
 * The general journal (ADR-0060 #7), kept by the Finance Core (F1, ADR-0089; F2, ADR-0090):
 * numbered, balanced, append-only entries in `fin.journal_*`. The documents' entries come from the
 * intake (invoices, credit notes, vouchers); a manual entry is a JOURNAL document of the core's
 * screens, posted as the staff member and reversed by the intake; the POS shift entries still post
 * through F1's façade until H2. Σ debit = Σ credit is checked here, again by the core and once more
 * by the database at commit.
 */
@Injectable()
export class JournalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly accounts: GlAccountsService,
    private readonly moneyAccounts: MoneyAccountsService,
    private readonly customers: CustomersService,
    private readonly names: UserNamesService,
    private readonly posting: FinJournalPosting,
    private readonly reader: FinJournalReader,
    private readonly documents: FinReader,
    private readonly intake: FinPosting,
    private readonly parties: FinPartiesBridge,
    private readonly books: FinBooks,
  ) {}

  /**
   * Posts an automatic entry by role inside the caller's transaction through the core's façade
   * (the POS shift close until H2); 422 JOURNAL_UNBALANCED when Σ differ. The core numbers it.
   */
  async post(tx: Tx, actor: Actor, input: JournalEntryInput): Promise<JournalEntryRef> {
    checkLines(input.lines);
    const explicit = input.lines.flatMap((line, index) =>
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
    const company = await this.books.company();
    try {
      return await this.posting.postEntryInTx(tx, this.books.source(actor), {
        company,
        entryDate: input.entryDate,
        description,
        sourceDoc:
          input.sourceType && input.sourceId != null
            ? { type: input.sourceType, id: String(input.sourceId) }
            : null,
        lines: input.lines.map((line) => ({
          key: line.role === undefined ? null : POSTING_KEY_OF_ROLE[line.role].code,
          accountId: line.accountId ?? null,
          moneyAccountId: line.moneyAccountId ?? null,
          partyId: null,
          debit: line.debit,
          credit: line.credit,
          description: line.description?.trim() || null,
        })),
      });
    } catch (error) {
      throw translated(error);
    }
  }

  /**
   * Reverses a façade entry: the same lines with the sides swapped, dated `entryDate`, naming the
   * original. An entry is reversed once.
   */
  async reverse(
    tx: Tx,
    actor: Actor,
    entryId: number,
    input: { entryDate: string; description: string },
  ): Promise<JournalEntryRef> {
    const company = await this.books.company();
    const original = await this.reader.entry(this.books.source(), { company, id: entryId }, tx);
    if (!original) throw notFound('journal_entry', entryId);
    await this.assertNotReversed(tx, company, entryId, original.number);
    try {
      return await this.posting.reverseEntryInTx(tx, this.books.source(actor), {
        company,
        entryId,
        entryDate: input.entryDate,
        description: checkedDescription(input.description),
      });
    } catch (error) {
      throw translated(error);
    }
  }

  /**
   * A manual entry (`finance.journal.manage`), dated today or earlier: a JOURNAL document of the
   * core's screens, posted as the staff member (source FIN). A line on a cash or bank account names
   * its cash box or bank account, a line on the receivables its customer (the controls, ADR-0072
   * #2). `key` is the request's Idempotency-Key: the document's identity.
   */
  async postManual(
    ctx: AuthContext,
    input: { entryDate: string; description: string; lines: readonly JournalLineInput[] },
    key?: string | null,
  ): Promise<JournalEntryDetail> {
    assertNotFuture(input.entryDate);
    checkLines(input.lines);
    const description = checkedDescription(input.description);
    const ids = input.lines.map((line, index) => {
      if (line.accountId === undefined) throw invalid(`lines[${index}].accountId`, 'required', 'an account');
      return line.accountId;
    });
    const entryId = await inTransaction(this.db, async (tx) => {
      const accounts = await this.accounts.activeByIds(ids, (index) => `lines[${index}].accountId`, tx);
      const money = new Map((await this.moneyAccounts.list(tx)).map((row) => [row.id, row]));
      const lines: LineV1[] = [];
      for (const [index, line] of input.lines.entries()) {
        const account = accounts.get(ids[index] ?? 0);
        if (!account) throw invalid(`lines[${index}].accountId`, 'exists', 'an account');
        const debit = line.debit.gt(0);
        const moneyAccount = line.moneyAccountId == null ? undefined : money.get(line.moneyAccountId);
        if (line.moneyAccountId != null && !moneyAccount) {
          throw invalid(`lines[${index}].moneyAccountId`, 'exists', 'a cash box or bank account');
        }
        if (moneyAccount && moneyAccount.glAccountId !== account.id) {
          throw invalid(`lines[${index}].moneyAccountId`, 'ofAccount', 'a cash box or bank account of the line\'s account');
        }
        let party: LineV1['party'];
        if (line.customerId != null) {
          await this.parties.customerPartyInTx(tx, ctx, line.customerId);
          party = await this.parties.customerPartyIn(tx, line.customerId);
        }
        lines.push({
          lineNo: index + 1,
          key: MANUAL_KEY,
          side: debit ? 'DEBIT' : 'CREDIT',
          amount: (debit ? line.debit : line.credit).toFixed(MONEY_SCALE),
          accountCode: account.code,
          ...(moneyAccount ? { moneyAccount: moneyAccount.code } : {}),
          ...(party ? { party } : {}),
          ...(line.description?.trim() ? { description: line.description.trim() } : {}),
        });
      }
      const total = input.lines.reduce((sum, line) => sum.plus(line.debit), new Decimal(0));
      const result = await this.submitManual(tx, ctx, {
        source: { system: FIN_SOURCE, docType: MANUAL_DOC_TYPE, docId: key ?? randomUUID() },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.JOURNAL.code,
          documentDate: input.entryDate,
          currency: 'MNT',
          description,
          controlTotal: total.toFixed(MONEY_SCALE),
          lines,
        },
      });
      const posted = Number.parseInt(result.document?.journalEntryId ?? '0', 10);
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'journal_entries',
        entityId: posted,
        after: {
          number: result.document?.journalNo ?? null,
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
    return this.get(entryId);
  }

  /** Reverses a manual entry by hand (the intake's REVERSE); automatic ones go through their document. */
  async reverseManual(
    ctx: AuthContext,
    entryId: number,
    input: { description: string },
  ): Promise<JournalEntryDetail> {
    const reason = checkedDescription(input.description);
    const reversalId = await inTransaction(this.db, async (tx) => {
      const company = await this.books.company();
      const original = await this.reader.entry(this.books.source(), { company, id: entryId }, tx);
      if (!original) throw notFound('journal_entry', entryId);
      const source = sourceOf(original);
      if ((source !== 'MANUAL' && source !== 'OPENING') || original.documentId === null) {
        throw invalid('entryId', 'manual', 'only a manual or opening entry is reversed by hand');
      }
      await this.assertNotReversed(tx, company, entryId, original.number);
      const result = await this.submitManual(tx, ctx, {
        source: {
          system: FIN_SOURCE,
          docType: original.sourceDocType ?? MANUAL_DOC_TYPE,
          docId: original.sourceDocId ?? '',
        },
        body: { action: 'REVERSE', accountingDate: businessDate(), reason },
      });
      const reversed = Number.parseInt(result.document?.journalEntryId ?? '0', 10);
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'journal_entries',
        entityId: reversed,
        after: { number: result.document?.journalNo ?? null, reverses: original.number },
      });
      return reversed;
    });
    return this.get(reversalId);
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

  /** Posts a manual entry or its reversal as the staff member, in today's words on a refusal. */
  private async submitManual(
    tx: Tx,
    ctx: AuthContext,
    command: Parameters<FinPosting['submitInTx']>[2],
  ) {
    try {
      return await this.intake.submitInTx(tx, this.books.user(staffContext(ctx)), command);
    } catch (error) {
      throw manualRefusal(error);
    }
  }

  private async assertNotReversed(
    tx: Tx,
    company: string,
    entryId: number,
    number: string,
  ): Promise<void> {
    const already = (await this.reader.reversals(this.books.source(), { company, ids: [entryId] }, tx)).get(
      entryId,
    );
    if (already) {
      throw invalid('entryId', 'notReversed', `entry ${number} is reversed by ${already.number}`);
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
    const sourceNumbers = await this.sourceNumbers(ctx, company, docs);
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
    ctx: FinCallContext,
    company: string,
    docs: readonly ({ type: JournalSourceDocType; id: number } | null)[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const idsOf = (type: JournalSourceDocType) =>
      docs.flatMap((doc) => (doc !== null && doc.type === type ? [doc.id] : []));
    const tables = [['INVOICE', invoices] as const, ['CREDIT_NOTE', creditNotes] as const];
    for (const [type, table] of tables) {
      const ids = idsOf(type);
      if (ids.length === 0) continue;
      const rows = await this.db
        .select({ id: table.id, number: table.number })
        .from(table)
        .where(inArray(table.id, ids));
      for (const row of rows) result.set(`${type}:${row.id}`, row.number);
    }
    const payments = idsOf('PAYMENT');
    if (payments.length) {
      const { rows } = await this.documents.documents(ctx, {
        company,
        typeCodes: [
          FIN_DOC_TYPES.CUSTOMER_RECEIPT.code,
          FIN_DOC_TYPES.CUSTOMER_REFUND.code,
          FIN_DOC_TYPES.OTHER_RECEIPT.code,
          FIN_DOC_TYPES.OTHER_PAYMENT.code,
        ],
        ids: payments,
      });
      for (const row of rows) result.set(`PAYMENT:${row.id}`, row.number);
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

function checkLines(lines: readonly JournalLineInput[]): void {
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
}

/** A manual line the controls refuse, as the field the accountant must fill (ADR-0072 #2). */
function manualRefusal(error: unknown): unknown {
  if (!(error instanceof FinError)) return translated(error);
  const path = typeof error.params?.path === 'string' ? error.params.path : '';
  const index = /lines\.(\d+)/.exec(path)?.[1];
  if (index !== undefined && error.code === 'FIN_MONEY_ACCOUNT_REQUIRED') {
    return invalid(`lines[${index}].moneyAccountId`, 'required', 'a cash box or bank account');
  }
  if (index !== undefined && error.code === 'FIN_PARTY_REQUIRED') {
    return invalid(`lines[${index}].customerId`, 'required', 'a customer');
  }
  if (index !== undefined && error.code === 'FIN_ACCOUNT_INACTIVE') {
    return invalid(`lines[${index}].accountId`, 'active', 'the account is inactive');
  }
  return translated(error);
}

/** Today's `source` of an entry, from where the core says it came from (ADR-0089 #3, ADR-0090). */
function sourceOf(row: {
  system: string;
  sourceDocType: string | null;
  reversesId: number | null;
}): JournalSource {
  if (row.system === FIN_SOURCE) {
    if (row.sourceDocType === 'OPENING') return 'OPENING';
    if ((VOUCHER_DOC_TYPES as readonly (string | null)[]).includes(row.sourceDocType)) {
      return row.reversesId === null ? 'AUTO_PAYMENT' : 'AUTO_VOID';
    }
    return 'MANUAL';
  }
  if (row.reversesId !== null) return 'AUTO_VOID';
  switch (row.sourceDocType) {
    case FIN_DOC_TYPES.SALES_INVOICE.docType:
      return 'AUTO_INVOICE';
    case FIN_DOC_TYPES.SALES_RETURN.docType:
      return 'AUTO_CREDIT_NOTE';
    case 'POS_SHIFT':
      return 'AUTO_POS_SHIFT';
    default:
      return 'MANUAL';
  }
}

/** The core's origin filter of a `source`. */
function originOf(source: JournalSource): FinEntryOrigin {
  switch (source) {
    case 'MANUAL':
      return { system: FIN_SOURCE, docType: [MANUAL_DOC_TYPE] };
    case 'OPENING':
      return { system: FIN_SOURCE, docType: 'OPENING' };
    case 'AUTO_VOID':
      return {
        system: [BTO_SOURCE, FIN_SOURCE],
        docType: [
          FIN_DOC_TYPES.SALES_INVOICE.docType,
          FIN_DOC_TYPES.SALES_RETURN.docType,
          'POS_SHIFT',
          ...VOUCHER_DOC_TYPES,
        ],
        reversal: true,
      };
    case 'AUTO_INVOICE':
      return { system: BTO_SOURCE, docType: FIN_DOC_TYPES.SALES_INVOICE.docType, reversal: false };
    case 'AUTO_PAYMENT':
      return { system: FIN_SOURCE, docType: [...VOUCHER_DOC_TYPES], reversal: false };
    case 'AUTO_CREDIT_NOTE':
      return { system: BTO_SOURCE, docType: FIN_DOC_TYPES.SALES_RETURN.docType, reversal: false };
    case 'AUTO_POS_SHIFT':
      return { system: BTO_SOURCE, docType: 'POS_SHIFT', reversal: false };
  }
}

/** The document behind an automatic entry as today's API names it (none on a reversal). */
function sourceDocOf(row: FinEntrySummary): { type: JournalSourceDocType; id: number } | null {
  const source = sourceOf(row);
  if (source === 'AUTO_VOID' || source === 'MANUAL' || source === 'OPENING') return null;
  if (source === 'AUTO_PAYMENT') {
    return row.documentId === null ? null : { type: 'PAYMENT', id: row.documentId };
  }
  if (row.sourceDocId === null || !/^\d+$/.test(row.sourceDocId)) return null;
  const type: JournalSourceDocType | undefined =
    source === 'AUTO_INVOICE'
      ? 'INVOICE'
      : source === 'AUTO_CREDIT_NOTE'
        ? 'CREDIT_NOTE'
        : JOURNAL_SOURCE_DOC_TYPES.find((own) => own === row.sourceDocType);
  return type === undefined ? null : { type, id: Number.parseInt(row.sourceDocId, 10) };
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
