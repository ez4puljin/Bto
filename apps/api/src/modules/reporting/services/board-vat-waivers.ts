import type { Decimal } from '@tugeel/shared/money';
import { BUSINESS_TZ } from '@tugeel/shared/time';
import { type SQL, sql } from 'drizzle-orm';
import type { Db } from '../../../common/db/db.types';
import { type BoardPeriodKey, VAT_WAIVER_DOC_TYPE } from './board-ledger.service';
import type { BoardPeriods, DateRange } from './report-periods';
import { dec, int, money, pct, rowsOf, scalar } from './report-sql';

/**
 * «НӨАТ хасуулах» on «Ашгийн самбар» (ADR-0241, over ADR-0240 and ADR-0238).
 *
 * A waiver is a discount given after the invoice: it never touches `invoice_lines`, so the board's
 * net sales do not see it, and its debit lands on the customer's counter account — 520201 by
 * default (the sales row, never read from the books) or an account the owner set on the customer
 * (a class-7 expense account would land in the expense tree). So the board takes the waivers by
 * their DOCUMENT, once, as a step of their own that lowers the operating profit, and the expense
 * tree, the other income and the tax leave those documents out (`board-ledger.service.ts`).
 *
 * Where the discount comes from:
 * - the counter account is INCOME or EXPENSE: the waiver's line in `reporting.ledger_lines`
 *   (`source_doc_type` VAT_WAIVER, the receivable line is an ASSET line the view never carries);
 *   positive on an EXPENSE account, negated on an INCOME one; a reversal carries the same source
 *   (the core's REVERSE copies it), so it nets out by its own entry date, as the books have it;
 * - the counter account is of another kind (ADR-0240 #7 allows a plain account of any kind): the
 *   view drops that line, so the waiver's own row stands in — `amount` on `waiver_date` (the
 *   entry's date) and, once reversed, `−amount` on the Ulaanbaatar date of `reversed_at` (the
 *   reversal is posted that business day).
 * The two parts split by the account's present kind, so no waiver counts in both.
 *
 * The card's count, total, VAT and discount are the POSTED waivers dated in the period; its share is
 * one population — the period's invoices by invoice date, waived now ÷ all of them.
 */

/** Every waiver discount event as (day, branch_id, discount), as a derived table `w`. */
function waiverEvents(company: string): SQL {
  return sql`(
    SELECT l.entry_date AS day, l.branch_id,
           CASE WHEN l.account_kind = 'EXPENSE' THEN l.amount ELSE -l.amount END AS discount
      FROM reporting.ledger_lines l
     WHERE l.company_code = ${company} AND l.source_doc_type = ${VAT_WAIVER_DOC_TYPE}
    UNION ALL
    SELECT x.day, i.branch_id, x.discount
      FROM public.vat_waivers v
      JOIN public.invoices i ON i.id = v.invoice_id
     CROSS JOIN LATERAL (VALUES (v.waiver_date, v.amount),
                                ((v.reversed_at AT TIME ZONE ${BUSINESS_TZ})::date, -v.amount))
           AS x(day, discount)
     WHERE x.day IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM reporting.ledger_accounts a
                        WHERE a.company_code = ${company} AND a.account_id = v.account_id
                          AND a.kind IN ('INCOME', 'EXPENSE'))
  ) w`;
}

const within = (range: DateRange) => sql`w.day BETWEEN ${range.from}::date AND ${range.to}::date`;

/** With a branch chosen only that branch's waivers count, as the other figures of the books. */
const ofBranch = (branchId: number | null) =>
  branchId === null ? sql`TRUE` : sql`w.branch_id = ${branchId}`;

/** The waiver discounts of the three periods. */
export async function waiverDiscounts(
  db: Db,
  company: string,
  periods: BoardPeriods,
  branchId: number | null,
): Promise<Record<BoardPeriodKey, Decimal>> {
  const { current: c, previous: p, lastYear: y } = periods;
  const [row] = await rowsOf(
    db,
    sql`SELECT sum(w.discount) FILTER (WHERE ${within(c)}) AS c_amount,
               sum(w.discount) FILTER (WHERE ${within(p)}) AS p_amount,
               sum(w.discount) FILTER (WHERE ${within(y)}) AS y_amount
          FROM ${waiverEvents(company)}
         WHERE ${ofBranch(branchId)}`,
  );
  return {
    current: dec(row?.c_amount),
    previous: dec(row?.p_amount),
    lastYear: dec(row?.y_amount),
  };
}

/** The waiver discounts by trend period (`to_char` label as the key). */
export async function waiverTrend(
  db: Db,
  company: string,
  range: DateRange,
  label: string,
  branchId: number | null,
): Promise<Map<string, Decimal>> {
  const rows = await rowsOf(
    db,
    sql`SELECT to_char(w.day, ${label}) AS period, sum(w.discount) AS amount
          FROM ${waiverEvents(company)}
         WHERE ${within(range)} AND ${ofBranch(branchId)}
         GROUP BY 1`,
  );
  return new Map(rows.map((row) => [scalar(row.period), dec(row.amount)]));
}

/** «НӨАТ аваагүй борлуулалт»: information only, never added to or taken from a profit figure. */
export interface BoardVatWaived {
  /** Sales whose live (POSTED, not reversed) waiver is dated in the period. */
  count: number;
  /** Their invoices' total, VAT included. */
  total: string;
  /** The VAT inside them (`invoices.vat_total`). */
  vat: string;
  /** The discount their waivers gave. */
  discount: string;
  /** The period's wholesale invoices' total (not VOID, by invoice date). */
  wholesaleTotal: string;
  /**
   * Of those same invoices (by invoice date), the total of the ones waived now (a POSTED waiver,
   * whatever its date).
   */
  wholesaleWaived: string;
  /**
   * «Тухайн үеийн борлуулалтаас НӨАТ аваагүй нь»: `wholesaleWaived` in percent of `wholesaleTotal`
   * — one population, so never above 100; null when the period has no invoice total.
   */
  share: string | null;
}

/** The information card, read live from the waivers and the invoices. */
export async function vatWaived(
  db: Db,
  range: DateRange,
  branchId: number | null,
): Promise<BoardVatWaived> {
  const branch = branchId === null ? sql`TRUE` : sql`i.branch_id = ${branchId}`;
  const [[waived], [all]] = await Promise.all([
    rowsOf(
      db,
      sql`SELECT count(*) AS n, sum(i.total) AS total, sum(i.vat_total) AS vat,
                 sum(v.amount) AS discount
            FROM public.vat_waivers v
            JOIN public.invoices i ON i.id = v.invoice_id
           WHERE v.status = 'POSTED'
             AND v.waiver_date BETWEEN ${range.from}::date AND ${range.to}::date AND ${branch}`,
    ),
    rowsOf(
      db,
      sql`SELECT sum(i.total) AS total,
                 sum(i.total) FILTER (WHERE EXISTS (
                   SELECT 1 FROM public.vat_waivers v
                    WHERE v.invoice_id = i.id AND v.status = 'POSTED')) AS waived
            FROM public.invoices i
           WHERE i.status <> 'VOID'
             AND i.invoice_date BETWEEN ${range.from}::date AND ${range.to}::date AND ${branch}`,
    ),
  ]);
  const total = dec(waived?.total);
  const whole = dec(all?.total);
  const ofPeriod = dec(all?.waived);
  return {
    count: int(waived?.n ?? 0),
    total: money(total),
    vat: money(dec(waived?.vat)),
    discount: money(dec(waived?.discount)),
    wholesaleTotal: money(whole),
    wholesaleWaived: money(ofPeriod),
    share: whole.gt(0) ? pct(ofPeriod.div(whole).times(100).toDecimalPlaces(1)) : null,
  };
}
