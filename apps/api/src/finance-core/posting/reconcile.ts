import { Decimal } from '@tugeel/shared/money';
import { sql } from 'drizzle-orm';
import type { FinTx } from '../db/fin-db';
import { finReconcileRuns } from '../schema';
import { refreshPartyBalancesInTx } from './sub-ledger';

/** Anything that opens a transaction the core can use: the core's handle, or a source's (a CLI). */
export interface FinTransactor {
  transaction<T>(work: (tx: FinTx) => Promise<T>): Promise<T>;
}

export type FinReconcileKind = 'CACHE' | 'ITEMS' | 'SUBLEDGER_GL';

export interface FinReconcileDrift {
  partyId: number;
  accountId: number;
  itemId?: number;
  expected: string;
  found: string;
}

export interface FinReconcileRun {
  id: number;
  companyId: number;
  kind: FinReconcileKind;
  status: 'OK' | 'DRIFT';
  checked: number;
  drifted: number;
  details: FinReconcileDrift[];
}

type Row = Record<string, unknown>;
const MAX_DETAILS = 200;
/** A raw row's value as text (numerics, ids and dates come back as strings or numbers). */
const scalar = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean'
      ? value.toString()
      : value instanceof Date
        ? value.toISOString()
        : '';
const int = (value: unknown): number => Number.parseInt(scalar(value), 10);
const dec = (value: unknown): Decimal => new Decimal(scalar(value) || 0);

/**
 * The core's reconcile (ADR-0072 #8), per company in one transaction: CACHE (each party balance
 * against its open items, then rewritten), ITEMS (each item's open amount against its amount less
 * its allocations) and SUBLEDGER_GL (the open items of each party and control account against the
 * account's lines). One `fin.reconcile_runs` row per kind; a drift is a bug to find, never fixed by
 * hand (only the cache is rewritten).
 */
export async function reconcileBooks(
  db: FinTransactor,
  trigger: 'NIGHTLY' | 'MANUAL',
): Promise<FinReconcileRun[]> {
  return db.transaction(async (tx) => {
    const companies = await tx.execute<Row>(sql`SELECT id FROM fin.companies ORDER BY id`);
    const runs: FinReconcileRun[] = [];
    for (const company of companies.rows) {
      const companyId = int(company.id);
      runs.push(await cacheRun(tx, companyId, trigger));
      runs.push(await itemsRun(tx, companyId, trigger));
      runs.push(await subledgerRun(tx, companyId, trigger));
    }
    return runs;
  });
}

/**
 * The open amount of each live document of a source key type (a source's completeness and mirror
 * check, ADR-0071 #12): Σ of its items' open amounts by source doc id, across the companies. Run by
 * a reconcile inside its own transaction; it reads only.
 */
export async function sourceOpenAmounts(
  tx: FinTx,
  query: { system: string; docType: string },
): Promise<Map<string, Decimal>> {
  const result = await tx.execute<Row>(sql`
    SELECT d.source_doc_id, sum(i.open_amount) AS open
      FROM fin.documents d
      JOIN fin.source_systems s ON s.id = d.source_system_id
      JOIN fin.open_items i ON i.company_id = d.company_id AND i.document_id = d.id
     WHERE s.code = ${query.system} AND d.source_doc_type = ${query.docType}
       AND d.reverses_document_id IS NULL
     GROUP BY d.source_doc_id`);
  return new Map(result.rows.map((row) => [String(row.source_doc_id), dec(row.open)]));
}

async function cacheRun(
  tx: FinTx,
  companyId: number,
  trigger: 'NIGHTLY' | 'MANUAL',
): Promise<FinReconcileRun> {
  const startedAt = new Date();
  const result = await tx.execute<Row>(sql`
    WITH pairs AS (
      SELECT party_id, account_id FROM fin.party_balances WHERE company_id = ${companyId}
      UNION SELECT party_id, account_id FROM fin.open_items WHERE company_id = ${companyId}),
    computed AS (
      SELECT p.party_id, p.account_id,
             coalesce(sum(i.open_amount) FILTER (WHERE i.side = 'DEBIT'), 0) AS open_debit,
             coalesce(sum(i.open_amount) FILTER (WHERE i.side = 'CREDIT'), 0) AS open_credit
        FROM pairs p
        LEFT JOIN fin.open_items i ON i.company_id = ${companyId} AND i.party_id = p.party_id
                                  AND i.account_id = p.account_id
       GROUP BY p.party_id, p.account_id)
    SELECT c.party_id, c.account_id, c.open_debit, c.open_credit,
           coalesce(b.open_debit, 0) AS cached_debit, coalesce(b.open_credit, 0) AS cached_credit
      FROM computed c
      LEFT JOIN fin.party_balances b ON b.company_id = ${companyId} AND b.party_id = c.party_id
                                    AND b.account_id = c.account_id
     ORDER BY c.party_id, c.account_id`);
  const drifts: FinReconcileDrift[] = [];
  for (const row of result.rows) {
    const expected = `${dec(row.open_debit).toFixed(2)}/${dec(row.open_credit).toFixed(2)}`;
    const found = `${dec(row.cached_debit).toFixed(2)}/${dec(row.cached_credit).toFixed(2)}`;
    if (expected !== found) {
      drifts.push({ partyId: int(row.party_id), accountId: int(row.account_id), expected, found });
    }
  }
  await refreshPartyBalancesInTx(
    tx,
    companyId,
    result.rows.map((row) => ({ partyId: int(row.party_id), accountId: int(row.account_id) })),
  );
  return record(tx, companyId, 'CACHE', trigger, startedAt, result.rows.length, drifts);
}

async function itemsRun(
  tx: FinTx,
  companyId: number,
  trigger: 'NIGHTLY' | 'MANUAL',
): Promise<FinReconcileRun> {
  const startedAt = new Date();
  const result = await tx.execute<Row>(sql`
    SELECT i.id, i.party_id, i.account_id, i.open_amount,
           i.amount - coalesce((SELECT sum(CASE WHEN a.reverses_allocation_id IS NULL THEN a.amount ELSE -a.amount END)
                                  FROM fin.allocations a
                                 WHERE a.company_id = i.company_id
                                   AND (a.debit_item_id = i.id OR a.credit_item_id = i.id)), 0) AS expected
      FROM fin.open_items i
     WHERE i.company_id = ${companyId}
     ORDER BY i.id`);
  const drifts: FinReconcileDrift[] = [];
  for (const row of result.rows) {
    if (!dec(row.open_amount).eq(dec(row.expected))) {
      drifts.push({
        partyId: int(row.party_id),
        accountId: int(row.account_id),
        itemId: int(row.id),
        expected: dec(row.expected).toFixed(2),
        found: dec(row.open_amount).toFixed(2),
      });
    }
  }
  return record(tx, companyId, 'ITEMS', trigger, startedAt, result.rows.length, drifts);
}

async function subledgerRun(
  tx: FinTx,
  companyId: number,
  trigger: 'NIGHTLY' | 'MANUAL',
): Promise<FinReconcileRun> {
  const startedAt = new Date();
  const result = await tx.execute<Row>(sql`
    WITH gl AS (
      SELECT l.party_id, l.account_id, sum(l.debit - l.credit) AS net
        FROM fin.journal_lines l
        JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
       WHERE l.company_id = ${companyId}
         AND a.control IN ('RECEIVABLE', 'PAYABLE', 'ADVANCE_RECEIVED', 'ADVANCE_PAID')
       GROUP BY l.party_id, l.account_id),
    items AS (
      SELECT party_id, account_id,
             sum(CASE side WHEN 'DEBIT' THEN open_amount ELSE -open_amount END) AS net
        FROM fin.open_items WHERE company_id = ${companyId}
       GROUP BY party_id, account_id)
    SELECT coalesce(gl.party_id, items.party_id) AS party_id,
           coalesce(gl.account_id, items.account_id) AS account_id,
           coalesce(gl.net, 0) AS gl_net, coalesce(items.net, 0) AS items_net
      FROM gl FULL JOIN items ON items.party_id IS NOT DISTINCT FROM gl.party_id
                             AND items.account_id = gl.account_id
     ORDER BY 1, 2`);
  const drifts: FinReconcileDrift[] = [];
  for (const row of result.rows) {
    if (!dec(row.gl_net).eq(dec(row.items_net))) {
      drifts.push({
        partyId: row.party_id === null ? 0 : int(row.party_id),
        accountId: int(row.account_id),
        expected: dec(row.gl_net).toFixed(2),
        found: dec(row.items_net).toFixed(2),
      });
    }
  }
  return record(tx, companyId, 'SUBLEDGER_GL', trigger, startedAt, result.rows.length, drifts);
}

async function record(
  tx: FinTx,
  companyId: number,
  kind: FinReconcileKind,
  trigger: 'NIGHTLY' | 'MANUAL',
  startedAt: Date,
  checked: number,
  drifts: FinReconcileDrift[],
): Promise<FinReconcileRun> {
  const status = drifts.length === 0 ? 'OK' : 'DRIFT';
  const [run] = await tx
    .insert(finReconcileRuns)
    .values({
      companyId,
      kind,
      trigger,
      status,
      checked,
      drifted: drifts.length,
      details: drifts.slice(0, MAX_DETAILS),
      startedAt,
    })
    .returning({ id: finReconcileRuns.id });
  if (!run) throw new Error('fin reconcile run was not recorded');
  return { id: run.id, companyId, kind, status, checked, drifted: drifts.length, details: drifts };
}

/** One company's balance on the account a posting key's rule points to today. */
export interface FinKeyBalance {
  company: string;
  accountCode: string | null;
  /** Σ debit − Σ credit of the account's lines. */
  balance: Decimal;
}

/**
 * The balance of the account each company's rule for `key` points to today (F4, ADR-0097: a
 * source compares its own figure with it, e.g. the stock's value with INVENTORY). Reads only.
 */
export async function postingKeyBalances(db: FinTransactor, key: string): Promise<FinKeyBalance[]> {
  return db.transaction(async (tx) => {
    const result = await tx.execute<Row>(sql`
      SELECT c.code AS company, a.code AS account_code,
             (SELECT coalesce(sum(l.debit - l.credit), 0) FROM fin.journal_lines l
               WHERE l.company_id = c.id AND l.account_id = a.id) AS balance
        FROM fin.companies c
        LEFT JOIN LATERAL (
          SELECT r.account_id FROM fin.posting_rules r
           WHERE r.company_id = c.id AND r.posting_key = ${key} AND r.effective_from <= current_date
           ORDER BY r.effective_from DESC, r.id DESC LIMIT 1) rule ON true
        LEFT JOIN fin.accounts a ON a.company_id = c.id AND a.id = rule.account_id
       ORDER BY c.id`);
    return result.rows.map((row) => ({
      company: scalar(row.company),
      accountCode: row.account_code === null ? null : scalar(row.account_code),
      balance: dec(row.balance),
    }));
  });
}
