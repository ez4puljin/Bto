import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
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

const MAX_VAT_DOCUMENTS = 2_000;

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
