import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { type SQL, sql } from 'drizzle-orm';
import { type CompanyScope, type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb } from '../db/fin-db';
import { FinError } from '../errors';
import { rulesOn } from '../ledger/chart.service';
import { monthOf } from '../ledger/periods';

type Row = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const str = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const int = (value: unknown): number => Number.parseInt(str(value), 10);
const dec = (value: unknown): Decimal => new Decimal(str(value) || 0);

/** One account of the trial balance (ADR-0105 #2); a balance is debit minus credit. */
export interface FinTrialBalanceRow {
  accountId: number;
  code: string;
  name: string;
  kind: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  status: 'ACTIVE' | 'INACTIVE';
  group: { code: string; name: string } | null;
  opening: Decimal;
  debit: Decimal;
  credit: Decimal;
  closing: Decimal;
}

export interface FinTrialBalance {
  from: string;
  to: string;
  rows: FinTrialBalanceRow[];
  /** Σ over the rows: the openings and closings sum to zero, the period debit equals the credit. */
  totals: { opening: Decimal; debit: Decimal; credit: Decimal; closing: Decimal };
}

export type FinVatSide = 'OUTPUT' | 'INPUT';

/** The VAT of one kind of source document in a month (ADR-0105 #3). */
export interface FinVatGroup {
  side: FinVatSide;
  system: string;
  /** The source's document type; null for an entry typed on the core's screens without one. */
  docType: string | null;
  /** Output: credit − debit; input: debit − credit. */
  vat: Decimal;
  /** Σ of the bases the lines carry, signed like the VAT. */
  base: Decimal;
  /** Lines of the group that carry no base (the POS shift, a manual line). */
  linesWithoutBase: number;
}

/** One journal entry with VAT in the month. */
export interface FinVatDocument {
  entryId: number;
  entryNumber: string;
  entryDate: string;
  system: string;
  docType: string | null;
  docId: string | null;
  documentNumber: string | null;
  reversal: boolean;
  output: Decimal;
  input: Decimal;
  base: Decimal;
}

export interface FinVatReport {
  period: string;
  from: string;
  to: string;
  groups: FinVatGroup[];
  documents: FinVatDocument[];
  /** More documents than the list holds. */
  truncated: boolean;
  output: Decimal;
  input: Decimal;
  /** Output − input: what is owed (negative: carried forward). */
  payable: Decimal;
}

/** An INCOME or EXPENSE account's balance up to a date, for the year close (ADR-0105 #4). */
export interface FinResultBalance {
  accountId: number;
  code: string;
  kind: 'INCOME' | 'EXPENSE';
  /** Debit − credit. */
  balance: Decimal;
}

/** One account's balance with one party (none: the account's lines without a party) at a date. */
export interface FinAccountPartyBalance {
  accountId: number;
  code: string;
  name: string;
  kind: FinTrialBalanceRow['kind'];
  /** The party's id in the core, its name there; null for lines without a party. */
  partyId: string | null;
  partyName: string | null;
  /** Debit − credit of the lines dated up to the date. */
  balance: Decimal;
}

const MAX_VAT_DOCUMENTS = 2_000;

/** The account controls a ledger report picks its accounts by (none: every account). */
export type FinLedgerControl =
  'NONE' | 'RECEIVABLE' | 'PAYABLE' | 'ADVANCE_RECEIVED' | 'ADVANCE_PAID' | 'MONEY';

/** What narrows a ledger report (ADR-0133): accounts, parties and the lines themselves. */
export interface FinLedgerFilter {
  company: string;
  from: string;
  to: string;
  /** These accounts only (none: by the controls and groups). */
  accountIds?: readonly number[];
  /** Accounts of these controls. */
  controls?: readonly FinLedgerControl[];
  /** Accounts of these groups (by code). */
  groupCodes?: readonly string[];
  /** Lines of these parties only. */
  partyIds?: readonly string[];
  /** Lines whose entry or line description holds this text. */
  description?: string;
  /** Lines whose entry has a line on the other side on an account starting with this code. */
  counterAccount?: string;
}

/** One account (× party) of a ledger report: the opening, the period's turnover, the closing. */
export interface FinLedgerReportRow {
  accountId: number;
  code: string;
  name: string;
  control: FinLedgerControl;
  groupCode: string | null;
  groupName: string | null;
  /** The party's id and name in the core; null when not by party or for lines without one. */
  partyId: string | null;
  partyName: string | null;
  /** Debit − credit before `from`. */
  opening: Decimal;
  debit: Decimal;
  credit: Decimal;
  /** Debit − credit at `to`. */
  closing: Decimal;
}

/** The selectable accounts of a ledger report with their groups. */
export interface FinLedgerAccountOption {
  accountId: number;
  code: string;
  name: string;
  control: FinLedgerControl;
  groupCode: string | null;
  groupName: string | null;
}

/** One journal line of a ledger report's detail, with the source it came from. */
export interface FinLedgerLine {
  lineId: number;
  entryId: number;
  entryNumber: string;
  entryDate: string;
  entryDescription: string;
  lineDescription: string | null;
  system: string;
  sourceDocType: string | null;
  sourceDocId: string | null;
  /** The core's document behind the entry (a voucher, an opening), its number. */
  documentId: number | null;
  documentNumber: string | null;
  partyId: string | null;
  partyName: string | null;
  debit: Decimal;
  credit: Decimal;
  /** The other side's accounts of the entry: `D:110103` (debit) or `C:510101` (credit). */
  counters: string[];
  /** Debit − credit after this line, from the opening. */
  balanceAfter: Decimal;
}

export interface FinLedgerLines {
  opening: Decimal;
  rows: FinLedgerLine[];
  /** More lines than the list holds: the oldest are shown. */
  truncated: boolean;
}

const MAX_LEDGER_LINES = 2_000;

/**
 * The core's reports over the journal (F6, ADR-0105): the trial balance of any dates, the month's
 * VAT by source document type, and the result accounts' balances the year close posts away. Read by
 * a user with `finance.read` or a granted source; reads only. Lives under `posting/` because only
 * `posting/**` reads the journal tables (§3.1 rule 9).
 */
@Injectable()
export class FinReports {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  async trialBalance(
    ctx: FinCallContext,
    query: { company: string; from: string; to: string; all?: boolean },
    executor: FinExecutor = this.db,
  ): Promise<FinTrialBalance> {
    if (!ISO_DATE.test(query.from)) throw invalid('from');
    if (!ISO_DATE.test(query.to) || query.to < query.from) throw invalid('to');
    const scope = await this.scope(executor, ctx, query.company);
    const result = await executor.execute<Row>(sql`
      SELECT a.id, a.code, a.name, a.kind, a.status, g.code AS group_code, g.name AS group_name,
             coalesce(sum(l.debit - l.credit) FILTER (WHERE e.entry_date < ${query.from}::date), 0)::text AS opening,
             coalesce(sum(l.debit) FILTER (WHERE e.entry_date >= ${query.from}::date), 0)::text AS debit,
             coalesce(sum(l.credit) FILTER (WHERE e.entry_date >= ${query.from}::date), 0)::text AS credit,
             count(e.id) AS lines
        FROM fin.accounts a
        LEFT JOIN fin.account_groups g ON g.company_id = a.company_id AND g.id = a.group_id
        LEFT JOIN fin.journal_lines l ON l.company_id = a.company_id AND l.account_id = a.id
        LEFT JOIN fin.journal_entries e
               ON e.company_id = l.company_id AND e.id = l.entry_id AND e.entry_date <= ${query.to}::date
       WHERE a.company_id = ${scope.companyId}
       GROUP BY a.id, g.code, g.name
       ORDER BY a.code`);
    const rows: FinTrialBalanceRow[] = [];
    const totals = {
      opening: new Decimal(0),
      debit: new Decimal(0),
      credit: new Decimal(0),
      closing: new Decimal(0),
    };
    for (const row of result.rows) {
      if (!query.all && int(row.lines) === 0) continue;
      const opening = dec(row.opening);
      const debit = dec(row.debit);
      const credit = dec(row.credit);
      const closing = opening.plus(debit).minus(credit);
      rows.push({
        accountId: int(row.id),
        code: str(row.code),
        name: str(row.name),
        kind: str(row.kind) as FinTrialBalanceRow['kind'],
        status: str(row.status) as FinTrialBalanceRow['status'],
        group:
          row.group_code === null ? null : { code: str(row.group_code), name: str(row.group_name) },
        opening,
        debit,
        credit,
        closing,
      });
      totals.opening = totals.opening.plus(opening);
      totals.debit = totals.debit.plus(debit);
      totals.credit = totals.credit.plus(credit);
      totals.closing = totals.closing.plus(closing);
    }
    return { from: query.from, to: query.to, rows, totals };
  }

  /**
   * Every non-zero balance per account × party at `date` (lines dated up to it): the opening's
   * sign-off against Erkhet's closing trial balance (ADR-0106 #5, questionnaire 2.7).
   */
  async accountPartyBalances(
    ctx: FinCallContext,
    query: { company: string; date: string },
    executor: FinExecutor = this.db,
  ): Promise<FinAccountPartyBalance[]> {
    if (!ISO_DATE.test(query.date)) throw invalid('date');
    const scope = await this.scope(executor, ctx, query.company);
    const result = await executor.execute<Row>(sql`
      SELECT a.id, a.code, a.name, a.kind, l.party_id, p.name AS party_name,
             sum(l.debit - l.credit)::text AS balance
        FROM fin.journal_lines l
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
        JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        LEFT JOIN fin.parties p ON p.id = l.party_id
       WHERE l.company_id = ${scope.companyId} AND e.entry_date <= ${query.date}::date
       GROUP BY a.id, l.party_id, p.name
      HAVING sum(l.debit - l.credit) <> 0
       ORDER BY a.code, p.name NULLS FIRST, l.party_id`);
    return result.rows.map((row) => ({
      accountId: int(row.id),
      code: str(row.code),
      name: str(row.name),
      kind: str(row.kind) as FinTrialBalanceRow['kind'],
      partyId: row.party_id === null ? null : str(row.party_id),
      partyName: row.party_name === null ? null : str(row.party_name),
      balance: dec(row.balance),
    }));
  }

  /**
   * The VAT of `period` (ADR-0105 #3): every line on VAT_OUTPUT or VAT_INPUT (by its key, or on the
   * account those keys' rules point to at the month's end), dated in the month by its entry — the tax
   * point is the accounting date (TODO-VERIFY D25) — grouped by the source's document type, with the
   * bases the lines carry and the entries listed (at most 2,000).
   */
  async vatReport(
    ctx: FinCallContext,
    query: { company: string; period: string },
    executor: FinExecutor = this.db,
  ): Promise<FinVatReport> {
    if (!PERIOD.test(query.period)) throw invalid('period');
    const month = monthOf(`${query.period}-01`);
    const scope = await this.scope(executor, ctx, query.company);
    const rules = await rulesOn(executor, scope.companyId, month.endsOn);
    const outputAccount = rules.get('VAT_OUTPUT')?.accountId ?? 0;
    const inputAccount = rules.get('VAT_INPUT')?.accountId ?? 0;
    const lines = sql`
      SELECT l.entry_id, l.debit, l.credit, l.tax_base,
             CASE WHEN l.posting_key = 'VAT_INPUT'
                    OR (l.posting_key IS DISTINCT FROM 'VAT_OUTPUT' AND l.account_id = ${inputAccount})
                  THEN 'INPUT' ELSE 'OUTPUT' END AS side
        FROM fin.journal_lines l
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
       WHERE l.company_id = ${scope.companyId}
         AND e.entry_date BETWEEN ${month.startsOn}::date AND ${month.endsOn}::date
         AND (l.posting_key IN ('VAT_OUTPUT', 'VAT_INPUT')
              OR l.account_id IN (${outputAccount}, ${inputAccount}))`;
    const signed = sql`CASE WHEN v.side = 'OUTPUT' THEN v.credit - v.debit ELSE v.debit - v.credit END`;
    const signedBase = sql`CASE WHEN v.tax_base IS NULL THEN 0
      WHEN (v.side = 'OUTPUT') = (v.credit > 0) THEN v.tax_base ELSE -v.tax_base END`;
    const grouped = await executor.execute<Row>(sql`
      SELECT v.side, s.code AS system, e.source_doc_type AS doc_type,
             sum(${signed})::text AS vat, sum(${signedBase})::text AS base,
             count(*) FILTER (WHERE v.tax_base IS NULL) AS without_base
        FROM (${lines}) v
        JOIN fin.journal_entries e ON e.company_id = ${scope.companyId} AND e.id = v.entry_id
        JOIN fin.source_systems s ON s.id = e.source_system_id
       GROUP BY v.side, s.code, e.source_doc_type
       ORDER BY v.side DESC, s.code, e.source_doc_type NULLS FIRST`);
    const listed = await executor.execute<Row>(sql`
      SELECT e.id, e.number, e.entry_date::text AS entry_date, s.code AS system,
             e.source_doc_type AS doc_type, e.source_doc_id AS doc_id, d.number AS document_number,
             (e.reverses_id IS NOT NULL) AS reversal,
             sum(${signed}) FILTER (WHERE v.side = 'OUTPUT')::text AS output,
             sum(${signed}) FILTER (WHERE v.side = 'INPUT')::text AS input,
             sum(${signedBase})::text AS base
        FROM (${lines}) v
        JOIN fin.journal_entries e ON e.company_id = ${scope.companyId} AND e.id = v.entry_id
        JOIN fin.source_systems s ON s.id = e.source_system_id
        LEFT JOIN fin.documents d ON d.company_id = e.company_id AND d.id = e.document_id
       GROUP BY e.id, s.code, d.number
       ORDER BY e.entry_date, e.id
       LIMIT ${MAX_VAT_DOCUMENTS + 1}`);
    const groups = grouped.rows.map((row) => ({
      side: str(row.side) as FinVatSide,
      system: str(row.system),
      docType: row.doc_type === null ? null : str(row.doc_type),
      vat: dec(row.vat),
      base: dec(row.base),
      linesWithoutBase: int(row.without_base),
    }));
    let output = new Decimal(0);
    let input = new Decimal(0);
    for (const group of groups) {
      if (group.side === 'OUTPUT') output = output.plus(group.vat);
      else input = input.plus(group.vat);
    }
    return {
      period: query.period,
      from: month.startsOn,
      to: month.endsOn,
      groups,
      documents: listed.rows.slice(0, MAX_VAT_DOCUMENTS).map((row) => ({
        entryId: int(row.id),
        entryNumber: str(row.number),
        entryDate: str(row.entry_date),
        system: str(row.system),
        docType: row.doc_type === null ? null : str(row.doc_type),
        docId: row.doc_id === null ? null : str(row.doc_id),
        documentNumber: row.document_number === null ? null : str(row.document_number),
        reversal: row.reversal === true,
        output: dec(row.output),
        input: dec(row.input),
        base: dec(row.base),
      })),
      truncated: listed.rows.length > MAX_VAT_DOCUMENTS,
      output,
      input,
      payable: output.minus(input),
    };
  }

  /** Every INCOME and EXPENSE account with a balance up to `asOf` (the year close's lines). */
  async resultBalances(
    ctx: FinCallContext,
    query: { company: string; asOf: string },
    executor: FinExecutor = this.db,
  ): Promise<FinResultBalance[]> {
    if (!ISO_DATE.test(query.asOf)) throw invalid('asOf');
    const scope = await this.scope(executor, ctx, query.company);
    const result = await executor.execute<Row>(sql`
      SELECT a.id, a.code, a.kind, sum(l.debit - l.credit)::text AS balance
        FROM fin.accounts a
        JOIN fin.journal_lines l ON l.company_id = a.company_id AND l.account_id = a.id
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
       WHERE a.company_id = ${scope.companyId} AND a.kind IN ('INCOME', 'EXPENSE')
         AND e.entry_date <= ${query.asOf}::date
       GROUP BY a.id
      HAVING sum(l.debit - l.credit) <> 0
       ORDER BY a.code`);
    return result.rows.map((row) => ({
      accountId: int(row.id),
      code: str(row.code),
      kind: str(row.kind) as FinResultBalance['kind'],
      balance: dec(row.balance),
    }));
  }

  /** The accounts a ledger report can pick (ADR-0133): every account with its control and group. */
  async ledgerAccounts(
    ctx: FinCallContext,
    query: { company: string },
    executor: FinExecutor = this.db,
  ): Promise<FinLedgerAccountOption[]> {
    const scope = await this.scope(executor, ctx, query.company);
    const result = await executor.execute<Row>(sql`
      SELECT a.id, a.code, a.name, a.control, g.code AS group_code, g.name AS group_name
        FROM fin.accounts a
        LEFT JOIN fin.account_groups g ON g.company_id = a.company_id AND g.id = a.group_id
       WHERE a.company_id = ${scope.companyId}
       ORDER BY a.code`);
    return result.rows.map((row) => ({
      accountId: int(row.id),
      code: str(row.code),
      name: str(row.name),
      control: str(row.control) as FinLedgerControl,
      groupCode: row.group_code === null ? null : str(row.group_code),
      groupName: row.group_name === null ? null : str(row.group_name),
    }));
  }

  /**
   * The ledger report of accounts × parties (ADR-0133, Erkhet's «Авлага өглөгийн тайлан» and
   * «Мөнгөн хөрөнгийн тайлан»): per account — and per party with `byParty` — the balance before
   * `from`, the period's debit and credit and the balance at `to`, of the lines the filter keeps.
   * Rows without an opening or a turnover are left out unless `withEmpty`, which also lists the
   * filter's active accounts without lines.
   */
  async ledgerReport(
    ctx: FinCallContext,
    query: FinLedgerFilter & { byParty: boolean; withEmpty?: boolean },
    executor: FinExecutor = this.db,
  ): Promise<FinLedgerReportRow[]> {
    checkRange(query.from, query.to);
    const scope = await this.scope(executor, ctx, query.company);
    const party = query.byParty ? sql`l.party_id` : sql`NULL::bigint`;
    const joined = query.withEmpty ? sql`LEFT JOIN` : sql`JOIN`;
    const result = await executor.execute<Row>(sql`
      SELECT a.id, a.code, a.name, a.control, g.code AS group_code, g.name AS group_name,
             x.party_id, p.name AS party_name,
             coalesce(x.opening, 0)::text AS opening, coalesce(x.debit, 0)::text AS debit,
             coalesce(x.credit, 0)::text AS credit
        FROM fin.accounts a
        LEFT JOIN fin.account_groups g ON g.company_id = a.company_id AND g.id = a.group_id
        ${joined} (
          SELECT l.account_id, ${party} AS party_id,
                 sum(l.debit - l.credit) FILTER (WHERE e.entry_date < ${query.from}::date) AS opening,
                 sum(l.debit) FILTER (WHERE e.entry_date >= ${query.from}::date) AS debit,
                 sum(l.credit) FILTER (WHERE e.entry_date >= ${query.from}::date) AS credit
            FROM fin.journal_lines l
            JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
           WHERE l.company_id = ${scope.companyId} AND e.entry_date <= ${query.to}::date
             AND ${lineConditions(query)}
           GROUP BY 1, 2) x ON x.account_id = a.id
        LEFT JOIN fin.parties p ON p.id = x.party_id
       WHERE a.company_id = ${scope.companyId} AND ${accountConditions(query)}
         AND (x.account_id IS NOT NULL OR a.status = 'ACTIVE')
       ORDER BY a.code, p.name NULLS FIRST, x.party_id`);
    const rows: FinLedgerReportRow[] = [];
    for (const row of result.rows) {
      const opening = dec(row.opening);
      const debit = dec(row.debit);
      const credit = dec(row.credit);
      if (!query.withEmpty && opening.isZero() && debit.isZero() && credit.isZero()) continue;
      rows.push({
        accountId: int(row.id),
        code: str(row.code),
        name: str(row.name),
        control: str(row.control) as FinLedgerControl,
        groupCode: row.group_code === null ? null : str(row.group_code),
        groupName: row.group_name === null ? null : str(row.group_name),
        partyId: row.party_id === null ? null : str(row.party_id),
        partyName: row.party_name === null ? null : str(row.party_name),
        opening,
        debit,
        credit,
        closing: opening.plus(debit).minus(credit),
      });
    }
    return rows;
  }

  /**
   * The lines behind one row of the ledger report (ADR-0133): the account's lines in the period —
   * of one party, of none (`partyId: null`) or of all (undefined) — oldest first with the entry, its
   * source and the other side's accounts, the running balance from the opening; at most 2,000.
   */
  async ledgerLines(
    ctx: FinCallContext,
    query: FinLedgerFilter & { accountId: number; partyId?: string | null },
    executor: FinExecutor = this.db,
  ): Promise<FinLedgerLines> {
    checkRange(query.from, query.to);
    const scope = await this.scope(executor, ctx, query.company);
    const party =
      query.partyId === undefined
        ? sql`TRUE`
        : query.partyId === null
          ? sql`l.party_id IS NULL`
          : sql`l.party_id = ${partyKey(query.partyId)}::bigint`;
    const where = sql`l.company_id = ${scope.companyId} AND l.account_id = ${query.accountId}
      AND ${party} AND ${lineConditions(query)}`;
    const before = await executor.execute<Row>(sql`
      SELECT coalesce(sum(l.debit - l.credit), 0)::text AS opening
        FROM fin.journal_lines l
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
       WHERE ${where} AND e.entry_date < ${query.from}::date`);
    const opening = dec(before.rows[0]?.opening);
    const result = await executor.execute<Row>(sql`
      SELECT l.id, l.entry_id, e.number, e.entry_date::text AS entry_date,
             e.description AS entry_description, l.description AS line_description,
             s.code AS system, e.source_doc_type, e.source_doc_id, e.document_id,
             d.number AS document_number, l.party_id, p.name AS party_name,
             l.debit::text AS debit, l.credit::text AS credit, c.counters
        FROM fin.journal_lines l
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
        JOIN fin.source_systems s ON s.id = e.source_system_id
        LEFT JOIN fin.documents d ON d.company_id = e.company_id AND d.id = e.document_id
        LEFT JOIN fin.parties p ON p.id = l.party_id
        LEFT JOIN LATERAL (
          SELECT array_agg(DISTINCT (CASE WHEN o.debit > 0 THEN 'D:' ELSE 'C:' END) || oa.code) AS counters
            FROM fin.journal_lines o
            JOIN fin.accounts oa ON oa.company_id = o.company_id AND oa.id = o.account_id
           WHERE o.company_id = l.company_id AND o.entry_id = l.entry_id AND o.id <> l.id
             AND (o.debit > 0) = (l.credit > 0)) c ON TRUE
       WHERE ${where} AND e.entry_date BETWEEN ${query.from}::date AND ${query.to}::date
       ORDER BY e.entry_date, e.id, l.line_no
       LIMIT ${MAX_LEDGER_LINES + 1}`);
    let balance = opening;
    const rows = result.rows.slice(0, MAX_LEDGER_LINES).map((row): FinLedgerLine => {
      const debit = dec(row.debit);
      const credit = dec(row.credit);
      balance = balance.plus(debit).minus(credit);
      return {
        lineId: int(row.id),
        entryId: int(row.entry_id),
        entryNumber: str(row.number),
        entryDate: str(row.entry_date),
        entryDescription: str(row.entry_description),
        lineDescription: row.line_description === null ? null : str(row.line_description),
        system: str(row.system),
        sourceDocType: row.source_doc_type === null ? null : str(row.source_doc_type),
        sourceDocId: row.source_doc_id === null ? null : str(row.source_doc_id),
        documentId: row.document_id === null ? null : int(row.document_id),
        documentNumber: row.document_number === null ? null : str(row.document_number),
        partyId: row.party_id === null ? null : str(row.party_id),
        partyName: row.party_name === null ? null : str(row.party_name),
        debit,
        credit,
        counters: Array.isArray(row.counters) ? row.counters.map(str) : [],
        balanceAfter: balance,
      };
    });
    return { opening, rows, truncated: result.rows.length > MAX_LEDGER_LINES };
  }

  private scope(
    executor: FinExecutor,
    ctx: FinCallContext,
    company: string,
  ): Promise<CompanyScope> {
    return resolveCompany(executor, ctx, company, { source: true, userAnyOf: ['finance.read'] });
  }
}

function invalid(path: string): FinError {
  return new FinError('FIN_PAYLOAD_INVALID', undefined, { path });
}

function checkRange(from: string, to: string): void {
  if (!ISO_DATE.test(from)) throw invalid('from');
  if (!ISO_DATE.test(to) || to < from) throw invalid('to');
}

/** A party id as the API carries it (a positive whole number in text). */
function partyKey(value: string): string {
  if (!/^[1-9]\d{0,17}$/.test(value)) throw invalid('partyId');
  return value;
}

/** `%text%` for ILIKE with the pattern characters taken literally. */
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** The ledger filter's conditions on the accounts (alias `a`). */
function accountConditions(filter: FinLedgerFilter): SQL {
  const parts: SQL[] = [];
  if (filter.accountIds?.length) {
    parts.push(
      sql`a.id IN (${sql.join(
        filter.accountIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }
  if (filter.controls?.length) {
    parts.push(
      sql`a.control IN (${sql.join(
        filter.controls.map((control) => sql`${control}`),
        sql`, `,
      )})`,
    );
  }
  if (filter.groupCodes?.length) {
    parts.push(
      sql`g.code IN (${sql.join(
        filter.groupCodes.map((code) => sql`${code}`),
        sql`, `,
      )})`,
    );
  }
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/** The ledger filter's conditions on the lines (alias `l`, the entry `e`). */
function lineConditions(filter: FinLedgerFilter): SQL {
  const parts: SQL[] = [];
  if (filter.partyIds?.length) {
    parts.push(
      sql`l.party_id IN (${sql.join(
        filter.partyIds.map((id) => sql`${partyKey(id)}::bigint`),
        sql`, `,
      )})`,
    );
  }
  const text = filter.description?.trim();
  if (text) {
    const pattern = containsPattern(text);
    parts.push(sql`(e.description ILIKE ${pattern} OR l.description ILIKE ${pattern})`);
  }
  const counter = filter.counterAccount?.trim();
  if (counter) {
    if (!/^[0-9A-Za-z.-]{1,32}$/.test(counter)) throw invalid('counterAccount');
    parts.push(sql`EXISTS (
      SELECT 1 FROM fin.journal_lines o
        JOIN fin.accounts oa ON oa.company_id = o.company_id AND oa.id = o.account_id
       WHERE o.company_id = l.company_id AND o.entry_id = l.entry_id AND o.id <> l.id
         AND (o.debit > 0) = (l.credit > 0) AND oa.code LIKE ${`${counter}%`})`);
  }
  return parts.length ? sql.join(parts, sql` AND `) : sql`TRUE`;
}
