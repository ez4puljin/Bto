import { Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import {
  type ExcelColumn,
  type ExcelRow,
  tableWorkbook,
} from '../../../common/excel/table-workbook';
import {
  type FinLedgerAccountOption,
  type FinLedgerControl,
  type FinLedgerFilter,
  type FinLedgerLines,
  type FinLedgerReportRow,
  FinReports,
} from '../../../finance-core';
import { FinPartiesBridge } from '../../fin-bridge';
import type { AuthContext } from '../../identity';
import { CustomersService, SuppliersService } from '../../partners';
import { FinBooks } from './fin-books';

/** The two ledger reports (ADR-0133): receivables and payables by party, and cash and bank. */
export const LEDGER_REPORT_KINDS = ['PARTY', 'MONEY'] as const;
export type LedgerReportKind = (typeof LEDGER_REPORT_KINDS)[number];

/** The accounts each report shows unless the caller picks accounts or groups. */
const KIND_CONTROLS: Record<LedgerReportKind, readonly FinLedgerControl[]> = {
  PARTY: ['RECEIVABLE', 'PAYABLE', 'ADVANCE_RECEIVED', 'ADVANCE_PAID'],
  MONEY: ['MONEY'],
};

/** What the report's prompt asks (Erkhet's «Тайлан авах» window). */
export interface LedgerReportQuery {
  kind: LedgerReportKind;
  from: string;
  to: string;
  accountIds?: readonly number[];
  groupCodes?: readonly string[];
  customerIds?: readonly number[];
  supplierIds?: readonly number[];
  /** Customers of this group. */
  customerCategoryId?: number;
  description?: string;
  counterAccount?: string;
  /** Also rows without an opening or a turnover. */
  withEmpty?: boolean;
}

/** The party of a row as Bto knows it. */
export interface LedgerParty {
  partyId: string;
  kind: 'CUSTOMER' | 'SUPPLIER' | 'OTHER';
  /** The customer's or supplier's id in Bto. */
  refId: number | null;
  code: string | null;
  name: string;
}

export interface LedgerReportRow extends Omit<FinLedgerReportRow, 'partyId' | 'partyName'> {
  party: LedgerParty | null;
}

export interface LedgerReport {
  kind: LedgerReportKind;
  from: string;
  to: string;
  rows: LedgerReportRow[];
  totals: { opening: Decimal; debit: Decimal; credit: Decimal; closing: Decimal };
}

export interface LedgerLines extends FinLedgerLines {
  /** Bto's parties of the lines, by the core's party id. */
  parties: Map<string, LedgerParty>;
}

/**
 * Erkhet's ledger reports on Bto's books (ADR-0133): «Авлага өглөгийн тайлан» — the receivable,
 * payable and advance accounts per account × party — and «Мөнгөн хөрөнгийн тайлан» — the cash
 * and bank accounts: the opening, the period's debit and credit and the closing, with the lines
 * behind each row. Through the Finance Core's `FinReports`; `finance.read`.
 */
@Injectable()
export class LedgerReportsService {
  constructor(
    private readonly books: FinBooks,
    private readonly reports: FinReports,
    private readonly parties: FinPartiesBridge,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
  ) {}

  async accounts(ctx: AuthContext): Promise<FinLedgerAccountOption[]> {
    return this.reports.ledgerAccounts(this.books.user(ctx), {
      company: await this.books.company(),
    });
  }

  async report(ctx: AuthContext, query: LedgerReportQuery): Promise<LedgerReport> {
    const filter = await this.filterOf(query);
    const totals = {
      opening: new Decimal(0),
      debit: new Decimal(0),
      credit: new Decimal(0),
      closing: new Decimal(0),
    };
    if (filter === null)
      return { kind: query.kind, from: query.from, to: query.to, rows: [], totals };
    const found = await this.reports.ledgerReport(this.books.user(ctx), {
      ...filter,
      byParty: query.kind === 'PARTY',
      withEmpty: query.withEmpty,
    });
    const known = await this.partiesOf(found.flatMap((row) => (row.partyId ? [row] : [])));
    const rows = found.map(({ partyId, partyName, ...row }): LedgerReportRow => {
      totals.opening = totals.opening.plus(row.opening);
      totals.debit = totals.debit.plus(row.debit);
      totals.credit = totals.credit.plus(row.credit);
      totals.closing = totals.closing.plus(row.closing);
      return {
        ...row,
        party: partyId === null ? null : (known.get(partyId) ?? other(partyId, partyName)),
      };
    });
    return { kind: query.kind, from: query.from, to: query.to, rows, totals };
  }

  /** The lines of one row: the account and the party (`none`: lines without one; unset: all). */
  async lines(
    ctx: AuthContext,
    query: LedgerReportQuery & { accountId: number; partyId?: string },
  ): Promise<LedgerLines> {
    const filter = await this.filterOf(query);
    if (filter === null)
      return { opening: new Decimal(0), rows: [], truncated: false, parties: new Map() };
    const found = await this.reports.ledgerLines(this.books.user(ctx), {
      ...filter,
      accountId: query.accountId,
      partyId: query.partyId === 'none' ? null : query.partyId,
    });
    const parties = await this.partiesOf(found.rows.flatMap((row) => (row.partyId ? [row] : [])));
    return { ...found, parties };
  }

  /** The report as an Excel sheet: one row per account × party, the totals last. */
  async workbook(ctx: AuthContext, query: LedgerReportQuery): Promise<Buffer> {
    const report = await this.report(ctx, query);
    const labels = mn.reports.ledger.columns;
    const title = mn.reports.ledger.titles[query.kind];
    const columns: ExcelColumn[] = [
      { name: labels.accountCode, kind: 'text' },
      { name: labels.accountName, kind: 'text' },
      ...(query.kind === 'PARTY'
        ? [
            { name: labels.partyCode, kind: 'text' } as const,
            { name: labels.partyName, kind: 'text' } as const,
          ]
        : []),
      { name: labels.openingDebit, kind: 'number' },
      { name: labels.openingCredit, kind: 'number' },
      { name: labels.debit, kind: 'number' },
      { name: labels.credit, kind: 'number' },
      { name: labels.closingDebit, kind: 'number' },
      { name: labels.closingCredit, kind: 'number' },
    ];
    const sides = (value: Decimal): [string, string] => [
      value.gt(0) ? value.toFixed(2) : '0.00',
      value.lt(0) ? value.negated().toFixed(2) : '0.00',
    ];
    const rows: ExcelRow[] = report.rows.map((row) => [
      row.code,
      row.name,
      ...(query.kind === 'PARTY' ? [row.party?.code ?? null, row.party?.name ?? null] : []),
      ...sides(row.opening),
      row.debit.toFixed(2),
      row.credit.toFixed(2),
      ...sides(row.closing),
    ]);
    rows.push([
      null,
      labels.total,
      ...(query.kind === 'PARTY' ? [null, null] : []),
      ...sides(report.totals.opening),
      report.totals.debit.toFixed(2),
      report.totals.credit.toFixed(2),
      ...sides(report.totals.closing),
    ]);
    return tableWorkbook(`${title} ${query.from} – ${query.to}`, { yes: '', no: '' }, (sheet) =>
      Promise.resolve(sheet.addRows(columns, rows)),
    );
  }

  /** The core's filter of a query; null when the chosen parties have no party in the core. */
  private async filterOf(query: LedgerReportQuery): Promise<FinLedgerFilter | null> {
    const picked = (query.accountIds?.length ?? 0) > 0 || (query.groupCodes?.length ?? 0) > 0;
    const customerIds = new Set(query.customerIds ?? []);
    if (query.customerCategoryId !== undefined) {
      const inGroup = await this.customers.idsInCategory(query.customerCategoryId);
      if (customerIds.size === 0) for (const id of inGroup) customerIds.add(id);
      else for (const id of [...customerIds]) if (!inGroup.includes(id)) customerIds.delete(id);
      if (customerIds.size === 0) return null;
    }
    const supplierIds = query.supplierIds ?? [];
    let partyIds: string[] | undefined;
    if (customerIds.size > 0 || supplierIds.length > 0) {
      const [ofCustomers, ofSuppliers] = await Promise.all([
        this.parties.partiesOfCustomers([...customerIds]),
        this.parties.partiesOfSuppliers(supplierIds),
      ]);
      partyIds = [...ofCustomers.values(), ...ofSuppliers.values()];
      if (partyIds.length === 0) return null;
    }
    return {
      company: await this.books.company(),
      from: query.from,
      to: query.to,
      accountIds: query.accountIds,
      groupCodes: query.groupCodes,
      controls: picked && query.kind === 'PARTY' ? undefined : KIND_CONTROLS[query.kind],
      partyIds,
      description: query.description,
      counterAccount: query.counterAccount,
    };
  }

  /** Bto's customers and suppliers behind the core's parties of these rows. */
  private async partiesOf(
    rows: readonly { partyId: string | null; partyName: string | null }[],
  ): Promise<Map<string, LedgerParty>> {
    const ids = [...new Set(rows.flatMap((row) => (row.partyId ? [row.partyId] : [])))];
    const names = new Map(rows.map((row) => [row.partyId, row.partyName]));
    const [customerOf, supplierOf] = await Promise.all([
      this.parties.customersOfParties(ids),
      this.parties.suppliersOfParties(ids),
    ]);
    const [customers, suppliers] = await Promise.all([
      this.customers.getMany([...new Set(customerOf.values())]),
      this.suppliers.getMany([...new Set(supplierOf.values())]),
    ]);
    const customerById = new Map(customers.map((row) => [row.id, row]));
    const supplierById = new Map(suppliers.map((row) => [row.id, row]));
    const out = new Map<string, LedgerParty>();
    for (const partyId of ids) {
      const customer = customerById.get(customerOf.get(partyId) ?? 0);
      const supplier = supplierById.get(supplierOf.get(partyId) ?? 0);
      if (customer) {
        out.set(partyId, {
          partyId,
          kind: 'CUSTOMER',
          refId: customer.id,
          code: customer.code,
          name: customer.name,
        });
      } else if (supplier) {
        out.set(partyId, {
          partyId,
          kind: 'SUPPLIER',
          refId: supplier.id,
          code: supplier.code,
          name: supplier.name,
        });
      } else {
        out.set(partyId, other(partyId, names.get(partyId) ?? null));
      }
    }
    return out;
  }
}

function other(partyId: string, name: string | null): LedgerParty {
  return { partyId, kind: 'OTHER', refId: null, code: null, name: name ?? '' };
}
