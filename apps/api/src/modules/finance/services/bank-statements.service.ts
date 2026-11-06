import { Inject, Injectable } from '@nestjs/common';
import {
  BANK_STATEMENT_LIMITS,
  type BankExportFile,
  type BankExportType,
  type BankLineAction,
  type BankLineKind,
  type BankLineMissing,
  FINANCE_LIMITS,
} from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { type ErkhetRow, erkhetWorkbook } from '../../../common/excel/erkhet-workbook';
import { CodedError } from '../../../common/errors/coded-error';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, StorageService } from '../../identity';
import { CustomersService, SuppliersService } from '../../partners';
import { bankStatementLines, bankStatements, bankStatementSettings, invoices } from '../schema';
import { dateInDescription, kindOfLine, parseBankStatement } from './bank-statement-parser';
import { type GlAccount, GlAccountsService } from './gl-accounts.service';
import { JournalService } from './journal.service';
import { type MoneyAccount, MoneyAccountsService } from './money-accounts.service';
import { PaymentsService } from './payments.service';

const TEXT = mn.finance.bankStatements;

/** The company's own codes the rules start from until the settings are saved (the old tool's). */
const DEFAULT_SETTLEMENT_CODE = '120105';
const DEFAULT_FEE_CODE = '703012';
const DEFAULT_PARTY_CODE = '30000';

type LineRow = typeof bankStatementLines.$inferSelect;
type StatementRow = typeof bankStatements.$inferSelect;

export interface BankRules {
  settlementAccountId: number | null;
  settlementDescription: string;
  settlementAction: BankLineAction;
  feeAccountId: number | null;
  feeDescription: string;
  feeAction: BankLineAction;
  feeExportType: BankExportType;
  partyCode: string;
  counterAccountIds: number[];
}

export interface BankStatementSummary {
  id: number;
  accountNumber: string;
  currency: string;
  statementDate: string;
  dateTo: string;
  fileName: string;
  uploadedAt: Date;
  /** The money account the number was recognised as, or the accountant's own link. */
  moneyAccountId: number | null;
  moneyAccountName: string | null;
  /** The chart's code of its account, Erkhet's «Дансны код». */
  accountCode: string | null;
  lineCount: number;
  feeCount: number;
  totalCredit: Decimal;
  totalDebit: Decimal;
  filledCount: number;
  postedCount: number;
  missing: Record<BankLineMissing, number>;
}

export interface BankLineView {
  id: number;
  lineNo: number;
  txnAt: Date;
  businessDate: string;
  debit: Decimal;
  credit: Decimal;
  bankDescription: string;
  bankCounterpart: string;
  kind: BankLineKind;
  customerId: number | null;
  customerName: string | null;
  customerCode: string | null;
  supplierId: number | null;
  supplierName: string | null;
  supplierCode: string | null;
  counterAccountId: number | null;
  counterAccountCode: string | null;
  counterAccountName: string | null;
  description: string;
  action: BankLineAction | null;
  exportType: BankExportType | null;
  paymentId: number | null;
  journalEntryId: number | null;
  postedAt: Date | null;
  missing: BankLineMissing[];
}

export interface BankStatementDetail extends BankStatementSummary {
  lines: BankLineView[];
}

export interface BankUploadResult {
  /** Null when every line of the file was here already. */
  statement: BankStatementSummary | null;
  newLines: number;
  duplicateLines: number;
}

export interface BankLinePatch {
  customerId?: number | null;
  supplierId?: number | null;
  counterAccountId?: number | null;
  description?: string;
  action?: BankLineAction | null;
  exportType?: BankExportType | null;
}

export interface BankPostFailure {
  lineId: number;
  lineNo: number;
  code: string;
  detail: string;
}

export interface BankPostResult {
  posted: number;
  skipped: number;
  failures: BankPostFailure[];
  statement: BankStatementDetail;
}

/** What one read needs of the books: accounts by id, money accounts, the receivable and payable. */
interface Books {
  accounts: Map<number, GlAccount>;
  money: MoneyAccount[];
  arId: number | null;
  apId: number | null;
  rules: BankRules;
}

const DIGITS_AROUND = (number: string) => new RegExp(`(^|\\D)${number}(\\D|$)`);

/** The fields of a line the rules fill; the rest stays what the accountant wrote. */
function ruleFill(
  kind: BankLineKind,
  bankDescription: string,
  debit: Decimal,
  rules: BankRules,
): Pick<LineRow, 'counterAccountId' | 'description' | 'action' | 'exportType'> {
  if (kind === 'FEE') {
    return {
      counterAccountId: rules.feeAccountId,
      description: rules.feeDescription,
      action: rules.feeAction,
      exportType: rules.feeExportType,
    };
  }
  if (kind === 'SETTLEMENT') {
    return {
      counterAccountId: rules.settlementAccountId,
      description: [rules.settlementDescription.trim(), bankDescription.trim()]
        .filter(Boolean)
        .join(' '),
      action: rules.settlementAction,
      exportType: null,
    };
  }
  return {
    counterAccountId: null,
    description: withPrefix(bankDescription),
    action: 'CLOSE',
    exportType: debit.gt(0) ? 'BANK' : null,
  };
}

/** «Дансаар - <банкны утга>», or «Дансаар» when the bank wrote nothing. */
function withPrefix(bankDescription: string): string {
  const text = bankDescription.trim();
  const full = text
    ? `${TEXT.defaults.lineDescriptionPrefix} - ${text}`
    : TEXT.defaults.lineDescriptionPrefix;
  return full.slice(0, BANK_STATEMENT_LIMITS.maxDescription);
}

/**
 * «Тооцоо хаах» (ADR-0169): the accountant uploads the bank's daily statements, fills each line (party,
 * counter account, text, action) and writes the ready lines to the books: a customer's money on the
 * receivable account is a voucher settling their oldest invoices, every other line a journal entry on
 * the statement's bank account. Each line's posting and its mark happen in one transaction with the
 * line locked, so a line is in the books once; a mistake is taken back by the document's own reversal,
 * and the line opens again. Until Erkhet stops, the same lines also export as Erkhet's import files.
 */
@Injectable()
export class BankStatementsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
    private readonly accounts: GlAccountsService,
    private readonly moneyAccounts: MoneyAccountsService,
    private readonly journal: JournalService,
    private readonly payments: PaymentsService,
  ) {}

  // ---- Reading ----

  /** How many statements each day of a month holds. */
  async calendar(from: string, to: string): Promise<{ date: string; count: number }[]> {
    const count = sql<string>`count(*)`;
    const rows = await this.db
      .select({ date: bankStatements.statementDate, count })
      .from(bankStatements)
      .where(and(gte(bankStatements.statementDate, from), lte(bankStatements.statementDate, to)))
      .groupBy(bankStatements.statementDate)
      .orderBy(bankStatements.statementDate);
    return rows.map((row) => ({ date: row.date, count: Number.parseInt(row.count, 10) }));
  }

  async byDate(date: string): Promise<BankStatementSummary[]> {
    const rows = await this.db
      .select()
      .from(bankStatements)
      .where(eq(bankStatements.statementDate, date))
      .orderBy(asc(bankStatements.accountNumber), asc(bankStatements.id));
    if (rows.length === 0) return [];
    const books = await this.books();
    const lines = await this.db
      .select()
      .from(bankStatementLines)
      .where(
        inArray(
          bankStatementLines.statementId,
          rows.map((row) => row.id),
        ),
      );
    return rows.map((row) =>
      summaryOf(
        row,
        lines.filter((line) => line.statementId === row.id),
        books,
      ),
    );
  }

  async get(id: number): Promise<BankStatementDetail> {
    const statement = await this.statement(id, this.db);
    const books = await this.books();
    const lines = await this.linesOf(id, this.db);
    return {
      ...summaryOf(statement, lines, books),
      lines: await this.views(lines, books),
    };
  }

  // ---- Upload ----

  /**
   * Takes an uploaded file: its lines not seen before become a new statement, filled from the rules
   * and from what the accountant chose last time for the same counterpart. A file seen whole adds
   * nothing; a later file of the same day adds its new lines (ADR-0169 #2).
   */
  async upload(
    ctx: AuthContext,
    input: { fileId: number; fileName: string },
  ): Promise<BankUploadResult> {
    await this.storage.verifyUploaded(input.fileId, 'finance.bank_statement');
    await inTransaction(this.db, (tx) =>
      this.storage.confirm(tx, input.fileId, 'finance.bank_statement'),
    );
    const opened = await this.storage.openPrivate(input.fileId, 'finance.bank_statement');
    let parsed;
    try {
      parsed = await parseBankStatement(await readAll(opened.body), input.fileName);
    } catch (error) {
      await inTransaction(this.db, (tx) => this.storage.markDeleted(tx, input.fileId));
      throw error;
    }
    const books = await this.books();
    const history = await this.history(parsed.lines);
    const invoiceCustomers = await this.invoiceCustomers(parsed.lines);
    const earlierLink = await this.earlierLink(parsed.accountNumber);

    const result = await inTransaction(this.db, async (tx) => {
      const [statement] = await tx
        .insert(bankStatements)
        .values({
          accountNumber: parsed.accountNumber,
          currency: parsed.currency,
          statementDate: parsed.statementDate,
          dateTo: parsed.dateTo,
          fileName: input.fileName.slice(0, 300),
          fileId: input.fileId,
          moneyAccountId: earlierLink,
          uploadedBy: ctx.userId,
        })
        .returning();
      if (!statement) throw new Error('the statement was not saved');
      const inserted = await tx
        .insert(bankStatementLines)
        .values(
          parsed.lines.map((line) => {
            const fill = ruleFill(line.kind, line.bankDescription, line.debit, books.rules);
            const suggested =
              line.kind === 'NORMAL'
                ? suggestion(line, history, invoiceCustomers, books)
                : { customerId: null, supplierId: null, counterAccountId: null };
            return {
              statementId: statement.id,
              lineNo: line.lineNo,
              txnAt: line.txnAt,
              businessDate: line.businessDate,
              debit: line.debit,
              credit: line.credit,
              bankDescription: line.bankDescription,
              bankCounterpart: line.bankCounterpart,
              kind: line.kind,
              dedupeKey: line.dedupeKey,
              ...fill,
              customerId: suggested.customerId,
              supplierId: suggested.supplierId,
              counterAccountId: fill.counterAccountId ?? suggested.counterAccountId,
            };
          }),
        )
        .onConflictDoNothing({ target: bankStatementLines.dedupeKey })
        .returning({ id: bankStatementLines.id });
      if (inserted.length === 0) {
        await tx.delete(bankStatements).where(eq(bankStatements.id, statement.id));
        await this.storage.markDeleted(tx, input.fileId);
        return { statementId: null, newLines: 0 };
      }
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'bank_statements',
        entityId: statement.id,
        after: {
          accountNumber: parsed.accountNumber,
          statementDate: parsed.statementDate,
          lines: inserted.length,
        },
      });
      return { statementId: statement.id, newLines: inserted.length };
    });
    const duplicateLines = parsed.lines.length - result.newLines;
    if (result.statementId === null) return { statement: null, newLines: 0, duplicateLines };
    const statement = await this.statement(result.statementId, this.db);
    return {
      statement: summaryOf(statement, await this.linesOf(statement.id, this.db), books),
      newLines: result.newLines,
      duplicateLines,
    };
  }

  /** The statement's account chosen by hand, for every statement of that number (ADR-0169 #4). */
  async linkMoneyAccount(
    ctx: AuthContext,
    id: number,
    moneyAccountId: number,
  ): Promise<BankStatementSummary> {
    const statement = await this.statement(id, this.db);
    const account = await this.moneyAccounts.get(moneyAccountId);
    if (account.kind !== 'BANK' || account.status !== 'ACTIVE') {
      throw invalid('moneyAccountId', 'activeBank', 'an active bank account');
    }
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(bankStatements)
        .set({ moneyAccountId })
        .where(eq(bankStatements.accountNumber, statement.accountNumber));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bank_statements',
        entityId: id,
        before: { moneyAccountId: statement.moneyAccountId },
        after: { moneyAccountId },
      });
    });
    return summaryOf(
      await this.statement(id, this.db),
      await this.linesOf(id, this.db),
      await this.books(),
    );
  }

  /** Removes a statement nothing of which is in the books, so its file can come in again. */
  async remove(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [statement] = await tx
        .select()
        .from(bankStatements)
        .where(eq(bankStatements.id, id))
        .for('update');
      if (!statement) throw notFound('bank_statement', id);
      await this.assertNothingPosted(tx, id);
      await tx.delete(bankStatements).where(eq(bankStatements.id, id));
      if (statement.fileId !== null) await this.storage.markDeleted(tx, statement.fileId);
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'bank_statements',
        entityId: id,
        before: {
          accountNumber: statement.accountNumber,
          statementDate: statement.statementDate,
        },
      });
    });
  }

  /**
   * Debit and credit changed places on every line, for a file read the wrong way round (the old tool's
   * «⇄ Солих»): only while nothing of it is in the books. A line whose kind changes starts over.
   */
  async swap(ctx: AuthContext, id: number): Promise<BankStatementDetail> {
    const books = await this.books();
    await inTransaction(this.db, async (tx) => {
      await this.statement(id, tx);
      await this.assertNothingPosted(tx, id);
      const lines = await tx
        .select()
        .from(bankStatementLines)
        .where(eq(bankStatementLines.statementId, id))
        .orderBy(asc(bankStatementLines.id))
        .for('update');
      for (const line of lines) {
        const debit = line.credit;
        const credit = line.debit;
        const kind = kindOfLine(line.bankDescription, debit, credit);
        const fill = ruleFill(kind, line.bankDescription, debit, books.rules);
        await tx
          .update(bankStatementLines)
          .set({
            debit,
            credit,
            kind,
            ...(kind === line.kind && kind === 'NORMAL'
              ? { exportType: debit.gt(0) ? (line.exportType ?? 'BANK') : null }
              : { ...fill, customerId: null, supplierId: null }),
            updatedAt: new Date(),
          })
          .where(eq(bankStatementLines.id, line.id));
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bank_statements',
        entityId: id,
        after: { swapped: lines.length },
      });
    });
    return this.get(id);
  }

  // ---- Editing lines ----

  /** One cell's save: only the fields sent change, so two people on one statement never overwrite. */
  async updateLine(
    ctx: AuthContext,
    statementId: number,
    lineId: number,
    patch: BankLinePatch,
  ): Promise<BankLineView> {
    const books = await this.books();
    await this.assertParties(patch);
    const saved = await inTransaction(this.db, async (tx) => {
      const [line] = await tx
        .select()
        .from(bankStatementLines)
        .where(
          and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.statementId, statementId)),
        )
        .for('update');
      if (!line) throw notFound('bank_statement_line', lineId);
      assertEditable(line);
      const changes = this.patchFor(line, patch, books);
      const [row] = await tx
        .update(bankStatementLines)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(bankStatementLines.id, lineId))
        .returning();
      if (!row) throw new Error('the line was not saved');
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bank_statement_lines',
        entityId: lineId,
        after: { ...patch },
      });
      return row;
    });
    const [view] = await this.views([saved], books);
    if (!view) throw new Error('the line was not read back');
    return view;
  }

  /**
   * The bulk bar: the same fields on many lines, or each line's text made from its own bank text.
   * A posted line, a locked one (fee, settlement) or a line of another statement is left alone.
   */
  async updateLines(
    ctx: AuthContext,
    statementId: number,
    input: { lineIds: readonly number[]; patch: BankLinePatch; descriptionFromBank?: boolean },
  ): Promise<{ updated: number; statement: BankStatementDetail }> {
    await this.statement(statementId, this.db);
    const books = await this.books();
    await this.assertParties(input.patch);
    const updated = await inTransaction(this.db, async (tx) => {
      const lines = await tx
        .select()
        .from(bankStatementLines)
        .where(
          and(
            eq(bankStatementLines.statementId, statementId),
            inArray(bankStatementLines.id, [...input.lineIds]),
          ),
        )
        .orderBy(asc(bankStatementLines.id))
        .for('update');
      let count = 0;
      for (const line of lines) {
        if (line.postedAt !== null || line.kind !== 'NORMAL') continue;
        // The file is only money out's to choose: money in among the ticked lines just keeps its own.
        const { exportType, ...rest } = input.patch;
        const patch = line.debit.isZero() || exportType === undefined ? rest : input.patch;
        const changes = this.patchFor(line, patch, books);
        await tx
          .update(bankStatementLines)
          .set({
            ...changes,
            ...(input.descriptionFromBank ? { description: withPrefix(line.bankDescription) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(bankStatementLines.id, line.id));
        count += 1;
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bank_statements',
        entityId: statementId,
        after: { bulk: count, ...input.patch, descriptionFromBank: input.descriptionFromBank },
      });
      return count;
    });
    return { updated, statement: await this.get(statementId) };
  }

  // ---- Writing to the books ----

  /**
   * Writes the ready lines to the books, each in its own transaction, so one refused line (a closed
   * month, an inactive customer) leaves the others in. A statement's fees of a day are one entry, as
   * the old fee export summed them. Lines still lacking something are only counted.
   */
  async post(
    ctx: AuthContext,
    id: number,
    input: { lineIds?: readonly number[] },
  ): Promise<BankPostResult> {
    const statement = await this.statement(id, this.db);
    if (statement.currency !== 'MNT') {
      throw new AppError('BANK_STATEMENT_CURRENCY', `the statement is in ${statement.currency}`, {
        currency: statement.currency,
      });
    }
    const books = await this.books();
    const account = moneyAccountOf(statement, books);
    if (!account) {
      throw new AppError(
        'BANK_STATEMENT_UNLINKED',
        `account ${statement.accountNumber} is unknown`,
        {
          accountNumber: statement.accountNumber,
        },
      );
    }
    const chosen = input.lineIds ? new Set(input.lineIds) : null;
    const lines = (await this.linesOf(id, this.db)).filter(
      (line) => line.postedAt === null && (chosen === null || chosen.has(line.id)),
    );
    const ready = lines.filter((line) => missingOf(line, books).length === 0);
    const units: LineRow[][] = [];
    const fees = new Map<string, LineRow[]>();
    for (const line of ready) {
      if (line.kind !== 'FEE') {
        units.push([line]);
        continue;
      }
      const day = fees.get(line.businessDate) ?? [];
      day.push(line);
      fees.set(line.businessDate, day);
    }
    units.push(...fees.values());

    let posted = 0;
    const failures: BankPostFailure[] = [];
    for (const unit of units) {
      const first = unit[0];
      if (!first) continue;
      try {
        await this.postUnit(ctx, unit, account, books);
        posted += unit.length;
      } catch (error) {
        if (!(error instanceof CodedError)) throw error;
        // Another press got there first: the line is in the books once, as it should be.
        if (error.code === 'BANK_LINE_POSTED') continue;
        for (const line of unit) {
          failures.push({
            lineId: line.id,
            lineNo: line.lineNo,
            code: String(error.code),
            detail: error.message,
          });
        }
      }
    }
    return {
      posted,
      skipped: lines.length - ready.length,
      failures,
      statement: await this.get(id),
    };
  }

  /** One posting unit: locks its lines, books them, marks them, all or nothing. */
  private async postUnit(
    ctx: AuthContext,
    unit: readonly LineRow[],
    account: MoneyAccount,
    books: Books,
  ): Promise<void> {
    const ids = unit.map((line) => line.id);
    await inTransaction(this.db, async (tx) => {
      const locked = await tx
        .select()
        .from(bankStatementLines)
        .where(inArray(bankStatementLines.id, ids))
        .orderBy(asc(bankStatementLines.id))
        .for('update');
      const first = locked[0];
      if (!first || locked.length !== ids.length) {
        throw new AppError('NOT_FOUND', 'a line of the statement is gone', { id: ids[0] ?? 0 });
      }
      if (locked.some((line) => line.postedAt !== null)) {
        throw new AppError('BANK_LINE_POSTED', `line ${first.lineNo} is in the books already`, {
          lineNo: first.lineNo,
        });
      }
      const missing = locked.flatMap((line) => missingOf(line, books));
      if (missing.length > 0) {
        throw new AppError('BANK_LINE_INCOMPLETE', `line ${first.lineNo} changed and lacks data`, {
          lineNo: first.lineNo,
        });
      }
      const counter = books.accounts.get(first.counterAccountId ?? 0);
      if (!counter) throw invalid('counterAccountId', 'exists', 'a counter account');
      if (counter.id === account.glAccountId) {
        throw invalid('counterAccountId', 'different', 'another account than the bank');
      }
      const key = `bank-line-${first.id}-${first.postAttempt}`;
      const debit = locked.reduce((sum, line) => sum.plus(line.debit), new Decimal(0));
      const credit = locked.reduce((sum, line) => sum.plus(line.credit), new Decimal(0));
      const moneyIn = credit.gt(0);
      const amount = moneyIn ? credit : debit;
      const description = first.description.slice(0, FINANCE_LIMITS.maxDescription);
      const zero = new Decimal(0);
      let reference: { paymentId: number | null; journalEntryId: number | null };
      if (
        moneyIn &&
        first.customerId !== null &&
        counter.id === books.arId &&
        first.action !== 'CREATE'
      ) {
        // A customer's money on the receivable: a voucher settling the oldest invoices first; what is
        // left stays their open credit (ADR-0060 #5). «Үүсгэх» goes on as an entry, settling nothing.
        const voucher = await this.payments.recordInTx(tx, ctx, {
          kind: 'CUSTOMER_PAYMENT',
          moneyAccountId: account.id,
          customerId: first.customerId,
          glAccountId: null,
          amount,
          paidOn: first.businessDate,
          description,
          reference: first.bankCounterpart.slice(0, FINANCE_LIMITS.maxReference) || null,
          counterpartyName: null,
          collectedBy: null,
          key,
        });
        reference = { paymentId: voucher.id, journalEntryId: null };
      } else {
        const entryId = await this.journal.postManualInTx(
          tx,
          ctx,
          {
            entryDate: first.businessDate,
            description,
            lines: [
              {
                accountId: account.glAccountId,
                moneyAccountId: account.id,
                debit: moneyIn ? amount : zero,
                credit: moneyIn ? zero : amount,
              },
              {
                accountId: counter.id,
                debit: moneyIn ? zero : amount,
                credit: moneyIn ? amount : zero,
                customerId: first.customerId,
                supplierId: first.supplierId,
              },
            ],
          },
          key,
        );
        reference = { paymentId: null, journalEntryId: entryId };
      }
      await tx
        .update(bankStatementLines)
        .set({ ...reference, postedAt: new Date(), postedBy: ctx.userId, updatedAt: new Date() })
        .where(inArray(bankStatementLines.id, ids));
      await this.audit.record(tx, ctx, {
        action: 'POST',
        entity: 'bank_statement_lines',
        entityId: first.id,
        after: { ...reference, lines: ids, amount: amount.toFixed(2) },
      });
    });
  }

  /**
   * Takes a line back out of the books: its document's own reversal, dated today, and the line (with
   * the fee lines of the same entry) open for editing again. Each later posting has a new source key.
   */
  async reverseLine(
    ctx: AuthContext,
    statementId: number,
    lineId: number,
    reason: string,
  ): Promise<BankStatementDetail> {
    await inTransaction(this.db, async (tx) => {
      const [line] = await tx
        .select()
        .from(bankStatementLines)
        .where(
          and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.statementId, statementId)),
        )
        .for('update');
      if (!line) throw notFound('bank_statement_line', lineId);
      if (line.postedAt === null) {
        throw new AppError('BANK_LINE_LOCKED', `line ${line.lineNo} is not in the books`, {
          lineNo: line.lineNo,
        });
      }
      if (line.paymentId !== null) {
        await this.payments.voidInTx(tx, ctx, line.paymentId, reason);
      } else if (line.journalEntryId !== null) {
        await this.journal.reverseManualInTx(tx, ctx, line.journalEntryId, { description: reason });
      }
      await tx
        .update(bankStatementLines)
        .set({
          paymentId: null,
          journalEntryId: null,
          postedAt: null,
          postedBy: null,
          postAttempt: sql`${bankStatementLines.postAttempt} + 1`,
          updatedAt: new Date(),
        })
        .where(
          line.paymentId !== null
            ? eq(bankStatementLines.paymentId, line.paymentId)
            : eq(bankStatementLines.journalEntryId, line.journalEntryId ?? 0),
        );
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'bank_statement_lines',
        entityId: lineId,
        before: { paymentId: line.paymentId, journalEntryId: line.journalEntryId },
        after: { reason },
      });
    });
    return this.get(statementId);
  }

  // ---- The rules ----

  async rules(executor: Db | Tx = this.db): Promise<BankRules> {
    const [row] = await executor
      .select()
      .from(bankStatementSettings)
      .where(eq(bankStatementSettings.id, 1));
    if (row) {
      return {
        settlementAccountId: row.settlementAccountId,
        settlementDescription: row.settlementDescription,
        settlementAction: row.settlementAction,
        feeAccountId: row.feeAccountId,
        feeDescription: row.feeDescription,
        feeAction: row.feeAction,
        feeExportType: row.feeExportType,
        partyCode: row.partyCode,
        counterAccountIds: row.counterAccountIds,
      };
    }
    const accounts = await this.accounts.list(executor);
    const byCode = (code: string) =>
      accounts.find((account) => account.code === code && account.status === 'ACTIVE')?.id ?? null;
    const byRole = (role: GlAccount['role']) =>
      accounts.find((account) => account.role === role && account.status === 'ACTIVE')?.id ?? null;
    return {
      settlementAccountId: byCode(DEFAULT_SETTLEMENT_CODE) ?? byRole('CARD_CLEARING'),
      settlementDescription: TEXT.defaults.settlementDescription,
      settlementAction: 'CLOSE',
      feeAccountId: byCode(DEFAULT_FEE_CODE) ?? byRole('OTHER_EXPENSE'),
      feeDescription: TEXT.defaults.feeDescription,
      feeAction: 'CLOSE',
      feeExportType: 'BANK',
      partyCode: DEFAULT_PARTY_CODE,
      counterAccountIds: [],
    };
  }

  /**
   * Saves the rules and fills every fee and settlement line not yet in the books again, so a changed
   * rule needs no second button (the old tool's «дахин хэрэглэх»).
   */
  async saveRules(ctx: AuthContext, input: BankRules): Promise<BankRules> {
    const accountIds = [
      ...(input.settlementAccountId === null ? [] : [input.settlementAccountId]),
      ...(input.feeAccountId === null ? [] : [input.feeAccountId]),
      ...input.counterAccountIds,
    ];
    if (accountIds.length > 0) {
      const found = await this.accounts.activeByIds(accountIds, () => 'accountId');
      for (const account of found.values()) {
        if (account.journal === 'INVENTORY') {
          throw invalid('accountId', 'stockDocuments', 'stock accounts move through documents');
        }
      }
    }
    const values = {
      settlementAccountId: input.settlementAccountId,
      settlementDescription: input.settlementDescription.trim(),
      settlementAction: input.settlementAction,
      feeAccountId: input.feeAccountId,
      feeDescription: input.feeDescription.trim(),
      feeAction: input.feeAction,
      feeExportType: input.feeExportType,
      partyCode: input.partyCode.trim(),
      counterAccountIds: [...new Set(input.counterAccountIds)],
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    };
    await inTransaction(this.db, async (tx) => {
      await tx
        .insert(bankStatementSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({ target: bankStatementSettings.id, set: values });
      const open = await tx
        .select()
        .from(bankStatementLines)
        .where(
          and(
            isNull(bankStatementLines.postedAt),
            inArray(bankStatementLines.kind, ['FEE', 'SETTLEMENT']),
          ),
        )
        .orderBy(asc(bankStatementLines.id))
        .for('update');
      for (const line of open) {
        await tx
          .update(bankStatementLines)
          .set({
            ...ruleFill(line.kind, line.bankDescription, line.debit, values),
            updatedAt: new Date(),
          })
          .where(eq(bankStatementLines.id, line.id));
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'bank_statement_settings',
        entityId: 1,
        after: { ...values, updatedAt: undefined, refilled: open.length },
      });
    });
    return this.rules();
  }

  // ---- Erkhet's files ----

  /** How many lines each Erkhet file of a day holds, so the page downloads only those with lines. */
  async manifest(date: string): Promise<Record<BankExportFile, number> & { fees: number }> {
    const lines = await this.linesOfDate(date);
    return {
      RECEIVABLE: lines.filter((row) => fileOf(row.line) === 'RECEIVABLE').length,
      CASH: lines.filter((row) => fileOf(row.line) === 'CASH').length,
      BANK: lines.filter((row) => fileOf(row.line) === 'BANK').length,
      fees: lines.filter((row) => row.line.kind === 'FEE').length,
    };
  }

  /** One statement's Erkhet file. */
  async exportStatement(id: number, file: BankExportFile) {
    const statement = await this.statement(id, this.db);
    const lines = await this.linesOf(id, this.db);
    return this.exportFile(
      lines.map((line) => ({ line, statement })),
      file,
      `${statement.accountNumber}_${statement.statementDate}`,
    );
  }

  /** A day's statements in one Erkhet file: each row carries its own bank account's code. */
  async exportDate(date: string, file: BankExportFile) {
    return this.exportFile(await this.linesOfDate(date), file, date);
  }

  /** The bank fees of a period, summed per day and bank account, as the old fee export. */
  async exportFees(from: string, to: string) {
    const books = await this.books();
    const rows = await this.db
      .select({ line: bankStatementLines, statement: bankStatements })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(
        and(
          eq(bankStatementLines.kind, 'FEE'),
          gte(bankStatementLines.businessDate, from),
          lte(bankStatementLines.businessDate, to),
        ),
      );
    const sums = new Map<string, { date: string; code: string; total: Decimal }>();
    for (const { line, statement } of rows) {
      const code = moneyAccountOf(statement, books)?.glAccountCode ?? '';
      const key = `${line.businessDate}|${code}`;
      const sum = sums.get(key) ?? { date: line.businessDate, code, total: new Decimal(0) };
      sum.total = sum.total.plus(line.debit);
      sums.set(key, sum);
    }
    const feeCode = books.accounts.get(books.rules.feeAccountId ?? 0)?.code ?? DEFAULT_FEE_CODE;
    const out: ErkhetRow[] = [...sums.values()]
      .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code))
      .map((sum) => ({
        date: sum.date,
        cells: moneyCells(books.rules.feeDescription, books.rules.partyCode, feeCode, sum.code),
        amount: sum.total.toFixed(2),
      }));
    return {
      buffer: await erkhetWorkbook(TEXT.erkhet.feeSheet, TEXT.erkhet.moneyHeaders.split('|'), out),
      name: `${from}_${to}_${TEXT.erkhet.feeSheet}`,
      asciiName: `${from}_${to}_fees`,
    };
  }

  private async exportFile(
    rows: readonly { line: LineRow; statement: StatementRow }[],
    file: BankExportFile,
    label: string,
  ) {
    const books = await this.books();
    const chosen = rows.filter((row) => fileOf(row.line) === file);
    const parties = await this.partyCodes(chosen.map((row) => row.line));
    const out = chosen.map(({ line, statement }): ErkhetRow => {
      const bankCode = moneyAccountOf(statement, books)?.glAccountCode ?? '';
      const counterCode = books.accounts.get(line.counterAccountId ?? 0)?.code ?? '';
      const party =
        (line.customerId !== null
          ? parties.customers.get(line.customerId)
          : line.supplierId !== null
            ? parties.suppliers.get(line.supplierId)
            : undefined) ?? books.rules.partyCode;
      const text = line.description || line.bankDescription;
      if (file !== 'RECEIVABLE') {
        return {
          date: line.businessDate,
          cells: moneyCells(text, party, counterCode, bankCode),
          amount: line.debit.toFixed(2),
        };
      }
      const settlement = line.kind === 'SETTLEMENT';
      return {
        // A card settlement is dated by the day in its text, and its accounts stand the other way
        // round: the clearing account in «Дансны код», the bank in «Харьцсан данс» (the old tool).
        date: settlement
          ? (dateInDescription(line.bankDescription) ?? line.businessDate)
          : line.businessDate,
        cells: [
          text,
          null,
          party,
          settlement ? bankCode : counterCode,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          line.action === 'CLOSE_CREATE' ? 2 : line.action === null ? null : 1,
          settlement ? counterCode : bankCode,
          null,
          null,
          null,
        ],
        amount: line.credit.toFixed(2),
      };
    });
    const headers =
      file === 'RECEIVABLE' ? TEXT.erkhet.receivableHeaders : TEXT.erkhet.moneyHeaders;
    return {
      buffer: await erkhetWorkbook(TEXT.erkhet.sheet, headers.split('|'), out),
      name: `${label}_${TEXT.erkhet.files[file]}`,
      asciiName: `${label}_${file.toLowerCase()}`,
    };
  }

  // ---- Helpers ----

  private async books(): Promise<Books> {
    const [list, money, rules] = await Promise.all([
      this.accounts.list(),
      this.moneyAccounts.list(),
      this.rules(),
    ]);
    return {
      accounts: new Map(list.map((account) => [account.id, account])),
      money,
      arId: list.find((account) => account.role === 'AR')?.id ?? null,
      apId: list.find((account) => account.role === 'AP')?.id ?? null,
      rules,
    };
  }

  private async statement(id: number, executor: Db | Tx): Promise<StatementRow> {
    const [row] = await executor.select().from(bankStatements).where(eq(bankStatements.id, id));
    if (!row) throw notFound('bank_statement', id);
    return row;
  }

  private linesOf(id: number, executor: Db | Tx): Promise<LineRow[]> {
    return executor
      .select()
      .from(bankStatementLines)
      .where(eq(bankStatementLines.statementId, id))
      .orderBy(asc(bankStatementLines.lineNo));
  }

  private linesOfDate(date: string) {
    return this.db
      .select({ line: bankStatementLines, statement: bankStatements })
      .from(bankStatementLines)
      .innerJoin(bankStatements, eq(bankStatements.id, bankStatementLines.statementId))
      .where(eq(bankStatements.statementDate, date))
      .orderBy(
        asc(bankStatements.accountNumber),
        asc(bankStatements.id),
        asc(bankStatementLines.lineNo),
      );
  }

  private async assertNothingPosted(tx: Tx, id: number): Promise<void> {
    const [posted] = await tx
      .select({ id: bankStatementLines.id })
      .from(bankStatementLines)
      .where(and(eq(bankStatementLines.statementId, id), isNotNull(bankStatementLines.postedAt)))
      .limit(1);
    if (posted) {
      throw new AppError('BANK_STATEMENT_POSTED', `statement ${id} has lines in the books`, { id });
    }
  }

  /** What the accountant chose last for each counterpart, per direction of the money. */
  private async history(lines: readonly { bankCounterpart: string }[]) {
    const counterparts = [
      ...new Set(lines.map((line) => line.bankCounterpart).filter((value) => value !== '')),
    ];
    const known = new Map<
      string,
      Pick<LineRow, 'customerId' | 'supplierId' | 'counterAccountId'>
    >();
    if (counterparts.length === 0) return known;
    const rows = await this.db
      .select({
        counterpart: bankStatementLines.bankCounterpart,
        debit: bankStatementLines.debit,
        customerId: bankStatementLines.customerId,
        supplierId: bankStatementLines.supplierId,
        counterAccountId: bankStatementLines.counterAccountId,
      })
      .from(bankStatementLines)
      .where(
        and(
          inArray(bankStatementLines.bankCounterpart, counterparts),
          eq(bankStatementLines.kind, 'NORMAL'),
          isNotNull(bankStatementLines.counterAccountId),
        ),
      )
      .orderBy(desc(bankStatementLines.id))
      .limit(5000);
    for (const row of rows) {
      const key = `${row.counterpart}|${row.debit.gt(0) ? 'OUT' : 'IN'}`;
      if (!known.has(key)) known.set(key, row);
    }
    return known;
  }

  /** The customers of invoice numbers written in the bank's text: the strongest match of all. */
  private async invoiceCustomers(lines: readonly { bankDescription: string }[]) {
    const numbers = [...new Set(lines.flatMap((line) => invoiceNumbersIn(line.bankDescription)))];
    const customers = new Map<string, number>();
    if (numbers.length === 0) return customers;
    const rows = await this.db
      .select({ number: invoices.number, customerId: invoices.customerId })
      .from(invoices)
      .where(inArray(invoices.number, numbers));
    for (const row of rows) customers.set(row.number, row.customerId);
    return customers;
  }

  private async earlierLink(accountNumber: string): Promise<number | null> {
    const [row] = await this.db
      .select({ id: bankStatements.moneyAccountId })
      .from(bankStatements)
      .where(
        and(
          eq(bankStatements.accountNumber, accountNumber),
          isNotNull(bankStatements.moneyAccountId),
        ),
      )
      .orderBy(desc(bankStatements.id))
      .limit(1);
    return row?.id ?? null;
  }

  /** A party named on a line exists; the row's own FK would answer with a 500. */
  private async assertParties(patch: BankLinePatch): Promise<void> {
    if (patch.customerId != null) {
      const [found] = await this.customers.getMany([patch.customerId]);
      if (!found) throw invalid('customerId', 'exists', `customer ${patch.customerId}`);
    }
    if (patch.supplierId != null) {
      const [found] = await this.suppliers.getMany([patch.supplierId]);
      if (!found) throw invalid('supplierId', 'exists', `supplier ${patch.supplierId}`);
    }
  }

  private patchFor(line: LineRow, patch: BankLinePatch, books: Books): Partial<LineRow> {
    const changes: Partial<LineRow> = {};
    if (patch.customerId !== undefined && patch.supplierId != null && patch.customerId != null) {
      throw invalid('supplierId', 'oneParty', 'a customer or a supplier');
    }
    let counter = patch.counterAccountId;
    if (patch.customerId !== undefined) {
      changes.customerId = patch.customerId;
      if (patch.customerId !== null) {
        changes.supplierId = null;
        if (counter === undefined && line.counterAccountId === null) counter = books.arId;
      }
    }
    if (patch.supplierId !== undefined) {
      changes.supplierId = patch.supplierId;
      if (patch.supplierId !== null) {
        changes.customerId = null;
        if (counter === undefined && line.counterAccountId === null) counter = books.apId;
      }
    }
    if (counter !== undefined) {
      if (counter !== null) {
        const account = books.accounts.get(counter);
        if (!account || account.status !== 'ACTIVE') {
          throw invalid('counterAccountId', 'active', 'an active account');
        }
        if (account.journal === 'INVENTORY') {
          throw invalid(
            'counterAccountId',
            'stockDocuments',
            'stock accounts move through documents',
          );
        }
      }
      changes.counterAccountId = counter;
    }
    if (patch.description !== undefined) changes.description = patch.description.trim();
    if (patch.action !== undefined) changes.action = patch.action;
    if (patch.exportType !== undefined) {
      if (patch.exportType !== null && line.debit.isZero()) {
        throw invalid('exportType', 'debitOnly', 'only money out chooses its file');
      }
      changes.exportType = patch.exportType;
    }
    return changes;
  }

  private async partyCodes(lines: readonly LineRow[]) {
    const customerIds = [...new Set(lines.flatMap((l) => (l.customerId ? [l.customerId] : [])))];
    const supplierIds = [...new Set(lines.flatMap((l) => (l.supplierId ? [l.supplierId] : [])))];
    const [customers, suppliers] = await Promise.all([
      this.customers.getMany(customerIds),
      this.suppliers.getMany(supplierIds),
    ]);
    return {
      customers: new Map(customers.map((row) => [row.id, row.code])),
      suppliers: new Map(suppliers.map((row) => [row.id, row.code])),
    };
  }

  private async views(lines: readonly LineRow[], books: Books): Promise<BankLineView[]> {
    const customerIds = [...new Set(lines.flatMap((l) => (l.customerId ? [l.customerId] : [])))];
    const supplierIds = [...new Set(lines.flatMap((l) => (l.supplierId ? [l.supplierId] : [])))];
    const [customers, suppliers] = await Promise.all([
      this.customers.getMany(customerIds),
      this.suppliers.getMany(supplierIds),
    ]);
    const customer = new Map(customers.map((row) => [row.id, row]));
    const supplier = new Map(suppliers.map((row) => [row.id, row]));
    return lines.map((line) => {
      const account = books.accounts.get(line.counterAccountId ?? 0);
      const buyer = line.customerId === null ? undefined : customer.get(line.customerId);
      const seller = line.supplierId === null ? undefined : supplier.get(line.supplierId);
      return {
        id: line.id,
        lineNo: line.lineNo,
        txnAt: line.txnAt,
        businessDate: line.businessDate,
        debit: line.debit,
        credit: line.credit,
        bankDescription: line.bankDescription,
        bankCounterpart: line.bankCounterpart,
        kind: line.kind,
        customerId: line.customerId,
        customerName: buyer?.name ?? null,
        customerCode: buyer?.code ?? null,
        supplierId: line.supplierId,
        supplierName: seller?.name ?? null,
        supplierCode: seller?.code ?? null,
        counterAccountId: line.counterAccountId,
        counterAccountCode: account?.code ?? null,
        counterAccountName: account?.name ?? null,
        description: line.description,
        action: line.action,
        exportType: line.exportType,
        paymentId: line.paymentId,
        journalEntryId: line.journalEntryId,
        postedAt: line.postedAt,
        missing: missingOf(line, books),
      };
    });
  }
}

/** The Erkhet file a line goes to; a fee has its own export. */
function fileOf(line: LineRow): BankExportFile | null {
  if (line.kind === 'FEE') return null;
  if (line.credit.gt(0)) return 'RECEIVABLE';
  return line.exportType;
}

/** The columns between the date and the amount of Erkhet's cash and bank files. */
function moneyCells(
  description: string,
  party: string,
  counterCode: string,
  bankCode: string,
): (string | number | null)[] {
  return [
    description,
    party,
    counterCode,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    2,
    bankCode,
    null,
    null,
    null,
  ];
}

function assertEditable(line: LineRow): void {
  if (line.postedAt !== null) {
    throw new AppError('BANK_LINE_POSTED', `line ${line.lineNo} is in the books`, {
      lineNo: line.lineNo,
    });
  }
  if (line.kind !== 'NORMAL') {
    throw new AppError('BANK_LINE_LOCKED', `line ${line.lineNo} follows the settings`, {
      lineNo: line.lineNo,
    });
  }
}

/** What a line lacks before the books take it; a settlement or fee names no party. */
export function missingOf(line: LineRow, books: Books): BankLineMissing[] {
  const missing: BankLineMissing[] = [];
  const account =
    line.counterAccountId === null ? undefined : books.accounts.get(line.counterAccountId);
  if (!account) missing.push('account');
  if (
    line.kind === 'NORMAL' &&
    account?.journal === 'RECEIVABLE_PAYABLE' &&
    line.customerId === null &&
    line.supplierId === null
  ) {
    missing.push('party');
  }
  if (line.description.trim() === '') missing.push('description');
  if (line.action === null) missing.push('action');
  if (line.debit.gt(0) && line.exportType === null) missing.push('export');
  return missing;
}

/** The statement's money account: the link, the number on the account, the number in its name. */
function moneyAccountOf(statement: StatementRow, books: Books): MoneyAccount | null {
  if (statement.moneyAccountId !== null) {
    return books.money.find((row) => row.id === statement.moneyAccountId) ?? null;
  }
  const banks = books.money.filter((row) => row.kind === 'BANK' && row.status === 'ACTIVE');
  const exact = banks.find(
    (row) => row.bankAccountNo?.replace(/\D/g, '') === statement.accountNumber,
  );
  if (exact) return exact;
  const inName = DIGITS_AROUND(statement.accountNumber);
  return banks.find((row) => inName.test(row.name) || inName.test(row.glAccountName)) ?? null;
}

function summaryOf(
  statement: StatementRow,
  lines: readonly LineRow[],
  books: Books,
): BankStatementSummary {
  const account = moneyAccountOf(statement, books);
  const main = lines.filter((line) => line.kind !== 'FEE');
  const missing: Record<BankLineMissing, number> = {
    party: 0,
    account: 0,
    description: 0,
    action: 0,
    export: 0,
  };
  let filled = 0;
  for (const line of main) {
    const lacks = missingOf(line, books);
    for (const field of lacks) missing[field] += 1;
    if (lacks.length === 0) filled += 1;
  }
  return {
    id: statement.id,
    accountNumber: statement.accountNumber,
    currency: statement.currency,
    statementDate: statement.statementDate,
    dateTo: statement.dateTo,
    fileName: statement.fileName,
    uploadedAt: statement.uploadedAt,
    moneyAccountId: account?.id ?? null,
    moneyAccountName: account?.name ?? null,
    accountCode: account?.glAccountCode ?? null,
    lineCount: main.length,
    feeCount: lines.length - main.length,
    totalCredit: main.reduce((sum, line) => sum.plus(line.credit), new Decimal(0)),
    totalDebit: main.reduce((sum, line) => sum.plus(line.debit), new Decimal(0)),
    filledCount: filled,
    postedCount: main.filter((line) => line.postedAt !== null).length,
    missing,
  };
}

/** The numbers in the bank's text that look like Bto's invoices (`Н-20261016-0001`, ADR-0060 #8). */
function invoiceNumbersIn(text: string): string[] {
  return (text.match(/[A-ZА-ЯЁӨҮ]{1,4}-\d{6,8}-\d{1,8}/giu) ?? []).map((value) =>
    value.toUpperCase(),
  );
}

/** A line's party and account from its invoice number, else from the same counterpart's last line. */
function suggestion(
  line: { bankDescription: string; bankCounterpart: string; debit: Decimal; credit: Decimal },
  history: ReadonlyMap<string, Pick<LineRow, 'customerId' | 'supplierId' | 'counterAccountId'>>,
  invoiceCustomers: ReadonlyMap<string, number>,
  books: Books,
): Pick<LineRow, 'customerId' | 'supplierId' | 'counterAccountId'> {
  if (line.credit.gt(0)) {
    for (const number of invoiceNumbersIn(line.bankDescription)) {
      const customerId = invoiceCustomers.get(number);
      if (customerId !== undefined) {
        return { customerId, supplierId: null, counterAccountId: books.arId };
      }
    }
  }
  const direction = line.debit.gt(0) ? 'OUT' : 'IN';
  const known = history.get(`${line.bankCounterpart}|${direction}`);
  const counter =
    known?.counterAccountId != null &&
    books.accounts.get(known.counterAccountId)?.status === 'ACTIVE'
      ? known.counterAccountId
      : null;
  return {
    customerId: known?.customerId ?? null,
    supplierId: known?.supplierId ?? null,
    counterAccountId: counter,
  };
}

async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}
