import { Inject, Injectable } from '@nestjs/common';
import type { LineV1 } from '@tugeel/fin-contract';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import {
  type FinAccountPartyBalance,
  FinError,
  FinReader,
  FinReports,
  type FinTrialBalance,
  type FinVatReport,
} from '../../../finance-core';
import {
  FIN_DOC_TYPES,
  FIN_SOURCE,
  FinPartiesBridge,
  MANUAL_KEY,
  POSTING_KEY_OF_ROLE,
} from '../../fin-bridge';
import type { AuthContext } from '../../identity';
import { CustomersService, SuppliersService } from '../../partners';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';

/** pg_advisory_xact_lock key per year while a year close posts or reverses (ADR-0105 #4). */
const YEAR_CLOSE_LOCK = 72_029_105;
/** Accounts per closing document: the contract's 500 lines less the retained-earnings line. */
export const YEAR_CLOSE_ACCOUNTS_PER_DOCUMENT = 499;
const YEAR_CLOSE_DOC_TYPE = FIN_DOC_TYPES.YEAR_CLOSE.docType;

/** The year close of one year as «Сарын хаалт» shows it. */
export interface YearCloseStatus {
  year: number;
  /** 31 December has passed. */
  ended: boolean;
  /** The live closing documents (none: not closed). */
  documents: { id: number; number: string; date: string }[];
  /** What is still to close on 31 December: income, expense and the profit (income − expense). */
  income: Decimal;
  expense: Decimal;
  profit: Decimal;
}

/** One account × party balance of the opening's sign-off, the party as Bto knows it. */
export interface OpeningCheckRow {
  accountCode: string;
  accountName: string;
  /** null: the account's lines without a party. */
  partyKind: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | null;
  partyCode: string | null;
  partyName: string | null;
  /** Debit − credit at the date. */
  balance: Decimal;
}

/** The opening's sign-off against Erkhet's closing trial balance (ADR-0106 #5, questionnaire 2.7). */
export interface OpeningCheck {
  date: string;
  /** The live opening (its first document), or null when none stands. */
  opening: { number: string; date: string } | null;
  rows: OpeningCheckRow[];
  debit: Decimal;
  credit: Decimal;
}

const money = (value: Decimal): string => value.toFixed(2);
const yearEnd = (year: number): string => `${year}-12-31`;

/**
 * The reports of F6 (ADR-0105) on Bto's side: the trial balance and the month's VAT through the
 * Finance Core's `FinReports`, their Excel files, and the year close — income and expense into
 * retained earnings on 31 December as `FIN.YEAR_CLOSE` documents of the staff member (source FIN),
 * keyed `FIN/YEAR_CLOSE/<year>.<attempt>.<n>`, reversed on the same day.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly books: FinBooks,
    private readonly reports: FinReports,
    private readonly reader: FinReader,
    private readonly posting: FinPosting,
    private readonly parties: FinPartiesBridge,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
  ) {}

  /**
   * Every balance per account × party at `date` — by default the live opening's date, else the last
   * day of the previous month — for the accountant to compare with Erkhet's closing trial balance
   * and sign (ADR-0106 #5).
   */
  async openingCheck(ctx: AuthContext, date?: string): Promise<OpeningCheck> {
    const company = await this.books.company();
    const live = await this.reader.documents(this.books.source(), {
      company,
      typeCodes: [FIN_DOC_TYPES.OPENING.code],
      reversed: false,
      limit: 1,
    });
    const first = live.rows[0];
    const opening = first ? { number: first.number, date: first.accountingDate } : null;
    const on = date ?? opening?.date ?? addDays(`${businessDate().slice(0, 7)}-01`, -1);
    const balances = await this.reports.accountPartyBalances(this.books.user(ctx), {
      company,
      date: on,
    });
    const rows = await this.withParties(balances);
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const row of rows) {
      if (row.balance.gt(0)) debit = debit.plus(row.balance);
      else credit = credit.minus(row.balance);
    }
    return { date: on, opening, rows, debit, credit };
  }

  /** The sign-off as an Excel sheet: account, party, debit, credit, the totals last. */
  async openingCheckWorkbook(ctx: AuthContext, date?: string): Promise<Buffer> {
    const report = await this.openingCheck(ctx, date);
    const labels = mn.finance.reports.openingCheck.columns;
    const columns: ExcelColumn[] = [
      { name: labels.accountCode, kind: 'text' },
      { name: labels.accountName, kind: 'text' },
      { name: labels.partyCode, kind: 'text' },
      { name: labels.partyName, kind: 'text' },
      { name: labels.debit, kind: 'number' },
      { name: labels.credit, kind: 'number' },
    ];
    const rows: ExcelRow[] = report.rows.map((row) => [
      row.accountCode,
      row.accountName,
      row.partyCode,
      row.partyName,
      row.balance.gt(0) ? money(row.balance) : '0.00',
      row.balance.lt(0) ? money(row.balance.negated()) : '0.00',
    ]);
    rows.push([null, labels.total, null, null, money(report.debit), money(report.credit)]);
    return tableWorkbook(
      `${mn.finance.reports.openingCheck.title} ${report.date}`,
      { yes: '', no: '' },
      (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
    );
  }

  /** The core's party of each balance as a Bto customer or supplier (code and name). */
  private async withParties(balances: FinAccountPartyBalance[]): Promise<OpeningCheckRow[]> {
    const partyIds = [
      ...new Set(balances.flatMap((row) => (row.partyId === null ? [] : [row.partyId]))),
    ];
    const [customerOf, supplierOf] = await Promise.all([
      this.parties.customersOfParties(partyIds),
      this.parties.suppliersOfParties(partyIds),
    ]);
    const [customers, suppliers] = await Promise.all([
      this.customers.getMany([...new Set(customerOf.values())]),
      this.suppliers.getMany([...new Set(supplierOf.values())]),
    ]);
    const customerById = new Map(customers.map((row) => [row.id, row]));
    const supplierById = new Map(suppliers.map((row) => [row.id, row]));
    return balances.map((row) => {
      const base = {
        accountCode: row.code,
        accountName: row.name,
        balance: row.balance,
      };
      if (row.partyId === null) {
        return { ...base, partyKind: null, partyCode: null, partyName: null };
      }
      const customerId = customerOf.get(row.partyId);
      const customer = customerId === undefined ? undefined : customerById.get(customerId);
      if (customer) {
        return {
          ...base,
          partyKind: 'CUSTOMER',
          partyCode: customer.code,
          partyName: customer.name,
        };
      }
      const supplierId = supplierOf.get(row.partyId);
      const supplier = supplierId === undefined ? undefined : supplierById.get(supplierId);
      if (supplier) {
        return {
          ...base,
          partyKind: 'SUPPLIER',
          partyCode: supplier.code,
          partyName: supplier.name,
        };
      }
      return { ...base, partyKind: 'OTHER', partyCode: null, partyName: row.partyName };
    });
  }

  async trialBalance(
    ctx: AuthContext,
    query: { from: string; to: string; all?: boolean },
  ): Promise<FinTrialBalance> {
    return this.reports.trialBalance(this.books.user(ctx), {
      company: await this.books.company(),
      ...query,
    });
  }

  async vat(ctx: AuthContext, period: string): Promise<FinVatReport> {
    return this.reports.vatReport(this.books.user(ctx), {
      company: await this.books.company(),
      period,
    });
  }

  /** The trial balance as an Excel sheet: debit and credit columns of each balance. */
  async trialBalanceWorkbook(
    ctx: AuthContext,
    query: { from: string; to: string; all?: boolean },
  ): Promise<Buffer> {
    const report = await this.trialBalance(ctx, query);
    const labels = mn.finance.reports.trialBalance.columns;
    const columns: ExcelColumn[] = [
      { name: labels.code, kind: 'text' },
      { name: labels.name, kind: 'text' },
      { name: labels.group, kind: 'text' },
      { name: labels.openingDebit, kind: 'number' },
      { name: labels.openingCredit, kind: 'number' },
      { name: labels.debit, kind: 'number' },
      { name: labels.credit, kind: 'number' },
      { name: labels.closingDebit, kind: 'number' },
      { name: labels.closingCredit, kind: 'number' },
    ];
    const side = (value: Decimal): [string, string] =>
      value.gte(0) ? [money(value), '0.00'] : ['0.00', money(value.negated())];
    const rows: ExcelRow[] = report.rows.map((row) => [
      row.code,
      row.name,
      row.group ? `${row.group.code} ${row.group.name}` : null,
      ...side(row.opening),
      money(row.debit),
      money(row.credit),
      ...side(row.closing),
    ]);
    const sum = (
      pick: (value: Decimal) => Decimal,
      of: (row: (typeof report.rows)[number]) => Decimal,
    ) => money(report.rows.reduce((total, row) => total.plus(pick(of(row))), new Decimal(0)));
    const debitPart = (value: Decimal) => (value.gt(0) ? value : new Decimal(0));
    const creditPart = (value: Decimal) => (value.lt(0) ? value.negated() : new Decimal(0));
    rows.push([
      null,
      labels.total,
      null,
      sum(debitPart, (row) => row.opening),
      sum(creditPart, (row) => row.opening),
      money(report.totals.debit),
      money(report.totals.credit),
      sum(debitPart, (row) => row.closing),
      sum(creditPart, (row) => row.closing),
    ]);
    return tableWorkbook(
      `${mn.finance.reports.trialBalance.title} ${query.from} – ${query.to}`,
      { yes: '', no: '' },
      (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
    );
  }

  /** The month's VAT documents as an Excel sheet, the totals last. */
  async vatWorkbook(ctx: AuthContext, period: string): Promise<Buffer> {
    const report = await this.vat(ctx, period);
    const labels = mn.finance.reports.vat.columns;
    const columns: ExcelColumn[] = [
      { name: labels.date, kind: 'date' },
      { name: labels.entry, kind: 'text' },
      { name: labels.document, kind: 'text' },
      { name: labels.type, kind: 'text' },
      { name: labels.base, kind: 'number' },
      { name: labels.output, kind: 'number' },
      { name: labels.input, kind: 'number' },
    ];
    const rows: ExcelRow[] = report.documents.map((row) => [
      row.entryDate,
      row.entryNumber,
      row.documentNumber,
      docTypeLabel(row.system, row.docType),
      money(row.base),
      money(row.output),
      money(row.input),
    ]);
    rows.push([null, null, null, labels.total, null, money(report.output), money(report.input)]);
    rows.push([null, null, null, labels.payable, null, money(report.payable), null]);
    return tableWorkbook(
      `${mn.finance.reports.vat.title} ${period}`,
      { yes: '', no: '' },
      (sheet) => Promise.resolve(sheet.addRows(columns, rows)),
    );
  }

  async yearCloseStatus(ctx: AuthContext, year: number): Promise<YearCloseStatus> {
    const company = await this.books.company();
    const live = await this.closingDocuments(year, false);
    const balances = await this.reports.resultBalances(this.books.user(ctx), {
      company,
      asOf: yearEnd(year),
    });
    let income = new Decimal(0);
    let expense = new Decimal(0);
    for (const row of balances) {
      if (row.kind === 'INCOME') income = income.minus(row.balance);
      else expense = expense.plus(row.balance);
    }
    return {
      year,
      ended: yearEnd(year) < businessDate(),
      documents: live.map((row) => ({ id: row.id, number: row.number, date: row.documentDate })),
      income,
      expense,
      profit: income.minus(expense),
    };
  }

  /**
   * Closes `year` (ADR-0105 #4): every INCOME and EXPENSE account's balance up to 31 December posted
   * away against RETAINED_EARNINGS on that day, in documents of 499 accounts. Refused before the year
   * has ended (FIN_PERIOD_NOT_ENDED), while a closing of the year stands (FIN_CLASS_RULE
   * YEAR_CLOSED), with nothing to close (NOTHING_TO_CLOSE), or in a closed December (the period).
   */
  async closeYear(ctx: AuthContext, year: number): Promise<YearCloseStatus> {
    if (!(yearEnd(year) < businessDate())) {
      throw new FinError('FIN_PERIOD_NOT_ENDED', undefined, {
        period: `${year}-12`,
        endsOn: yearEnd(year),
      });
    }
    const company = await this.books.company();
    const user = this.books.user(ctx);
    await inTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${YEAR_CLOSE_LOCK}, ${year})`);
      if ((await this.closingDocuments(year, false)).length > 0) {
        throw new FinError('FIN_CLASS_RULE', undefined, { rule: 'YEAR_CLOSED', year });
      }
      const reversed = await this.closingDocuments(year, true);
      const attempt =
        1 + new Set(reversed.map((row) => row.sourceDocId.split('.').slice(0, 2).join('.'))).size;
      const balances = await this.reports.resultBalances(
        user,
        { company, asOf: yearEnd(year) },
        this.books.executor(tx),
      );
      if (balances.length === 0) {
        throw new FinError('FIN_CLASS_RULE', undefined, { rule: 'NOTHING_TO_CLOSE', year });
      }
      for (let start = 0, n = 1; start < balances.length; n += 1) {
        const chunk = balances.slice(start, start + YEAR_CLOSE_ACCOUNTS_PER_DOCUMENT);
        start += chunk.length;
        const lines: LineV1[] = [];
        let net = new Decimal(0);
        for (const row of chunk) {
          net = net.plus(row.balance);
          lines.push({
            lineNo: lines.length + 1,
            key: MANUAL_KEY,
            side: row.balance.gt(0) ? 'CREDIT' : 'DEBIT',
            amount: money(row.balance.abs()),
            accountCode: row.code,
          });
        }
        let debit = chunk.reduce(
          (total, row) => (row.balance.lt(0) ? total.plus(row.balance.negated()) : total),
          new Decimal(0),
        );
        if (!net.isZero()) {
          // A profit (credit balances above debit ones) credits retained earnings; a loss debits it.
          lines.push({
            lineNo: lines.length + 1,
            key: POSTING_KEY_OF_ROLE.RETAINED_EARNINGS.code,
            side: net.gt(0) ? 'DEBIT' : 'CREDIT',
            amount: money(net.abs()),
          });
          if (net.gt(0)) debit = debit.plus(net);
        }
        await this.posting.submitInTx(tx, user, {
          source: {
            system: FIN_SOURCE,
            docType: YEAR_CLOSE_DOC_TYPE,
            docId: `${year}.${attempt}.${n}`,
          },
          body: {
            action: 'POST',
            documentType: FIN_DOC_TYPES.YEAR_CLOSE.code,
            documentDate: yearEnd(year),
            currency: 'MNT',
            description: `${mn.finance.reports.yearClose.documentDescription} ${year}`,
            controlTotal: money(debit),
            lines,
          },
        });
      }
    });
    return this.yearCloseStatus(ctx, year);
  }

  /** Reverses the year's live closing documents on 31 December (December must be open). */
  async revertYear(ctx: AuthContext, year: number): Promise<YearCloseStatus> {
    const user = this.books.user(ctx);
    await inTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${YEAR_CLOSE_LOCK}, ${year})`);
      const live = await this.closingDocuments(year, false);
      if (live.length === 0) {
        throw new FinError('FIN_CLASS_RULE', undefined, { rule: 'YEAR_NOT_CLOSED', year });
      }
      for (const document of live) {
        await this.posting.submitInTx(tx, user, {
          source: { system: FIN_SOURCE, docType: YEAR_CLOSE_DOC_TYPE, docId: document.sourceDocId },
          body: {
            action: 'REVERSE',
            accountingDate: yearEnd(year),
            reason: mn.finance.reports.yearClose.revertReason,
          },
        });
      }
    });
    return this.yearCloseStatus(ctx, year);
  }

  /** The year's closing documents, live or reversed, oldest first. */
  private async closingDocuments(year: number, reversed: boolean) {
    const { rows } = await this.reader.documents(this.books.source(), {
      company: await this.books.company(),
      typeCodes: [FIN_DOC_TYPES.YEAR_CLOSE.code],
      reversed,
      from: yearEnd(year),
      to: yearEnd(year),
    });
    return rows.filter((row) => row.sourceDocId.startsWith(`${year}.`)).reverse();
  }
}

/** The label of a VAT document's kind (mn.json `finance.reports.vat.docTypes`). */
export function docTypeLabel(system: string, docType: string | null): string {
  const labels: Record<string, string> = mn.finance.reports.vat.docTypes;
  if (system === FIN_SOURCE && (docType === null || docType === 'JOURNAL'))
    return labels.MANUAL ?? '';
  return labels[docType ?? ''] ?? labels.OTHER ?? '';
}
