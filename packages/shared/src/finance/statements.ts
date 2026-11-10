import { Decimal } from '../money';

// The financial statements СТ-1 and СТ-2 (ADR-0184) as data: each form's rows in order, the
// account-code prefixes that land on a row by default, and the totals as sums of rows. An account
// goes to the row its accountant linked it to, else to the row with the longest matching prefix
// among the rows that take its kind, else to the kind's fallback row. Pure, so the api, the web and
// the tests read the same statement.

export const STATEMENT_KINDS = ['BALANCE', 'INCOME'] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export type StatementAccountKind = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface StatementRowSpec {
  /** Stable code: links and labels are keyed by it. */
  code: string;
  /** The row's number on the form. */
  no: string;
  type: 'HEADING' | 'LINE' | 'TOTAL';
  level: 0 | 1 | 2;
  /** LINE: the account kinds the row takes. */
  kinds?: readonly StatementAccountKind[];
  /** LINE: account-code prefixes that land here by default; the longest match wins. */
  prefixes?: readonly string[];
  /** LINE: where accounts of these kinds go when no prefix catches them. */
  fallbackFor?: readonly StatementAccountKind[];
  /** LINE: 1 when a debit balance counts positive on the row, −1 when a credit balance does. */
  sign?: 1 | -1;
  /** LINE of СТ-1: the result not yet closed into retained earnings is added here. */
  result?: boolean;
  /** TOTAL: the rows it sums, each with its factor. */
  sum?: readonly (readonly [code: string, factor: 1 | -1])[];
}

const ASSET: readonly StatementAccountKind[] = ['ASSET'];
const LIABILITY: readonly StatementAccountKind[] = ['LIABILITY'];
const EQUITY: readonly StatementAccountKind[] = ['EQUITY'];
const INCOME: readonly StatementAccountKind[] = ['INCOME'];
const EXPENSE: readonly StatementAccountKind[] = ['EXPENSE'];
const RESULT: readonly StatementAccountKind[] = ['INCOME', 'EXPENSE'];

const asset = (code: string, no: string, prefixes: readonly string[]): StatementRowSpec => ({
  code,
  no,
  type: 'LINE',
  level: 2,
  kinds: ASSET,
  prefixes,
  sign: 1,
});
const credit = (
  code: string,
  no: string,
  kinds: readonly StatementAccountKind[],
  prefixes: readonly string[],
): StatementRowSpec => ({ code, no, type: 'LINE', level: 2, kinds, prefixes, sign: -1 });
const total = (
  code: string,
  no: string,
  level: 0 | 1 | 2,
  sum: readonly (readonly [string, 1 | -1])[],
): StatementRowSpec => ({ code, no, type: 'TOTAL', level, sum });
const plus = (...codes: string[]): (readonly [string, 1])[] => codes.map((code) => [code, 1]);

/** СТ-1, the statement of financial position. */
export const BALANCE_ROWS: readonly StatementRowSpec[] = [
  { code: 'A', no: '1', type: 'HEADING', level: 0 },
  { code: 'A1', no: '1.1', type: 'HEADING', level: 1 },
  asset('A1_1', '1.1.1', ['10']),
  asset('A1_2', '1.1.2', ['120']),
  asset('A1_3', '1.1.3', ['121']),
  asset('A1_4', '1.1.4', ['12']),
  asset('A1_5', '1.1.5', ['13']),
  asset('A1_6', '1.1.6', ['14', '15']),
  asset('A1_7', '1.1.7', ['18']),
  { ...asset('A1_8', '1.1.8', ['19', '1']), fallbackFor: ASSET },
  total('A1_T', '1.1.20', 1, plus('A1_1', 'A1_2', 'A1_3', 'A1_4', 'A1_5', 'A1_6', 'A1_7', 'A1_8')),
  { code: 'A2', no: '1.2', type: 'HEADING', level: 1 },
  asset('A2_1', '1.2.1', ['20']),
  asset('A2_2', '1.2.2', ['21']),
  asset('A2_3', '1.2.3', ['22']),
  asset('A2_4', '1.2.9', ['23', '2']),
  total('A2_T', '1.2.20', 1, plus('A2_1', 'A2_2', 'A2_3', 'A2_4')),
  total('A_T', '1.3', 0, plus('A1_T', 'A2_T')),
  { code: 'L', no: '2', type: 'HEADING', level: 0 },
  { code: 'L1', no: '2.1.1', type: 'HEADING', level: 1 },
  credit('L1_1', '2.1.1.1', LIABILITY, ['310']),
  credit('L1_2', '2.1.1.2', LIABILITY, ['311']),
  credit('L1_3', '2.1.1.3', LIABILITY, ['312']),
  credit('L1_4', '2.1.1.4', LIABILITY, ['32']),
  { ...credit('L1_5', '2.1.1.5', LIABILITY, ['313', '31', '3']), fallbackFor: LIABILITY },
  total('L1_T', '2.1.1.20', 1, plus('L1_1', 'L1_2', 'L1_3', 'L1_4', 'L1_5')),
  { code: 'L2', no: '2.1.2', type: 'HEADING', level: 1 },
  credit('L2_1', '2.1.2.1', LIABILITY, ['33']),
  total('L2_T', '2.1.2.20', 1, plus('L2_1')),
  total('L_T', '2.2', 0, plus('L1_T', 'L2_T')),
  { code: 'E', no: '2.3', type: 'HEADING', level: 1 },
  credit('E_1', '2.3.1', EQUITY, ['41', '42']),
  { ...credit('E_2', '2.3.2', EQUITY, ['43', '4']), fallbackFor: EQUITY },
  { ...credit('E_3', '2.3.3', EQUITY, ['44', '34']), result: true },
  total('E_T', '2.3.20', 1, plus('E_1', 'E_2', 'E_3')),
  total('LE_T', '2.4', 0, plus('L_T', 'E_T')),
];

const gain = (code: string, no: string, prefixes: readonly string[] = []): StatementRowSpec => ({
  code,
  no,
  type: 'LINE',
  level: 1,
  kinds: RESULT,
  prefixes,
  sign: -1,
});
const income = (code: string, no: string, prefixes: readonly string[] = []): StatementRowSpec => ({
  code,
  no,
  type: 'LINE',
  level: 1,
  kinds: INCOME,
  prefixes,
  sign: -1,
});
const expense = (code: string, no: string, prefixes: readonly string[] = []): StatementRowSpec => ({
  code,
  no,
  type: 'LINE',
  level: 1,
  kinds: EXPENSE,
  prefixes,
  sign: 1,
});

/** СТ-2, the income statement (the other comprehensive income rows are not kept). */
export const INCOME_ROWS: readonly StatementRowSpec[] = [
  income('I1', '1', ['510', '520', '51']),
  expense('I2', '2', ['61', '6']),
  total('I3', '3', 0, [
    ['I1', 1],
    ['I2', -1],
  ]),
  income('I4', '4'),
  income('I5', '5'),
  income('I6', '6'),
  income('I7', '7'),
  { ...income('I8', '8', ['511', '5']), fallbackFor: INCOME },
  expense('I9', '9', ['71']),
  expense('I10', '10', ['70']),
  expense('I11', '11', ['72']),
  { ...expense('I12', '12', ['73', '7']), fallbackFor: EXPENSE },
  gain('I13', '13'),
  gain('I14', '14'),
  gain('I15', '15'),
  gain('I16', '16'),
  gain('I17', '17', ['84', '87', '8', '9']),
  total('I18', '18', 0, [
    ['I3', 1],
    ['I4', 1],
    ['I5', 1],
    ['I6', 1],
    ['I7', 1],
    ['I8', 1],
    ['I9', -1],
    ['I10', -1],
    ['I11', -1],
    ['I12', -1],
    ['I13', 1],
    ['I14', 1],
    ['I15', 1],
    ['I16', 1],
    ['I17', 1],
  ]),
  expense('I19', '19'),
  total('I20', '20', 0, [
    ['I18', 1],
    ['I19', -1],
  ]),
  gain('I21', '21'),
  total('I22', '22', 0, [
    ['I20', 1],
    ['I21', 1],
  ]),
];

export const STATEMENT_ROWS: Record<StatementKind, readonly StatementRowSpec[]> = {
  BALANCE: BALANCE_ROWS,
  INCOME: INCOME_ROWS,
};

/** The statement an account of a kind belongs to. */
export function statementOfKind(kind: StatementAccountKind): StatementKind {
  return kind === 'INCOME' || kind === 'EXPENSE' ? 'INCOME' : 'BALANCE';
}

/** The rows of a statement an account of this kind may be linked to. */
export function linkableRows(kind: StatementAccountKind): StatementRowSpec[] {
  return STATEMENT_ROWS[statementOfKind(kind)].filter(
    (row) => row.type === 'LINE' && (row.kinds ?? []).includes(kind),
  );
}

/** The row an account lands on without a link: the longest prefix, else the kind's fallback. */
export function defaultRowOf(account: { code: string; kind: StatementAccountKind }): string | null {
  const rows = linkableRows(account.kind);
  let best: { code: string; length: number } | null = null;
  for (const row of rows) {
    for (const prefix of row.prefixes ?? []) {
      if (account.code.startsWith(prefix) && (best === null || prefix.length > best.length)) {
        best = { code: row.code, length: prefix.length };
      }
    }
  }
  if (best) return best.code;
  return rows.find((row) => row.fallbackFor?.includes(account.kind))?.code ?? null;
}

export interface StatementAccount {
  accountId: number;
  code: string;
  name: string;
  kind: StatementAccountKind;
  /** Debit − credit: before the period and at its end (СТ-1), or null and the period (СТ-2). */
  opening: Decimal | null;
  amount: Decimal;
}

export interface StatementRowAccount {
  accountId: number;
  code: string;
  name: string;
  kind: StatementAccountKind;
  opening: Decimal | null;
  amount: Decimal;
  /** Put here by the accountant, not by the default. */
  linked: boolean;
}

export interface StatementRow {
  code: string;
  no: string;
  type: StatementRowSpec['type'];
  level: 0 | 1 | 2;
  /** Null on a heading, and on every row of СТ-2. */
  opening: Decimal | null;
  /** Null on a heading. */
  amount: Decimal | null;
  accounts: StatementRowAccount[];
  /** СТ-1's retained earnings: the result not yet closed, already inside the row's amounts. */
  result: { opening: Decimal; amount: Decimal } | null;
}

const ZERO = new Decimal(0);

/**
 * A statement from its accounts' balances. `links` maps an account to the row its accountant
 * chose; a link to a row of another statement or of another kind is ignored. In СТ-1 the balances
 * of the income and expense accounts — the result not yet closed — are added to the `result` row,
 * so the two sides balance whenever the journal does.
 */
export function buildStatement(
  kind: StatementKind,
  accounts: readonly StatementAccount[],
  links: ReadonlyMap<number, string> = new Map(),
): StatementRow[] {
  const specs = STATEMENT_ROWS[kind];
  const byCode = new Map(specs.map((spec) => [spec.code, spec]));
  const placed = new Map<string, StatementRowAccount[]>();
  let unclosedOpening = ZERO;
  let unclosedAmount = ZERO;
  for (const account of accounts) {
    if (statementOfKind(account.kind) !== kind) {
      if (kind === 'BALANCE') {
        // Income is a credit balance: the result is its negation.
        unclosedOpening = unclosedOpening.minus(account.opening ?? ZERO);
        unclosedAmount = unclosedAmount.minus(account.amount);
      }
      continue;
    }
    const wanted = links.get(account.accountId);
    const wantedSpec = wanted === undefined ? undefined : byCode.get(wanted);
    const linked =
      wantedSpec !== undefined &&
      wantedSpec.type === 'LINE' &&
      (wantedSpec.kinds ?? []).includes(account.kind);
    const rowCode = linked ? wantedSpec.code : defaultRowOf(account);
    if (rowCode === null) continue;
    const sign = byCode.get(rowCode)?.sign ?? 1;
    const list = placed.get(rowCode) ?? [];
    list.push({
      accountId: account.accountId,
      code: account.code,
      name: account.name,
      kind: account.kind,
      opening: account.opening === null ? null : account.opening.times(sign),
      amount: account.amount.times(sign),
      linked,
    });
    placed.set(rowCode, list);
  }
  const rows = new Map<string, StatementRow>();
  for (const spec of specs) {
    const rowAccounts = placed.get(spec.code) ?? [];
    let opening: Decimal | null = null;
    let amount: Decimal | null = null;
    let result: StatementRow['result'] = null;
    if (spec.type === 'LINE') {
      amount = rowAccounts.reduce((sum, account) => sum.plus(account.amount), ZERO);
      opening =
        kind === 'BALANCE'
          ? rowAccounts.reduce((sum, account) => sum.plus(account.opening ?? ZERO), ZERO)
          : null;
      if (spec.result && kind === 'BALANCE') {
        result = { opening: unclosedOpening, amount: unclosedAmount };
        amount = amount.plus(unclosedAmount);
        opening = (opening ?? ZERO).plus(unclosedOpening);
      }
    } else if (spec.type === 'TOTAL') {
      amount = ZERO;
      opening = kind === 'BALANCE' ? ZERO : null;
      for (const [code, factor] of spec.sum ?? []) {
        const part = rows.get(code);
        if (!part) throw new Error(`statement row ${spec.code} sums ${code} before it is built`);
        amount = amount.plus((part.amount ?? ZERO).times(factor));
        if (opening !== null) opening = opening.plus((part.opening ?? ZERO).times(factor));
      }
    }
    rows.set(spec.code, {
      code: spec.code,
      no: spec.no,
      type: spec.type,
      level: spec.level,
      opening,
      amount,
      accounts: rowAccounts.sort((a, b) => a.code.localeCompare(b.code)),
      result,
    });
  }
  return specs.flatMap((spec) => rows.get(spec.code) ?? []);
}

/** СТ-1 balances when total assets equal liabilities plus equity, at both dates. */
export function balanceDifference(rows: readonly StatementRow[]): {
  opening: Decimal;
  amount: Decimal;
} {
  const assets = rows.find((row) => row.code === 'A_T');
  const other = rows.find((row) => row.code === 'LE_T');
  return {
    opening: (assets?.opening ?? ZERO).minus(other?.opening ?? ZERO),
    amount: (assets?.amount ?? ZERO).minus(other?.amount ?? ZERO),
  };
}
