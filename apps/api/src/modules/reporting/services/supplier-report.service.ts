import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../../identity';
import { type ReceiptDiscountEntry, receiptDiscountEntries } from './receipt-discount-entries';
import { ReportContext } from './report-context';
import { checkedRange, type DateRange } from './report-periods';
import {
  allOf,
  dateText,
  dec,
  int,
  intOrNull,
  money,
  rowsOf,
  searchSql,
  textOrNull,
  scalar,
} from './report-sql';

export const AP_ENTRY_KINDS = ['PURCHASE', 'OPENING', 'PAYMENT', 'OTHER_BILL'] as const;
export type ApEntryKind = (typeof AP_ENTRY_KINDS)[number];

export interface SupplierRow {
  partyId: number;
  supplierId: number | null;
  code: string | null;
  name: string;
  /**
   * Goods received with VAT, at the delivery note's amount, net of returns (ADR-0108 #10): after
   * the receipts' discounts, or before them with `splitDiscounts` (ADR-0234).
   */
  purchases: string;
  purchasesExVat: string;
  /** Service bills and other manual entries that raised the payable. */
  otherBills: string;
  /** The receipts' discounts of the period (ADR-0234), with `splitDiscounts` only; else null. */
  discounts: string | null;
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
  /** The payable's movement; with `splitDiscounts` a receipt's before its discount (ADR-0234). */
  amount: string;
  vatAmount: string;
  /** The receipt's discount the entry carries, with `splitDiscounts` only (0 for other entries). */
  discount: string | null;
  reversal: boolean;
}

export interface SupplierReportQuery {
  from: string;
  to: string;
  q?: string;
  /** «Хөнгөлөлтийг задалж харуулах» (ADR-0234): receipts before their discounts, the discounts apart. */
  splitDiscounts?: boolean;
}

/**
 * The supplier report (ADR-0108 #5, #10), live from the payables' journal: purchases with and
 * without VAT, other bills, payments and the balance per supplier, the largest first. With
 * `splitDiscounts` (ADR-0234) a receipt's purchase stands before its discount and the discount
 * apart; the balance is the books' either way.
 */
@Injectable()
export class SupplierReportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly context: ReportContext,
  ) {}

  async suppliers(ctx: AuthContext, query: SupplierReportQuery): Promise<SupplierReport> {
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
    const discounts = query.splitDiscounts
      ? await this.periodDiscounts(scope.company, range, null)
      : null;
    const byParty = new Map<number, Decimal>();
    for (const item of discounts ?? []) {
      if (!item.inRange) continue;
      byParty.set(item.partyId, (byParty.get(item.partyId) ?? zero()).plus(item.discount));
    }
    const totals = {
      purchases: zero(),
      purchasesExVat: zero(),
      otherBills: zero(),
      discounts: zero(),
      payments: zero(),
      balance: zero(),
    };
    const out = rows
      .map((row) => {
        const discount = byParty.get(int(row.party_id)) ?? zero();
        const values = {
          purchases: dec(row.purchases).plus(discount),
          purchasesExVat: dec(row.purchases_ex_vat),
          otherBills: dec(row.other_bills),
          discounts: discount,
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
          name: scalar(row.name),
          purchases: money(values.purchases),
          purchasesExVat: money(values.purchasesExVat),
          otherBills: money(values.otherBills),
          discounts: discounts ? money(values.discounts) : null,
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
        discounts: discounts ? money(totals.discounts) : null,
        payments: money(totals.payments),
        balance: money(totals.balance),
      },
    };
  }

  /** One supplier's entries in the period, oldest first, with the goods receipt behind each purchase. */
  async entries(
    ctx: AuthContext,
    partyId: number,
    query: { from: string; to: string; splitDiscounts?: boolean },
  ): Promise<SupplierEntry[]> {
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
    const discounts = query.splitDiscounts
      ? new Map(
          (await this.periodDiscounts(scope.company, range, partyId)).map((item) => [
            item.entryId,
            item.discount,
          ]),
        )
      : null;
    return rows.map((row) => {
      const source = textOrNull(row.source_doc_id);
      const receipt = /^(\d+)(:\d+)?$/.exec(source ?? '');
      const discount = discounts ? (discounts.get(int(row.entry_id)) ?? zero()) : null;
      return {
        entryId: int(row.entry_id),
        date: dateText(row.entry_date) ?? '',
        kind: row.kind as ApEntryKind,
        number: textOrNull(row.number),
        receiptId:
          receipt &&
          (row.source_doc_type === 'GOODS_RECEIPT' || row.source_doc_type === 'RECEIPT_RECOST')
            ? Number.parseInt(receipt[1] ?? '', 10)
            : null,
        amount: money(dec(row.amount).plus(discount ?? 0)),
        vatAmount: money(dec(row.vat_amount)),
        discount: discount ? money(discount) : null,
        reversal: row.is_reversal === true,
      };
    });
  }

  /**
   * The receipt discount (the delivery note's, VAT included) of every payable entry of the
   * receipts booked in the period (ADR-0234), of one party or all (`receiptDiscountEntries`).
   */
  private periodDiscounts(
    company: string,
    range: DateRange,
    partyId: number | null,
  ): Promise<ReceiptDiscountEntry[]> {
    return receiptDiscountEntries(this.db, company, range, { partyId, measure: 'note' });
  }
}

function zero(): Decimal {
  return new Decimal(0);
}
