import { defaultRowOf, linkableRows, type StatementAccountKind } from '../finance/statements';

/**
 * What «Ашгийн самбар» takes from the books (ADR-0238): each INCOME and EXPENSE account lands where
 * the income statement СТ-2 places it (the accountant's link first, the code prefixes otherwise,
 * `packages/shared/src/finance/statements.ts`), so the board and the statement read one mapping:
 *
 * - `EXPENSE` «Урсгал зардал»: an EXPENSE account on the selling, general, finance or other expense
 *   rows (I9 … I12: class 7, Bto's stock-issue and stock-loss accounts among them);
 * - `OTHER_INCOME` «Бусад орлого»: an INCOME account off the sales row I1;
 * - `TAX` «Татвар»: 910101 «Орлогын татварын зардал», or an EXPENSE account linked to row I19;
 * - null, never from the books: the sales row I1 (510101, 520101, 520201, and 520202, which the board
 *   takes from the receipts, ADR-0236) and the cost row I2 (610101, 610301) — the board's sales and
 *   cost are the sales lines' (ADR-0237) — and the EXPENSE accounts on the gain and loss rows
 *   (I13 … I17), among them 910201 «Тайлант үеийн ашиг (алдагдал)».
 */
export type BoardLedgerPart = 'EXPENSE' | 'OTHER_INCOME' | 'TAX';

/** The income tax expense account of the chart. */
export const BOARD_TAX_ACCOUNT = '910101';

const SALES_ROW = 'I1';
const COST_ROW = 'I2';
const TAX_ROW = 'I19';
const EXPENSE_ROWS: readonly string[] = ['I9', 'I10', 'I11', 'I12'];

/** The СТ-2 row an account lands on: its valid link, else its default. */
export function statementRowOf(
  account: { code: string; kind: StatementAccountKind },
  link: string | null = null,
): string | null {
  if (link !== null && linkableRows(account.kind).some((row) => row.code === link)) return link;
  return defaultRowOf(account);
}

/** Where an account's lines count on the board, or null when they never do. */
export function boardLedgerPart(
  account: { code: string; kind: StatementAccountKind },
  link: string | null = null,
): BoardLedgerPart | null {
  if (account.kind !== 'INCOME' && account.kind !== 'EXPENSE') return null;
  const row = statementRowOf(account, link);
  if (account.kind === 'INCOME') return row === SALES_ROW || row === null ? null : 'OTHER_INCOME';
  if (row === TAX_ROW || (account.code === BOARD_TAX_ACCOUNT && link === null)) return 'TAX';
  if (row === COST_ROW || row === null) return null;
  return EXPENSE_ROWS.includes(row) ? 'EXPENSE' : null;
}
