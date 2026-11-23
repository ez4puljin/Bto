import { Inject, Injectable } from '@nestjs/common';
import type { StatementAccountKind } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { type BoardLedgerPart, boardLedgerPart } from '@tugeel/shared/reports';
import { type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import type { BoardPeriods, DateRange } from './report-periods';
import {
  dateText,
  dec,
  int,
  intOrNull,
  money,
  pct,
  rowsOf,
  scalar,
  textOrNull,
} from './report-sql';

/**
 * «Ашгийн самбар»'s operating expenses, other income and tax from the books (ADR-0238), read live
 * through `reporting.ledger_lines` (the journal's INCOME and EXPENSE lines without the year close),
 * `reporting.ledger_accounts` and `reporting.ledger_groups`. Each account counts where
 * `boardLedgerPart` places it (the income statement's rows, the accountant's links first); the
 * board's sales, cost and supplier discounts never come from here.
 */

/** The three periods of the board. */
export type BoardPeriodKey = 'current' | 'previous' | 'lastYear';
const PERIOD_KEYS: readonly BoardPeriodKey[] = ['current', 'previous', 'lastYear'];

export interface LedgerSums {
  otherIncome: Decimal;
  expenses: Decimal;
  tax: Decimal;
}

/** What a row of the expense tree stands for: a group of the chart, an account, or no group. */
export const BOARD_EXPENSE_ROW_KINDS = ['GROUP', 'ACCOUNT', 'NONE'] as const;
export type BoardExpenseRowKind = (typeof BOARD_EXPENSE_ROW_KINDS)[number];
/** What the entries behind the expenses can be asked for: a row, or the branch-less ones. */
export const BOARD_EXPENSE_ENTRY_KINDS = [...BOARD_EXPENSE_ROW_KINDS, 'COMMON'] as const;
export type BoardExpenseEntryKind = (typeof BOARD_EXPENSE_ENTRY_KINDS)[number];

export interface BoardExpenseRow {
  kind: BoardExpenseRowKind;
  /** The group's or the account's id; null for «Бүлэггүй данс». */
  id: number | null;
  code: string | null;
  name: string | null;
  amount: string;
  previous: string;
  lastYear: string;
  /** The row's part of the period's operating expenses in percent; null when they are not above zero. */
  share: string | null;
  children: BoardExpenseRow[];
}

export interface BoardExpenses {
  /** The top-level rows, the largest first. */
  rows: BoardExpenseRow[];
  total: Record<BoardPeriodKey, string>;
  /** With a branch chosen: the operating expenses without a branch («Нийтлэг зардал»); else null. */
  common: Record<BoardPeriodKey, string> | null;
  /** Expense lines in the current period (0: nothing recorded yet). */
  lines: number;
}

export interface BoardExpenseEntriesQuery {
  rowKind: BoardExpenseEntryKind;
  id?: number;
}

export interface BoardExpenseEntry {
  lineId: number;
  entryId: number;
  date: string;
  /** The document's number, else the journal entry's. */
  number: string;
  source: string | null;
  description: string | null;
  accountId: number;
  accountCode: string;
  accountName: string;
  partyName: string | null;
  branchId: number | null;
  branchName: string | null;
  amount: string;
}

export interface BoardExpenseEntries extends DateRange {
  rows: BoardExpenseEntry[];
  /** More lines stand behind the row than are listed. */
  more: boolean;
  /** The row's amount in the period. */
  total: string;
}

/** Lines listed behind a row, newest first. */
export const BOARD_MAX_EXPENSE_ENTRIES = 500;

const ZERO = new Decimal(0);

interface ChartAccount {
  id: number;
  code: string;
  name: string;
  groupId: number | null;
  part: BoardLedgerPart | null;
}

interface ChartGroup {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  sort: number;
}

export interface Chart {
  accounts: Map<number, ChartAccount>;
  groups: Map<number, ChartGroup>;
  children: Map<number | null, number[]>;
  /** Accounts right in each group. */
  direct: Map<number, number[]>;
  /** Groups whose every account (in the subtree) is an operating expense. */
  pure: Set<number>;
}

/** One account's amounts; `common` for the lines without a branch when a branch is chosen. */
export interface LedgerAmount {
  account: number;
  common: boolean;
  sums: Record<BoardPeriodKey, Decimal>;
  /** Lines in the current period. */
  lines: number;
}

/** The accounts whose lines count on the board. */
const countedIds = (chart: Chart) =>
  [...chart.accounts.values()].filter((a) => a.part !== null).map((a) => a.id);

const between = (range: DateRange) =>
  sql`l.entry_date BETWEEN ${range.from}::date AND ${range.to}::date`;

const idArray = (ids: readonly number[]) => sql`${`{${ids.join(',')}}`}::bigint[]`;

@Injectable()
export class BoardLedgerService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The chart with each account's part, its group tree and which groups hold only expenses. */
  async chart(company: string): Promise<Chart> {
    const [accountRows, groupRows, links] = await Promise.all([
      rowsOf(
        this.db,
        sql`SELECT a.account_id, a.code, a.name, a.kind, a.group_id
              FROM reporting.ledger_accounts a WHERE a.company_code = ${company}`,
      ),
      rowsOf(
        this.db,
        sql`SELECT g.group_id, g.code, g.name, g.parent_id, g.sort
              FROM reporting.ledger_groups g WHERE g.company_code = ${company}`,
      ),
      rowsOf(this.db, sql`SELECT k.account_id, k.row_code FROM public.statement_row_links k`),
    ]);
    const linkOf = new Map(links.map((row) => [int(row.account_id), scalar(row.row_code)]));
    const accounts = new Map<number, ChartAccount>();
    const direct = new Map<number, number[]>();
    for (const row of accountRows) {
      const id = int(row.account_id);
      const code = scalar(row.code);
      const groupId = intOrNull(row.group_id);
      accounts.set(id, {
        id,
        code,
        name: scalar(row.name),
        groupId,
        part: boardLedgerPart(
          { code, kind: scalar(row.kind) as StatementAccountKind },
          linkOf.get(id) ?? null,
        ),
      });
      if (groupId !== null) direct.set(groupId, [...(direct.get(groupId) ?? []), id]);
    }
    const groups = new Map<number, ChartGroup>();
    const children = new Map<number | null, number[]>();
    for (const row of groupRows) {
      const group: ChartGroup = {
        id: int(row.group_id),
        code: scalar(row.code),
        name: scalar(row.name),
        parentId: intOrNull(row.parent_id),
        sort: int(row.sort),
      };
      groups.set(group.id, group);
      children.set(group.parentId, [...(children.get(group.parentId) ?? []), group.id]);
    }
    const pure = new Set<number>();
    const seen = new Set<number>();
    const isPure = (id: number): boolean => {
      if (seen.has(id)) return pure.has(id);
      seen.add(id);
      const own = (direct.get(id) ?? []).every(
        (account) => accounts.get(account)?.part === 'EXPENSE',
      );
      const below = (children.get(id) ?? []).map(isPure).every(Boolean);
      if (own && below) pure.add(id);
      return own && below;
    };
    for (const id of groups.keys()) isPure(id);
    return { accounts, groups, children, direct, pure };
  }

  /**
   * Each account's amount in the three periods: of the chosen branch only, and apart from it the
   * lines without a branch («Нийтлэг»); without a branch every line. Only the accounts that count.
   */
  async amounts(
    company: string,
    chart: Chart,
    periods: BoardPeriods,
    branchId: number | null,
  ): Promise<LedgerAmount[]> {
    const ids = countedIds(chart);
    if (ids.length === 0) return [];
    const { current: c, previous: p, lastYear: y } = periods;
    const branch: SQL =
      branchId === null ? sql`TRUE` : sql`(l.branch_id = ${branchId} OR l.branch_id IS NULL)`;
    const common = branchId === null ? sql`FALSE` : sql`l.branch_id IS NULL`;
    const rows = await rowsOf(
      this.db,
      sql`SELECT l.account_id, ${common} AS common,
                 sum(l.amount) FILTER (WHERE ${between(c)}) AS c_amount,
                 sum(l.amount) FILTER (WHERE ${between(p)}) AS p_amount,
                 sum(l.amount) FILTER (WHERE ${between(y)}) AS y_amount,
                 count(*) FILTER (WHERE ${between(c)}) AS c_lines
            FROM reporting.ledger_lines l
           WHERE l.company_code = ${company} AND l.account_id = ANY(${idArray(ids)})
             AND (${between(c)} OR ${between(p)} OR ${between(y)}) AND ${branch}
           GROUP BY 1, 2`,
    );
    return rows.map((row) => ({
      account: int(row.account_id),
      common: row.common === true,
      sums: {
        current: dec(row.c_amount),
        previous: dec(row.p_amount),
        lastYear: dec(row.y_amount),
      },
      lines: int(row.c_lines),
    }));
  }

  /** The other income, operating expenses and tax of each period (the chosen branch's only). */
  results(chart: Chart, amounts: readonly LedgerAmount[]): Record<BoardPeriodKey, LedgerSums> {
    const result = Object.fromEntries(
      PERIOD_KEYS.map((key) => [key, { otherIncome: ZERO, expenses: ZERO, tax: ZERO }]),
    ) as Record<BoardPeriodKey, LedgerSums>;
    for (const row of amounts) {
      if (row.common) continue;
      const part = chart.accounts.get(row.account)?.part;
      if (!part) continue;
      for (const key of PERIOD_KEYS) {
        const sums = result[key];
        const amount = row.sums[key];
        if (part === 'EXPENSE') sums.expenses = sums.expenses.plus(amount);
        else if (part === 'OTHER_INCOME') sums.otherIncome = sums.otherIncome.plus(amount);
        else sums.tax = sums.tax.plus(amount);
      }
    }
    return result;
  }

  /**
   * The operating expenses as the chart's tree: a top-level row is the highest group whose every
   * account is an operating expense, opened to its sub-groups when it holds no account of its own
   * (the class's heading, like «Зардал»); an account whose group holds other accounts too keeps that
   * group as its top row; an account without a group stands under «Бүлэггүй данс». Rows down to the
   * accounts, the largest first.
   */
  expenses(chart: Chart, amounts: readonly LedgerAmount[], branchId: number | null): BoardExpenses {
    type Node = {
      kind: BoardExpenseRowKind;
      id: number | null;
      code: string | null;
      name: string | null;
      sort: number;
      sums: Record<BoardPeriodKey, Decimal>;
      children: Map<string, Node>;
    };
    const zero = (): Record<BoardPeriodKey, Decimal> => ({
      current: ZERO,
      previous: ZERO,
      lastYear: ZERO,
    });
    const top = new Map<string, Node>();
    const total = zero();
    const common = zero();
    let lines = 0;
    const own = new Map<number, Record<BoardPeriodKey, Decimal>>();
    for (const row of amounts) {
      if (chart.accounts.get(row.account)?.part !== 'EXPENSE') continue;
      if (row.common) {
        for (const key of PERIOD_KEYS) common[key] = common[key].plus(row.sums[key]);
        continue;
      }
      lines += row.lines;
      const sums = own.get(row.account) ?? zero();
      for (const key of PERIOD_KEYS) sums[key] = sums[key].plus(row.sums[key]);
      own.set(row.account, sums);
    }
    const add = (node: Node, sums: Record<BoardPeriodKey, Decimal>) => {
      for (const key of PERIOD_KEYS) node.sums[key] = node.sums[key].plus(sums[key]);
    };
    const child = (
      level: Map<string, Node>,
      key: string,
      make: () => Omit<Node, 'sums' | 'children'>,
    ): Node => {
      const found = level.get(key);
      if (found) return found;
      const node: Node = { ...make(), sums: zero(), children: new Map() };
      level.set(key, node);
      return node;
    };
    const groupNode = (id: number) => () => {
      const group = chart.groups.get(id);
      return {
        kind: 'GROUP' as const,
        id,
        code: group?.code ?? null,
        name: group?.name ?? null,
        sort: group?.sort ?? 0,
      };
    };
    for (const [accountId, sums] of own) {
      if (PERIOD_KEYS.every((key) => sums[key].isZero())) continue;
      const account = chart.accounts.get(accountId);
      if (!account) continue;
      for (const key of PERIOD_KEYS) total[key] = total[key].plus(sums[key]);
      const chain: number[] = [];
      for (
        let at = account.groupId;
        at !== null && chart.groups.has(at) && !chain.includes(at);
        at = chart.groups.get(at)?.parentId ?? null
      ) {
        chain.push(at);
      }
      let path: Node[];
      if (chain.length === 0) {
        path = [
          child(top, 'NONE', () => ({ kind: 'NONE', id: null, code: null, name: null, sort: 0 })),
        ];
      } else {
        let highest = 0;
        while (highest + 1 < chain.length && chart.pure.has(chain[highest + 1] ?? 0)) highest += 1;
        const head = chain[highest] ?? 0;
        if (highest > 0 && chart.pure.has(head) && (chart.direct.get(head) ?? []).length === 0) {
          highest -= 1;
        }
        path = [];
        let level = top;
        for (const id of chain.slice(0, highest + 1).reverse()) {
          const node = child(level, `G${id}`, groupNode(id));
          path.push(node);
          level = node.children;
        }
      }
      const leaf = child(path.at(-1)?.children ?? top, `A${accountId}`, () => ({
        kind: 'ACCOUNT',
        id: accountId,
        code: account.code,
        name: account.name,
        sort: 0,
      }));
      for (const node of [...path, leaf]) add(node, sums);
    }
    const whole = total.current;
    const finish = (nodes: Map<string, Node>): BoardExpenseRow[] =>
      [...nodes.values()]
        .sort(
          (a, b) =>
            b.sums.current.cmp(a.sums.current) ||
            (a.kind === 'NONE' ? 1 : 0) - (b.kind === 'NONE' ? 1 : 0) ||
            (a.code ?? '').localeCompare(b.code ?? ''),
        )
        .map((node) => ({
          kind: node.kind,
          id: node.id,
          code: node.code,
          name: node.name,
          amount: money(node.sums.current),
          previous: money(node.sums.previous),
          lastYear: money(node.sums.lastYear),
          share: whole.gt(0)
            ? pct(node.sums.current.div(whole).times(100).toDecimalPlaces(1))
            : null,
          children: finish(node.children),
        }));
    const moneyOf = (sums: Record<BoardPeriodKey, Decimal>) =>
      Object.fromEntries(PERIOD_KEYS.map((key) => [key, money(sums[key])])) as Record<
        BoardPeriodKey,
        string
      >;
    return {
      rows: finish(top),
      total: moneyOf(total),
      common: branchId === null ? null : moneyOf(common),
      lines,
    };
  }

  /** Other income, operating expenses and tax by trend period (`to_char` label as the key). */
  async trend(
    company: string,
    chart: Chart,
    range: DateRange,
    label: string,
    branchId: number | null,
  ): Promise<Map<string, LedgerSums>> {
    const ids = countedIds(chart);
    const result = new Map<string, LedgerSums>();
    if (ids.length === 0) return result;
    const rows = await rowsOf(
      this.db,
      sql`SELECT to_char(l.entry_date, ${label}) AS period, l.account_id, sum(l.amount) AS amount
            FROM reporting.ledger_lines l
           WHERE l.company_code = ${company} AND ${between(range)}
             AND l.account_id = ANY(${idArray(ids)})
             AND ${branchId === null ? sql`TRUE` : sql`l.branch_id = ${branchId}`}
           GROUP BY 1, 2`,
    );
    for (const row of rows) {
      const part = chart.accounts.get(int(row.account_id))?.part;
      if (!part) continue;
      const key = scalar(row.period);
      const sums = result.get(key) ?? { otherIncome: ZERO, expenses: ZERO, tax: ZERO };
      const amount = dec(row.amount);
      if (part === 'EXPENSE') sums.expenses = sums.expenses.plus(amount);
      else if (part === 'OTHER_INCOME') sums.otherIncome = sums.otherIncome.plus(amount);
      else sums.tax = sums.tax.plus(amount);
      result.set(key, sums);
    }
    return result;
  }

  /** The lines behind one row of the expense tree in a range, newest first. */
  async entries(
    company: string,
    range: DateRange,
    branchId: number | null,
    query: BoardExpenseEntriesQuery,
  ): Promise<BoardExpenseEntries> {
    const chart = await this.chart(company);
    const expense = (id: number) => chart.accounts.get(id)?.part === 'EXPENSE';
    let ids: number[];
    if (query.rowKind === 'NONE' || query.rowKind === 'COMMON') {
      ids = [...chart.accounts.values()]
        .filter((a) => a.part === 'EXPENSE' && (query.rowKind === 'COMMON' || a.groupId === null))
        .map((a) => a.id);
    } else {
      if (query.id === undefined) throw invalid('id', 'required', 'the row’s id');
      if (query.rowKind === 'ACCOUNT') {
        if (!expense(query.id)) throw invalid('id', 'expense', 'an operating expense account');
        ids = [query.id];
      } else {
        if (!chart.groups.has(query.id)) throw invalid('id', 'group', 'a group of the chart');
        const subtree = new Set<number>();
        const walk = (id: number) => {
          if (subtree.has(id)) return;
          subtree.add(id);
          for (const next of chart.children.get(id) ?? []) walk(next);
        };
        walk(query.id);
        ids = [...chart.accounts.values()]
          .filter((a) => a.part === 'EXPENSE' && a.groupId !== null && subtree.has(a.groupId))
          .map((a) => a.id);
      }
    }
    if (ids.length === 0) return { ...range, rows: [], more: false, total: money(ZERO) };
    const branch =
      query.rowKind === 'COMMON'
        ? sql`l.branch_id IS NULL`
        : branchId === null
          ? sql`TRUE`
          : sql`l.branch_id = ${branchId}`;
    const where = sql`l.company_code = ${company} AND ${between(range)}
                      AND l.account_id = ANY(${idArray(ids)}) AND ${branch}`;
    const [rows, totals] = await Promise.all([
      rowsOf(
        this.db,
        sql`SELECT l.line_id, l.entry_id, l.entry_date::text AS entry_date,
                   coalesce(l.document_number, l.entry_number) AS number, l.source_doc_type,
                   l.description, l.account_id, l.account_code, l.account_name, l.party_name,
                   l.branch_id, b.name AS branch_name, l.amount
              FROM reporting.ledger_lines l
              LEFT JOIN public.branches b ON b.id = l.branch_id
             WHERE ${where}
             ORDER BY l.entry_date DESC, l.entry_id DESC, l.line_id
             LIMIT ${BOARD_MAX_EXPENSE_ENTRIES + 1}`,
      ),
      rowsOf(
        this.db,
        sql`SELECT sum(l.amount) AS amount FROM reporting.ledger_lines l WHERE ${where}`,
      ),
    ]);
    return {
      ...range,
      rows: rows.slice(0, BOARD_MAX_EXPENSE_ENTRIES).map((row) => ({
        lineId: int(row.line_id),
        entryId: int(row.entry_id),
        date: dateText(row.entry_date) ?? '',
        number: scalar(row.number),
        source: textOrNull(row.source_doc_type),
        description: textOrNull(row.description),
        accountId: int(row.account_id),
        accountCode: scalar(row.account_code),
        accountName: scalar(row.account_name),
        partyName: textOrNull(row.party_name),
        branchId: intOrNull(row.branch_id),
        branchName: textOrNull(row.branch_name),
        amount: money(dec(row.amount)),
      })),
      more: rows.length > BOARD_MAX_EXPENSE_ENTRIES,
      total: money(dec(totals[0]?.amount)),
    };
  }
}
