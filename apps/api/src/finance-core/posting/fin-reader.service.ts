import { Inject, Injectable } from '@nestjs/common';
import type { ExposureV1 } from '@tugeel/fin-contract';
import { Decimal } from '@tugeel/shared/money';
import { businessDateIn } from '@tugeel/shared/time';
import { sql, type SQL } from 'drizzle-orm';
import { type CompanyScope, type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb, type FinTx } from '../db/fin-db';
import { lockPartiesInTx } from './sub-ledger';

/** A party as a source knows it (`BTO`, `customer:412`). */
export interface FinPartyKey {
  system: string;
  ref: string;
}

/** A document as Bto's screens list it: a voucher, an invoice's settlement, a ledger line's origin. */
export interface FinDocumentRow {
  id: number;
  typeCode: string;
  class: string;
  number: string;
  documentDate: string;
  accountingDate: string;
  partyId: number | null;
  amount: Decimal;
  description: string;
  attributes: Record<string, string>;
  moneyAccountId: number | null;
  /** The account of a voucher's other line when it names no party (another income or expense). */
  counterAccountId: number | null;
  sourceSystem: string;
  sourceDocType: string;
  sourceDocId: string;
  actorRef: string;
  actorLabel: string;
  postedAt: Date;
  entryId: number | null;
  journalNo: string | null;
  /** Σ of the live allocations on the document's own items (what it settled, or was settled by). */
  settled: Decimal;
  reversal: {
    id: number;
    postedAt: Date;
    actorRef: string;
    actorLabel: string;
    reason: string;
    entryId: number | null;
  } | null;
}

/** An allocation touching a document's items, with the item on the other side. */
export interface FinAllocationRow {
  id: number;
  amount: Decimal;
  createdAt: Date;
  /** When an undoing allocation took it back (a voided voucher, a reversed ALLOCATION). */
  undoneAt: Date | null;
  /** The document that made it (the voucher, the credit note, an ALLOCATION). */
  byDocument: { id: number; typeCode: string; class: string; number: string; documentDate: string };
  ownDocumentId: number;
  counterpart: {
    itemId: number;
    documentId: number;
    typeCode: string;
    number: string;
    sourceSystem: string;
    sourceDocType: string;
    sourceDocId: string;
    documentDate: string;
    dueDate: string | null;
  };
}

/** A line on a party-control account: a party's ledger and statement. */
export interface FinPartyLedgerRow {
  lineId: number;
  entryId: number;
  entryDate: string;
  debit: Decimal;
  credit: Decimal;
  balanceAfter: Decimal;
  postedAt: Date;
  document: {
    id: number;
    typeCode: string;
    class: string;
    number: string;
    sourceSystem: string;
    sourceDocType: string;
    sourceDocId: string;
  } | null;
  /** The document a reversal reverses. */
  reverses: {
    id: number;
    typeCode: string;
    number: string;
    sourceSystem: string;
    sourceDocType: string;
    sourceDocId: string;
  } | null;
}

export interface FinPartyBalanceRow {
  partyId: number;
  openDebit: Decimal;
  openCredit: Decimal;
  net: Decimal;
  overdue: Decimal;
  oldestDueDate: string | null;
  updatedAt: Date | null;
}

export interface FinOpenItemRow {
  id: number;
  side: 'DEBIT' | 'CREDIT';
  itemDate: string;
  dueDate: string | null;
  amount: Decimal;
  openAmount: Decimal;
  document: {
    id: number;
    typeCode: string;
    class: string;
    number: string;
    sourceSystem: string;
    sourceDocType: string;
    sourceDocId: string;
  };
}

export interface FinItemSource {
  id: number;
  documentId: number;
  sourceSystem: string;
  sourceDocType: string;
  sourceDocId: string;
  openAmount: Decimal;
}

type Row = Record<string, unknown>;

const dec = (value: unknown): Decimal => new Decimal(typeof value === 'string' ? value : String(value ?? 0));
const int = (value: unknown): number => Number.parseInt(String(value), 10);
const intOrNull = (value: unknown): number | null => (value === null || value === undefined ? null : int(value));
const str = (value: unknown): string => String(value);
const strOrNull = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const date = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

/**
 * The read port of the sub-ledger (docs/modules/finance-core.md §8), as far as Bto needs it in F2
 * (ADR-0090): exposure for the credit check (also inside the caller's transaction, under the party
 * lock), party balances, a party's ledger and statement, documents and their allocations, open
 * items, a money account's book and the items a posting touched. Read by a granted source or a
 * user with `finance.read`; it lives in `posting/**` because only that names the ledger tables.
 */
@Injectable()
export class FinReader {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  /** The credit check's numbers (ADR-0073 #4), the party locked FOR NO KEY UPDATE (§10). */
  async exposureInTx(
    tx: FinTx,
    ctx: FinCallContext,
    query: { company: string; party: FinPartyKey },
  ): Promise<ExposureV1> {
    const scope = await this.scope(tx, ctx, query.company);
    const partyId = await this.partyOfKey(tx, scope, query.party);
    if (partyId === null) return zeroExposure();
    await lockPartiesInTx(tx, scope.companyId, [partyId]);
    return this.exposureOf(tx, scope, partyId);
  }

  /** The same numbers without the lock (screens, the customer app). */
  async exposure(
    ctx: FinCallContext,
    query: { company: string; party: FinPartyKey },
    executor: FinExecutor = this.db,
  ): Promise<ExposureV1> {
    const scope = await this.scope(executor, ctx, query.company);
    const partyId = await this.partyOfKey(executor, scope, query.party);
    if (partyId === null) return zeroExposure();
    return this.exposureOf(executor, scope, partyId);
  }

  /**
   * Party balances on the receivable accounts, largest net first (keyset: net, party), with the
   * live overdue amount; `overdueOnly` keeps parties with an open debit item past due.
   */
  async partyBalances(
    ctx: FinCallContext,
    query: {
      company: string;
      partyIds?: readonly number[];
      overdueOnly?: boolean;
      after?: { net: string; partyId: number };
      limit: number;
    },
  ): Promise<FinPartyBalanceRow[]> {
    const scope = await this.scope(this.db, ctx, query.company);
    const today = await this.today(this.db, scope);
    const filters: SQL[] = [sql`TRUE`];
    if (query.partyIds) {
      if (query.partyIds.length === 0) return [];
      filters.push(sql`b.party_id IN (${sql.join(query.partyIds.map((id) => sql`${id}`), sql`, `)})`);
    }
    if (query.overdueOnly) filters.push(sql`b.overdue > 0`);
    if (query.after) {
      filters.push(
        sql`(b.net < ${query.after.net}::numeric OR (b.net = ${query.after.net}::numeric AND b.party_id > ${query.after.partyId}))`,
      );
    }
    const result = await this.db.execute<Row>(sql`
      WITH b AS (
        SELECT pb.party_id, sum(pb.open_debit) AS open_debit, sum(pb.open_credit) AS open_credit,
               sum(pb.open_debit) - sum(pb.open_credit) AS net, min(pb.oldest_due_date)::text AS oldest,
               max(pb.updated_at) AS updated_at,
               (SELECT coalesce(sum(i.open_amount), 0) FROM fin.open_items i
                  JOIN fin.accounts ia ON ia.company_id = i.company_id AND ia.id = i.account_id
                 WHERE i.company_id = ${scope.companyId} AND i.party_id = pb.party_id
                   AND ia.control = 'RECEIVABLE' AND i.side = 'DEBIT' AND i.open_amount > 0
                   AND i.due_date < ${today}::date) AS overdue
          FROM fin.party_balances pb
          JOIN fin.accounts a ON a.company_id = pb.company_id AND a.id = pb.account_id
         WHERE pb.company_id = ${scope.companyId} AND a.control = 'RECEIVABLE'
         GROUP BY pb.party_id)
      SELECT * FROM b WHERE ${sql.join(filters, sql` AND `)}
       ORDER BY b.net DESC, b.party_id
       LIMIT ${query.limit + 1}`);
    return result.rows.map((row) => ({
      partyId: int(row.party_id),
      openDebit: dec(row.open_debit),
      openCredit: dec(row.open_credit),
      net: dec(row.net),
      overdue: dec(row.overdue),
      oldestDueDate: strOrNull(row.oldest),
      updatedAt: row.updated_at === null ? null : date(row.updated_at),
    }));
  }

  /** One party's balance on the receivable accounts (zeros when it has none). */
  async partyBalance(ctx: FinCallContext, query: { company: string; partyId: number }): Promise<FinPartyBalanceRow> {
    const [row] = await this.partyBalances(ctx, { company: query.company, partyIds: [query.partyId], limit: 1 });
    return (
      row ?? {
        partyId: query.partyId,
        openDebit: new Decimal(0),
        openCredit: new Decimal(0),
        net: new Decimal(0),
        overdue: new Decimal(0),
        oldestDueDate: null,
        updatedAt: null,
      }
    );
  }

  /**
   * A party's lines on the receivable accounts, newest first by line (the order they were posted),
   * each with the balance after it and its document; the balance before `from`.
   */
  async partyLedger(
    ctx: FinCallContext,
    query: { company: string; partyId: number; from?: string; to?: string; beforeLineId?: number; limit: number },
  ): Promise<{ rows: FinPartyLedgerRow[]; opening: Decimal }> {
    const scope = await this.scope(this.db, ctx, query.company);
    const filters: SQL[] = [sql`TRUE`];
    if (query.from) filters.push(sql`r.entry_date >= ${query.from}::date`);
    if (query.to) filters.push(sql`r.entry_date <= ${query.to}::date`);
    if (query.beforeLineId !== undefined) filters.push(sql`r.line_id < ${query.beforeLineId}`);
    const result = await this.db.execute<Row>(sql`
      WITH r AS (${this.partyLinesSql(scope.companyId, query.partyId, sql`l.id`)})
      SELECT * FROM r WHERE ${sql.join(filters, sql` AND `)} ORDER BY r.line_id DESC LIMIT ${query.limit + 1}`);
    const opening = query.from
      ? await this.partyBalanceBefore(scope.companyId, query.partyId, query.from)
      : new Decimal(0);
    return { rows: result.rows.map(toLedgerRow), opening };
  }

  /** A party's statement: the balance before `from`, the lines dated `from` … `to` by date, the close. */
  async partyStatement(
    ctx: FinCallContext,
    query: { company: string; partyId: number; from: string; to: string },
  ): Promise<{ opening: Decimal; rows: FinPartyLedgerRow[] }> {
    const scope = await this.scope(this.db, ctx, query.company);
    const opening = await this.partyBalanceBefore(scope.companyId, query.partyId, query.from);
    const result = await this.db.execute<Row>(sql`
      WITH r AS (${this.partyLinesSql(scope.companyId, query.partyId, sql`e.entry_date, l.id`)})
      SELECT * FROM r WHERE r.entry_date BETWEEN ${query.from}::date AND ${query.to}::date
       ORDER BY r.entry_date, r.line_id`);
    let balance = opening;
    const rows = result.rows.map((row) => {
      const mapped = toLedgerRow(row);
      balance = balance.plus(mapped.debit).minus(mapped.credit);
      return { ...mapped, balanceAfter: balance };
    });
    return { opening, rows };
  }

  /**
   * Documents of these types, newest first by (date, id): the vouchers' list and the customer
   * app's payments. `reversed` keeps live (false) or reversed (true) ones; reversals are never rows.
   */
  async documents(
    ctx: FinCallContext,
    query: {
      company: string;
      typeCodes: readonly string[];
      ids?: readonly number[];
      partyIds?: readonly number[];
      moneyAccountId?: number;
      reversed?: boolean;
      classes?: readonly string[];
      from?: string;
      to?: string;
      /** ILIKE over the number, the description and the attributes, or one of these parties. */
      text?: { pattern: string; partyIds: readonly number[] };
      after?: { date: string; id: number };
      limit?: number;
      count?: boolean;
    },
  ): Promise<{ rows: FinDocumentRow[]; total: number | null }> {
    const scope = await this.scope(this.db, ctx, query.company);
    const filters = this.documentFilters(query);
    const paged = query.after
      ? sql` AND (d.document_date, d.id) < (${query.after.date}::date, ${query.after.id}::bigint)`
      : sql``;
    const limit = query.limit === undefined ? sql`` : sql` LIMIT ${query.limit + 1}`;
    const result = await this.db.execute<Row>(sql`
      ${this.documentSelect()}
       WHERE d.company_id = ${scope.companyId} AND d.reverses_document_id IS NULL AND ${filters}${paged}
       ORDER BY d.document_date DESC, d.id DESC${limit}`);
    let total: number | null = null;
    if (query.count) {
      const counted = await this.db.execute<Row>(sql`
        SELECT count(*) AS n FROM fin.documents d
          JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
         WHERE d.company_id = ${scope.companyId} AND d.reverses_document_id IS NULL AND ${filters}`);
      total = int(counted.rows[0]?.n ?? 0);
    }
    return { rows: result.rows.map(toDocumentRow), total };
  }

  /** The live documents of these source keys (a source's own ids), by source doc id. */
  async documentsOfSource(
    ctx: FinCallContext,
    query: { company: string; system: string; docType: string; docIds: readonly string[] },
    executor: FinExecutor = this.db,
  ): Promise<Map<string, FinDocumentRow>> {
    if (query.docIds.length === 0) return new Map();
    const scope = await this.scope(executor, ctx, query.company);
    const result = await executor.execute<Row>(sql`
      ${this.documentSelect()}
       WHERE d.company_id = ${scope.companyId} AND d.reverses_document_id IS NULL
         AND s.code = ${query.system} AND d.source_doc_type = ${query.docType}
         AND d.source_doc_id IN (${sql.join(query.docIds.map((id) => sql`${id}`), sql`, `)})`);
    return new Map(result.rows.map((row) => [str(row.source_doc_id), toDocumentRow(row)]));
  }

  /** Every allocation touching these documents' items (mirror pairings left out), oldest first. */
  async allocationsOf(
    ctx: FinCallContext,
    query: { company: string; documentIds: readonly number[] },
  ): Promise<FinAllocationRow[]> {
    if (query.documentIds.length === 0) return [];
    const scope = await this.scope(this.db, ctx, query.company);
    const ids = sql.join(query.documentIds.map((id) => sql`${id}`), sql`, `);
    const result = await this.db.execute<Row>(sql`
      SELECT al.id, al.amount, al.created_at, u.created_at AS undone_at,
             own.document_id AS own_document_id,
             bd.id AS by_id, bt.code AS by_type, bd.class AS by_class, bd.number AS by_number,
             bd.document_date::text AS by_date,
             other.id AS other_item_id, od.id AS other_document_id, ot.code AS other_type,
             od.number AS other_number, os.code AS other_system, od.source_doc_type AS other_doc_type,
             od.source_doc_id AS other_doc_id, od.document_date::text AS other_date,
             other.due_date::text AS other_due
        FROM fin.allocations al
        JOIN fin.open_items own ON own.company_id = al.company_id
         AND own.id IN (al.debit_item_id, al.credit_item_id) AND own.document_id IN (${ids})
        JOIN fin.open_items other ON other.company_id = al.company_id
         AND other.id IN (al.debit_item_id, al.credit_item_id) AND other.id <> own.id
        JOIN fin.documents od ON od.company_id = other.company_id AND od.id = other.document_id
        JOIN fin.document_types ot ON ot.company_id = od.company_id AND ot.id = od.document_type_id
        JOIN fin.source_systems os ON os.id = od.source_system_id
        JOIN fin.documents bd ON bd.company_id = al.company_id AND bd.id = al.document_id
        JOIN fin.document_types bt ON bt.company_id = bd.company_id AND bt.id = bd.document_type_id
        LEFT JOIN fin.allocations u ON u.company_id = al.company_id AND u.reverses_allocation_id = al.id
       WHERE al.company_id = ${scope.companyId} AND al.mirror = false AND al.reverses_allocation_id IS NULL
       ORDER BY al.id`);
    return result.rows.map((row) => ({
      id: int(row.id),
      amount: dec(row.amount),
      createdAt: date(row.created_at),
      undoneAt: row.undone_at === null ? null : date(row.undone_at),
      ownDocumentId: int(row.own_document_id),
      byDocument: {
        id: int(row.by_id),
        typeCode: str(row.by_type),
        class: str(row.by_class),
        number: str(row.by_number),
        documentDate: str(row.by_date),
      },
      counterpart: {
        itemId: int(row.other_item_id),
        documentId: int(row.other_document_id),
        typeCode: str(row.other_type),
        number: str(row.other_number),
        sourceSystem: str(row.other_system),
        sourceDocType: str(row.other_doc_type),
        sourceDocId: str(row.other_doc_id),
        documentDate: str(row.other_date),
        dueDate: strOrNull(row.other_due),
      },
    }));
  }

  /** A party's items on the receivable accounts (open ones only by default), oldest due first. */
  async openItems(
    ctx: FinCallContext,
    query: { company: string; partyId: number; openOnly?: boolean },
  ): Promise<FinOpenItemRow[]> {
    const scope = await this.scope(this.db, ctx, query.company);
    const open = query.openOnly === false ? sql`` : sql` AND i.open_amount > 0`;
    const result = await this.db.execute<Row>(sql`
      SELECT i.id, i.side, i.item_date::text AS item_date, i.due_date::text AS due_date, i.amount,
             i.open_amount, d.id AS document_id, t.code AS type_code, d.class, d.number,
             s.code AS system, d.source_doc_type, d.source_doc_id
        FROM fin.open_items i
        JOIN fin.accounts a ON a.company_id = i.company_id AND a.id = i.account_id
        JOIN fin.documents d ON d.company_id = i.company_id AND d.id = i.document_id
        JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
        JOIN fin.source_systems s ON s.id = d.source_system_id
       WHERE i.company_id = ${scope.companyId} AND i.party_id = ${query.partyId}
         AND a.control = 'RECEIVABLE'${open}
       ORDER BY coalesce(i.due_date, i.item_date), i.id`);
    return result.rows.map((row) => ({
      id: int(row.id),
      side: str(row.side) === 'DEBIT' ? 'DEBIT' : 'CREDIT',
      itemDate: str(row.item_date),
      dueDate: strOrNull(row.due_date),
      amount: dec(row.amount),
      openAmount: dec(row.open_amount),
      document: {
        id: int(row.document_id),
        typeCode: str(row.type_code),
        class: str(row.class),
        number: str(row.number),
        sourceSystem: str(row.system),
        sourceDocType: str(row.source_doc_type),
        sourceDocId: str(row.source_doc_id),
      },
    }));
  }

  /** The source and the open amount of these items (a posting's touched items), in the caller's tx. */
  async itemsInTx(
    tx: FinTx,
    ctx: FinCallContext,
    query: { company: string; ids: readonly number[] },
  ): Promise<FinItemSource[]> {
    if (query.ids.length === 0) return [];
    const scope = await this.scope(tx, ctx, query.company);
    const result = await tx.execute<Row>(sql`
      SELECT i.id, i.document_id, s.code AS system, d.source_doc_type, d.source_doc_id, i.open_amount
        FROM fin.open_items i
        JOIN fin.documents d ON d.company_id = i.company_id AND d.id = i.document_id
        JOIN fin.source_systems s ON s.id = d.source_system_id
       WHERE i.company_id = ${scope.companyId}
         AND i.id IN (${sql.join(query.ids.map((id) => sql`${id}`), sql`, `)})`);
    return result.rows.map((row) => ({
      id: int(row.id),
      documentId: int(row.document_id),
      sourceSystem: str(row.system),
      sourceDocType: str(row.source_doc_type),
      sourceDocId: str(row.source_doc_id),
      openAmount: dec(row.open_amount),
    }));
  }

  /**
   * A money account's live vouchers (neither reversed nor a reversal) newest first, with the
   * balance after each (receipts in, payments out); the balance before `from`.
   */
  async moneyBook(
    ctx: FinCallContext,
    query: {
      company: string;
      moneyAccountId: number;
      typeCodes: readonly string[];
      from?: string;
      to?: string;
      after?: { date: string; id: number };
      limit: number;
    },
  ): Promise<{ rows: (FinDocumentRow & { balanceAfter: Decimal })[]; opening: Decimal }> {
    const scope = await this.scope(this.db, ctx, query.company);
    const live = this.liveVoucherSql(scope.companyId, query.moneyAccountId, query.typeCodes);
    const filters: SQL[] = [sql`TRUE`];
    if (query.from) filters.push(sql`r.document_date >= ${query.from}::date`);
    if (query.to) filters.push(sql`r.document_date <= ${query.to}::date`);
    if (query.after) {
      filters.push(sql`(r.document_date, r.id) < (${query.after.date}::date, ${query.after.id}::bigint)`);
    }
    const running = await this.db.execute<Row>(sql`
      WITH r AS (SELECT d.id, d.document_date,
                        sum(CASE d.class WHEN 'RECEIPT' THEN d.amount ELSE -d.amount END)
                          OVER (ORDER BY d.document_date, d.id) AS balance_after
                   FROM fin.documents d ${live})
      SELECT r.id, r.balance_after FROM r WHERE ${sql.join(filters, sql` AND `)}
       ORDER BY r.document_date DESC, r.id DESC LIMIT ${query.limit + 1}`);
    const ids = running.rows.map((row) => int(row.id));
    const docs = ids.length
      ? await this.documents(ctx, { company: query.company, typeCodes: query.typeCodes, ids })
      : { rows: [] };
    const byId = new Map(docs.rows.map((row) => [row.id, row]));
    const rows = running.rows.flatMap((row) => {
      const doc = byId.get(int(row.id));
      return doc ? [{ ...doc, balanceAfter: dec(row.balance_after) }] : [];
    });
    let opening = new Decimal(0);
    if (query.from) {
      const before = await this.db.execute<Row>(sql`
        SELECT coalesce(sum(CASE d.class WHEN 'RECEIPT' THEN d.amount ELSE -d.amount END), 0) AS balance
          FROM fin.documents d ${live} AND d.document_date < ${query.from}::date`);
      opening = dec(before.rows[0]?.balance ?? 0);
    }
    return { rows, opening };
  }

  /** Σ in − Σ out of every money account's live vouchers, by money account id. */
  async moneyBalances(
    ctx: FinCallContext,
    query: { company: string; typeCodes: readonly string[] },
    executor: FinExecutor = this.db,
  ): Promise<Map<number, Decimal>> {
    const scope = await this.scope(executor, ctx, query.company);
    const types = sql.join(query.typeCodes.map((code) => sql`${code}`), sql`, `);
    const result = await executor.execute<Row>(sql`
      SELECT d.money_account_id, sum(CASE d.class WHEN 'RECEIPT' THEN d.amount ELSE -d.amount END) AS balance
        FROM fin.documents d
        JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
       WHERE d.company_id = ${scope.companyId} AND d.reverses_document_id IS NULL
         AND d.money_account_id IS NOT NULL AND t.code IN (${types})
         AND NOT EXISTS (SELECT 1 FROM fin.documents r WHERE r.company_id = d.company_id AND r.reverses_document_id = d.id)
       GROUP BY d.money_account_id`);
    return new Map(result.rows.map((row) => [int(row.money_account_id), dec(row.balance)]));
  }

  // ---------------------------------------------------------------------------------------------

  private scope(executor: FinExecutor, ctx: FinCallContext, company: string): Promise<CompanyScope> {
    return resolveCompany(executor, ctx, company, { source: true, userAnyOf: ['finance.read'] });
  }

  private async today(executor: FinExecutor, scope: CompanyScope): Promise<string> {
    const result = await executor.execute<Row>(sql`SELECT timezone FROM fin.companies WHERE id = ${scope.companyId}`);
    return businessDateIn(str(result.rows[0]?.timezone ?? 'Asia/Ulaanbaatar'), new Date());
  }

  private async partyOfKey(executor: FinExecutor, scope: CompanyScope, key: FinPartyKey): Promise<number | null> {
    const result = await executor.execute<Row>(sql`
      SELECT r.party_id FROM fin.party_refs r
        JOIN fin.source_systems s ON s.id = r.source_system_id AND s.tenant_id = r.tenant_id
        JOIN fin.party_companies pc ON pc.party_id = r.party_id AND pc.company_id = ${scope.companyId}
       WHERE r.tenant_id = ${scope.tenantId} AND s.code = ${key.system} AND r.external_id = ${key.ref}`);
    const row = result.rows[0];
    return row ? int(row.party_id) : null;
  }

  private async exposureOf(executor: FinExecutor, scope: CompanyScope, partyId: number): Promise<ExposureV1> {
    const today = await this.today(executor, scope);
    const result = await executor.execute<Row>(sql`
      SELECT coalesce(sum(i.open_amount) FILTER (WHERE i.side = 'DEBIT'), 0) AS receivable,
             coalesce(sum(i.open_amount) FILTER (WHERE i.side = 'CREDIT'), 0) AS credits,
             coalesce(sum(i.open_amount) FILTER (WHERE i.side = 'DEBIT' AND i.due_date < ${today}::date), 0) AS overdue,
             min(i.due_date) FILTER (WHERE i.side = 'DEBIT' AND i.due_date < ${today}::date)::text AS oldest
        FROM fin.open_items i
        JOIN fin.accounts a ON a.company_id = i.company_id AND a.id = i.account_id
       WHERE i.company_id = ${scope.companyId} AND i.party_id = ${partyId}
         AND a.control = 'RECEIVABLE' AND i.open_amount > 0`);
    const row = result.rows[0] ?? {};
    const receivable = dec(row.receivable);
    const credits = dec(row.credits);
    return {
      receivableOpen: receivable.toFixed(2),
      creditsOpen: credits.toFixed(2),
      net: receivable.minus(credits).toFixed(2),
      overdue: dec(row.overdue).toFixed(2),
      oldestDueDate: strOrNull(row.oldest),
    };
  }

  private partyLinesSql(companyId: number, partyId: number, order: SQL): SQL {
    return sql`
      SELECT l.id AS line_id, e.id AS entry_id, e.entry_date::text AS entry_date, l.debit, l.credit,
             e.posted_at,
             sum(l.debit - l.credit) OVER (ORDER BY ${order}) AS balance_after,
             d.id AS doc_id, t.code AS doc_type_code, d.class AS doc_class, d.number AS doc_number,
             s.code AS doc_system, d.source_doc_type AS doc_source_type, d.source_doc_id AS doc_source_id,
             o.id AS rev_id, ot.code AS rev_type_code, o.number AS rev_number, os.code AS rev_system,
             o.source_doc_type AS rev_source_type, o.source_doc_id AS rev_source_id
        FROM fin.journal_lines l
        JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
        LEFT JOIN fin.documents d ON d.company_id = e.company_id AND d.id = e.document_id
        LEFT JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
        LEFT JOIN fin.source_systems s ON s.id = d.source_system_id
        LEFT JOIN fin.documents o ON o.company_id = d.company_id AND o.id = d.reverses_document_id
        LEFT JOIN fin.document_types ot ON ot.company_id = o.company_id AND ot.id = o.document_type_id
        LEFT JOIN fin.source_systems os ON os.id = o.source_system_id
       WHERE l.company_id = ${companyId} AND l.party_id = ${partyId} AND a.control = 'RECEIVABLE'`;
  }

  private async partyBalanceBefore(companyId: number, partyId: number, from: string): Promise<Decimal> {
    const result = await this.db.execute<Row>(sql`
      SELECT coalesce(sum(l.debit - l.credit), 0) AS balance
        FROM fin.journal_lines l
        JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
        JOIN fin.journal_entries e ON e.company_id = l.company_id AND e.id = l.entry_id
       WHERE l.company_id = ${companyId} AND l.party_id = ${partyId} AND a.control = 'RECEIVABLE'
         AND e.entry_date < ${from}::date`);
    return dec(result.rows[0]?.balance ?? 0);
  }

  private documentFilters(query: {
    typeCodes: readonly string[];
    ids?: readonly number[];
    partyIds?: readonly number[];
    moneyAccountId?: number;
    reversed?: boolean;
    classes?: readonly string[];
    from?: string;
    to?: string;
    text?: { pattern: string; partyIds: readonly number[] };
  }): SQL {
    const list = (values: readonly (string | number)[]) => sql.join(values.map((value) => sql`${value}`), sql`, `);
    const filters: SQL[] = [query.typeCodes.length ? sql`t.code IN (${list(query.typeCodes)})` : sql`FALSE`];
    if (query.ids) filters.push(query.ids.length ? sql`d.id IN (${list(query.ids)})` : sql`FALSE`);
    if (query.partyIds) filters.push(query.partyIds.length ? sql`d.party_id IN (${list(query.partyIds)})` : sql`FALSE`);
    if (query.moneyAccountId !== undefined) filters.push(sql`d.money_account_id = ${query.moneyAccountId}`);
    if (query.classes) filters.push(query.classes.length ? sql`d.class IN (${list(query.classes)})` : sql`FALSE`);
    if (query.from) filters.push(sql`d.document_date >= ${query.from}::date`);
    if (query.to) filters.push(sql`d.document_date <= ${query.to}::date`);
    const reversedSql = sql`EXISTS (SELECT 1 FROM fin.documents rv WHERE rv.company_id = d.company_id AND rv.reverses_document_id = d.id)`;
    if (query.reversed === true) filters.push(reversedSql);
    if (query.reversed === false) filters.push(sql`NOT ${reversedSql}`);
    if (query.text) {
      const pattern = query.text.pattern;
      const parts: SQL[] = [
        sql`d.number ILIKE ${pattern}`,
        sql`d.description ILIKE ${pattern}`,
        sql`EXISTS (SELECT 1 FROM jsonb_each_text(d.attributes) att WHERE att.value ILIKE ${pattern})`,
      ];
      if (query.text.partyIds.length) parts.push(sql`d.party_id IN (${list(query.text.partyIds)})`);
      filters.push(sql`(${sql.join(parts, sql` OR `)})`);
    }
    return sql.join(filters, sql` AND `);
  }

  private documentSelect(): SQL {
    return sql`
      SELECT d.id, t.code AS type_code, d.class, d.number, d.document_date::text AS document_date,
             d.accounting_date::text AS accounting_date, d.party_id, d.amount, d.description,
             d.attributes, d.money_account_id, s.code AS source_system, d.source_doc_type,
             d.source_doc_id, d.actor_ref, d.actor_label, d.posted_at,
             e.id AS entry_id, e.number AS journal_no,
             (SELECT l.account_id FROM fin.journal_lines l
               WHERE l.company_id = e.company_id AND l.entry_id = e.id
                 AND l.money_account_id IS NULL AND l.party_id IS NULL
               ORDER BY l.line_no LIMIT 1) AS counter_account_id,
             (SELECT coalesce(sum(al.amount), 0) FROM fin.allocations al
                JOIN fin.open_items i ON i.company_id = al.company_id
                 AND i.id IN (al.debit_item_id, al.credit_item_id) AND i.document_id = d.id
               WHERE al.company_id = d.company_id AND al.mirror = false
                 AND al.reverses_allocation_id IS NULL
                 AND NOT EXISTS (SELECT 1 FROM fin.allocations u
                                  WHERE u.company_id = al.company_id AND u.reverses_allocation_id = al.id)) AS settled,
             r.id AS rev_id, r.posted_at AS rev_posted_at, r.actor_ref AS rev_actor_ref,
             r.actor_label AS rev_actor_label, r.reverse_reason AS rev_reason, re.id AS rev_entry_id
        FROM fin.documents d
        JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
        JOIN fin.source_systems s ON s.id = d.source_system_id
        LEFT JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
        LEFT JOIN fin.documents r ON r.company_id = d.company_id AND r.reverses_document_id = d.id
        LEFT JOIN fin.journal_entries re ON re.company_id = r.company_id AND re.document_id = r.id`;
  }

  private liveVoucherSql(companyId: number, moneyAccountId: number, typeCodes: readonly string[]): SQL {
    const types = sql.join(typeCodes.map((code) => sql`${code}`), sql`, `);
    return sql`
      JOIN fin.document_types t ON t.company_id = d.company_id AND t.id = d.document_type_id
     WHERE d.company_id = ${companyId} AND d.money_account_id = ${moneyAccountId}
       AND d.reverses_document_id IS NULL AND t.code IN (${types})
       AND NOT EXISTS (SELECT 1 FROM fin.documents rv WHERE rv.company_id = d.company_id AND rv.reverses_document_id = d.id)`;
  }
}

function zeroExposure(): ExposureV1 {
  return { receivableOpen: '0.00', creditsOpen: '0.00', net: '0.00', overdue: '0.00', oldestDueDate: null };
}

function toDocumentRow(row: Row): FinDocumentRow {
  const attributes =
    row.attributes && typeof row.attributes === 'object'
      ? Object.fromEntries(Object.entries(row.attributes as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : {};
  return {
    id: int(row.id),
    typeCode: str(row.type_code),
    class: str(row.class),
    number: str(row.number),
    documentDate: str(row.document_date),
    accountingDate: str(row.accounting_date),
    partyId: intOrNull(row.party_id),
    amount: dec(row.amount),
    description: str(row.description),
    attributes,
    moneyAccountId: intOrNull(row.money_account_id),
    counterAccountId: intOrNull(row.counter_account_id),
    sourceSystem: str(row.source_system),
    sourceDocType: str(row.source_doc_type),
    sourceDocId: str(row.source_doc_id),
    actorRef: str(row.actor_ref),
    actorLabel: str(row.actor_label),
    postedAt: date(row.posted_at),
    entryId: intOrNull(row.entry_id),
    journalNo: strOrNull(row.journal_no),
    settled: dec(row.settled),
    reversal:
      row.rev_id === null || row.rev_id === undefined
        ? null
        : {
            id: int(row.rev_id),
            postedAt: date(row.rev_posted_at),
            actorRef: str(row.rev_actor_ref),
            actorLabel: str(row.rev_actor_label),
            reason: str(row.rev_reason),
            entryId: intOrNull(row.rev_entry_id),
          },
  };
}

function toLedgerRow(row: Row): FinPartyLedgerRow {
  return {
    lineId: int(row.line_id),
    entryId: int(row.entry_id),
    entryDate: str(row.entry_date),
    debit: dec(row.debit),
    credit: dec(row.credit),
    balanceAfter: dec(row.balance_after),
    postedAt: date(row.posted_at),
    document:
      row.doc_id === null || row.doc_id === undefined
        ? null
        : {
            id: int(row.doc_id),
            typeCode: str(row.doc_type_code),
            class: str(row.doc_class),
            number: str(row.doc_number),
            sourceSystem: str(row.doc_system),
            sourceDocType: str(row.doc_source_type),
            sourceDocId: str(row.doc_source_id),
          },
    reverses:
      row.rev_id === null || row.rev_id === undefined
        ? null
        : {
            id: int(row.rev_id),
            typeCode: str(row.rev_type_code),
            number: str(row.rev_number),
            sourceSystem: str(row.rev_system),
            sourceDocType: str(row.rev_source_type),
            sourceDocId: str(row.rev_source_id),
          },
  };
}
