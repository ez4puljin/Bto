import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { ReportContext } from './report-context';
import { checkedRange, type DateRange } from './report-periods';
import { allOf, dateText, dec, int, intOrNull, money, rowsOf, searchSql, textOrNull } from './report-sql';

export const AP_ENTRY_KINDS = ['PURCHASE', 'OPENING', 'PAYMENT', 'OTHER_BILL'] as const;
export type ApEntryKind = (typeof AP_ENTRY_KINDS)[number];

export interface SupplierRow {
  partyId: number;
  supplierId: number | null;
  code: string | null;
  name: string;
  /** Goods received with VAT, at the delivery note's amount, net of returns (ADR-0108 #10). */
  purchases: string;
  purchasesExVat: string;
  /** Service bills and other manual entries that raised the payable. */
  otherBills: string;
  payments: string;
  /** What is owed at the period's end (+ we owe, − paid in advance). */
  balance: string;
}

export interface SupplierReport extends DateRange {
  rows: SupplierRow[];
  totals: Omit<SupplierRow, 'partyId' | 'supplierId' | 'code' | 'name'>;
}

export interface SupplierEntry {
  entryId: number;
  date: string;
  kind: ApEntryKind;
  number: string | null;
  /** The goods receipt behind a purchase (its page), when the entry has one. */
  receiptId: number | null;
  amount: string;
  vatAmount: string;
  reversal: boolean;
}

/**
 * The supplier report (ADR-0108 #5, #10), live from the payables' journal: purchases with and
 * without VAT, other bills, payments and the balance per supplier, the largest first.
 */
@Injectable()
export class SupplierReportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async suppliers(ctx: AuthContext, query: { from: string; to: string; q?: string }): Promise<SupplierReport> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(query.from, query.to);
    const inRange = sql`e.entry_date BETWEEN ${range.from}::date AND ${range.to}::date`;
    const rows = await rowsOf(
      this.db,
      sql`SELECT e.party_id, e.supplier_id, s.code, coalesce(s.name, e.party_name) AS name,
                 coalesce(sum(e.amount) FILTER (WHERE e.kind = 'PURCHASE' AND ${inRange}), 0) AS purchases,
                 coalesce(sum(e.amount - e.vat_amount) FILTER (WHERE e.kind = 'PURCHASE' AND ${inRange}), 0)
                   AS purchases_ex_vat,
                 coalesce(sum(e.amount) FILTER (WHERE e.kind = 'OTHER_BILL' AND ${inRange}), 0) AS other_bills,
                 coalesce(sum(-e.amount) FILTER (WHERE e.kind = 'PAYMENT' AND ${inRange}), 0) AS payments,
                 coalesce(sum(e.amount) FILTER (WHERE e.entry_date <= ${range.to}::date), 0) AS balance
            FROM reporting.ap_entries e
            LEFT JOIN public.suppliers s ON s.id = e.supplier_id
           WHERE e.company_code = ${scope.company}
             AND ${allOf([query.q ? (searchSql('s', query.q) ?? sql`TRUE`) : null])}
           GROUP BY e.party_id, e.supplier_id, s.code, s.name, e.party_name`,
    );
    const zero = () => new Decimal(0);
    const totals = { purchases: zero(), purchasesExVat: zero(), otherBills: zero(), payments: zero(), balance: zero() };
    const out = rows
      .map((row) => {
        const values = {
          purchases: dec(row.purchases),
          purchasesExVat: dec(row.purchases_ex_vat),
          otherBills: dec(row.other_bills),
          payments: dec(row.payments),
          balance: dec(row.balance),
        };
        return { row, values };
      })
      .filter(({ values }) => Object.values(values).some((v) => !v.isZero()))
      .sort(
        (a, b) =>
          b.values.purchases.cmp(a.values.purchases) ||
          b.values.balance.cmp(a.values.balance) ||
          int(a.row.party_id) - int(b.row.party_id),
      )
      .map(({ row, values }) => {
        for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
          totals[key] = totals[key].plus(values[key]);
        }
        return {
          partyId: int(row.party_id),
          supplierId: intOrNull(row.supplier_id),
          code: textOrNull(row.code),
          name: String(row.name),
          purchases: money(values.purchases),
          purchasesExVat: money(values.purchasesExVat),
          otherBills: money(values.otherBills),
          payments: money(values.payments),
          balance: money(values.balance),
        };
      });
    return {
      ...range,
      rows: out,
      totals: {
        purchases: money(totals.purchases),
        purchasesExVat: money(totals.purchasesExVat),
        otherBills: money(totals.otherBills),
        payments: money(totals.payments),
        balance: money(totals.balance),
      },
    };
  }

  /** One supplier's entries in the period, oldest first, with the goods receipt behind each purchase. */
  async entries(ctx: AuthContext, partyId: number, query: { from: string; to: string }): Promise<SupplierEntry[]> {
    const scope = await this.context.scope(ctx);
    const range = checkedRange(query.from, query.to);
    const rows = await rowsOf(
      this.db,
      sql`SELECT e.entry_id, e.entry_date, e.kind, coalesce(e.document_number, e.entry_number) AS number,
                 e.source_doc_type, e.source_doc_id, e.amount, e.vat_amount, e.is_reversal
            FROM reporting.ap_entries e
           WHERE e.company_code = ${scope.company} AND e.party_id = ${partyId}
             AND e.entry_date BETWEEN ${range.from}::date AND ${range.to}::date
           ORDER BY e.entry_date, e.entry_id`,
    );
    return rows.map((row) => {
      const source = textOrNull(row.source_doc_id);
      const receipt = /^(\d+)(:\d+)?$/.exec(source ?? '');
      return {
        entryId: int(row.entry_id),
        date: dateText(row.entry_date) ?? '',
        kind: row.kind as ApEntryKind,
        number: textOrNull(row.number),
        receiptId:
          receipt && (row.source_doc_type === 'GOODS_RECEIPT' || row.source_doc_type === 'RECEIPT_RECOST')
            ? Number.parseInt(receipt[1] ?? '', 10)
            : null,
        amount: money(dec(row.amount)),
        vatAmount: money(dec(row.vat_amount)),
        reversal: row.is_reversal === true,
      };
    });
  }
}
