import { Inject, Injectable } from '@nestjs/common';
import {
  ERKHET_LEDGER_LIMITS,
  type ErkhetOwnDocumentBlocker,
  type ErkhetLedgerFailure,
  type ErkhetLedgerRefusal,
  type ErkhetLedgerRunKind,
  type ErkhetLedgerSide,
  type ErkhetLedgerState,
  type ErkhetOwnDocumentChoice,
  type ErkhetRunStatus,
  parseErkhetTrKey,
} from '@tugeel/shared/erkhet';
import { Decimal } from '@tugeel/shared/money';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { JobsService } from '../../../common/jobs/jobs.service';
import { DEFAULT_PAGE_LIMIT, decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { FinErkhetBooks, type OwnDocument } from '../../fin-bridge';
import { ArLedgerService, JournalService, PaymentsService } from '../../finance';
import {
  type Actor,
  actorUserId,
  AuditService,
  type AuthContext,
  UserNamesService,
} from '../../identity';
import { CustomersService, SuppliersService } from '../../partners';
import {
  type ErkhetLedgerSummary,
  type ErkhetRunTrigger,
  erkhetLedgerOpenings,
  erkhetLedgerRuns,
  erkhetLedgerSettings,
  erkhetLedgerTrs,
  erkhetSettings,
} from '../schema';
import { ErkhetSettingsFlowService } from './erkhet-settings-flow.service';

type RunRow = typeof erkhetLedgerRuns.$inferSelect;
export type LedgerSettingsRow = typeof erkhetLedgerSettings.$inferSelect;

export interface ErkhetLedgerRun {
  id: number;
  kind: ErkhetLedgerRunKind;
  status: ErkhetRunStatus;
  trigger: ErkhetRunTrigger;
  startedBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  failure: ErkhetLedgerFailure | null;
  failureDetail: Record<string, string> | null;
  ownChoice: ErkhetOwnDocumentChoice | null;
  ownReversed: number;
  summary: ErkhetLedgerSummary | null;
}

export interface ErkhetLedgerOverview {
  /** A complete sign-in is saved. */
  configured: boolean;
  receivableAccount: string;
  payableAccount: string;
  startDate: string;
  /** «Bto-д оруулах» ran: the night's run keeps the books up with Erkhet. */
  posting: boolean;
  /** The night's switch of «Эрхэт тулгалт»; the copy follows it. */
  nightly: boolean;
  active: ErkhetLedgerRun | null;
  /** The latest finished run: its totals are what the page shows. */
  latest: ErkhetLedgerRun | null;
  /** The latest run, when it failed after `latest`. */
  failed: ErkhetLedgerRun | null;
  /** A check is fresh enough for the first «Bto-д оруулах». */
  checked: boolean;
  /** Copies standing in the books, and those a person has to look at. */
  posted: number;
  blocked: number;
}

/** One of Bto's own documents with what keeps it from being reversed from this page, if anything. */
export interface ErkhetOwnDocument extends OwnDocument {
  blocker: ErkhetOwnDocumentBlocker | null;
}

export interface LedgerStartInput {
  kind: ErkhetLedgerRunKind;
  /** What to do with Bto's own documents on the copied accounts (a post only). */
  ownDocuments?: ErkhetOwnDocumentChoice;
  /** The reason written on each reversal of them, in the person's words. */
  reason?: string;
}

export type LedgerStart =
  | { started: true; refusal: null; run: ErkhetLedgerRun }
  | { started: false; refusal: ErkhetLedgerRefusal; run: null };

/** A party of the copied accounts as Erkhet shows it, with what the books hold of it. */
export interface ErkhetLedgerParty {
  account: string;
  side: ErkhetLedgerSide;
  code: string;
  name: string;
  /** The customer (receivables) or supplier (payables) of that code in Bto; null: not in Bto. */
  btoId: number | null;
  lines: number;
  opening: Decimal;
  debit: Decimal;
  credit: Decimal;
  closing: Decimal;
}

export interface LedgerPartiesQuery {
  account?: string;
  /** Only parties Bto does not have. */
  unmatched?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

const ACTIVE: ErkhetRunStatus[] = ['QUEUED', 'RUNNING'];
const MAX_REASON = 300;

/**
 * «Авлага, өглөгийн гүйлгээ» (ADR-0219) in the api: the copy's settings, starting a run and
 * reading what the last one found. The work itself is the worker's (`ErkhetLedgerFlowService`).
 * Nothing here reaches Erkhet.
 */
@Injectable()
export class ErkhetLedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly signIn: ErkhetSettingsFlowService,
    private readonly names: UserNamesService,
    private readonly audit: AuditService,
    private readonly books: FinErkhetBooks,
    private readonly payments: PaymentsService,
    private readonly journal: JournalService,
    private readonly receivables: ArLedgerService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
  ) {}

  /** The settings row, made with its defaults when it is first read. */
  async settings(executor: Db | Tx = this.db): Promise<LedgerSettingsRow> {
    await executor.insert(erkhetLedgerSettings).values({ id: 1 }).onConflictDoNothing();
    const [row] = await executor
      .select()
      .from(erkhetLedgerSettings)
      .where(eq(erkhetLedgerSettings.id, 1));
    if (!row) throw new Error('erkhet_ledger_settings has no row');
    return row;
  }

  /**
   * Changes which accounts are copied and from which day. The next run follows: copies of an
   * account no longer named are reversed, and another start date reads the opening balances again.
   */
  async updateSettings(
    ctx: AuthContext,
    input: { receivableAccount?: string; payableAccount?: string; startDate?: string },
  ): Promise<LedgerSettingsRow> {
    if (input.startDate !== undefined) {
      if (!isIsoDate(input.startDate) || input.startDate > businessDate()) {
        throw invalid('startDate', 'date', 'a day up to today');
      }
    }
    return inTransaction(this.db, async (tx) => {
      const before = await this.settings(tx);
      const next = {
        receivableAccount: input.receivableAccount ?? before.receivableAccount,
        payableAccount: input.payableAccount ?? before.payableAccount,
        startDate: input.startDate ?? before.startDate,
      };
      if (next.receivableAccount === next.payableAccount) {
        throw invalid('payableAccount', 'distinct', 'the two accounts must differ');
      }
      const [row] = await tx
        .update(erkhetLedgerSettings)
        .set({ ...next, updatedBy: ctx.userId, updatedAt: sql`now()` })
        .where(eq(erkhetLedgerSettings.id, 1))
        .returning();
      if (!row) throw new Error('erkhet_ledger_settings was not updated');
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'erkhet_ledger_settings',
        entityId: 1,
        before: {
          receivableAccount: before.receivableAccount,
          payableAccount: before.payableAccount,
          startDate: before.startDate,
        },
        after: next,
      });
      return row;
    });
  }

  async overview(): Promise<ErkhetLedgerOverview> {
    const saved = await this.signIn.saved();
    const settings = await this.settings();
    const [newest] = await this.db
      .select()
      .from(erkhetLedgerRuns)
      .orderBy(desc(erkhetLedgerRuns.id))
      .limit(1);
    const [done] = await this.db
      .select()
      .from(erkhetLedgerRuns)
      .where(eq(erkhetLedgerRuns.status, 'DONE'))
      .orderBy(desc(erkhetLedgerRuns.id))
      .limit(1);
    const rows = [newest, done].filter((row): row is RunRow => row !== undefined);
    const views = new Map((await this.views(rows)).map((run) => [run.id, run]));
    const view = (row: RunRow | undefined) => (row ? (views.get(row.id) ?? null) : null);
    const stale = newest ? isInterrupted(newest) : false;
    const [nightly] = await this.db
      .select({ nightly: erkhetSettings.nightly })
      .from(erkhetSettings)
      .where(eq(erkhetSettings.id, 1));
    const counts = await this.copyCounts();
    return {
      configured: saved.account !== null,
      receivableAccount: settings.receivableAccount,
      payableAccount: settings.payableAccount,
      startDate: settings.startDate,
      posting: settings.posting,
      nightly: nightly?.nightly ?? true,
      active: newest && ACTIVE.includes(newest.status) && !stale ? view(newest) : null,
      latest: view(done),
      failed:
        newest && (newest.status === 'FAILED' || stale) && (!done || newest.id > done.id)
          ? {
              ...(view(newest) as ErkhetLedgerRun),
              ...(stale ? { status: 'FAILED' as const, failure: 'INTERRUPTED' as const } : {}),
            }
          : null,
      checked: (await this.freshCheck()) !== null,
      posted: counts.posted,
      blocked: counts.blocked,
    };
  }

  /**
   * Starts a run. A refusal is an answer, not an error: the page says what is missing.
   * - `CHECK` downloads and shows.
   * - `POST` posts what the latest check holds; once posting is on it downloads first, as the
   *   night's run does. Bto's own documents on the copied accounts need an explicit choice: they
   *   are reversed here, as the person, in the transaction that queues the run, or kept.
   * - `REVERT` reverses every copy.
   */
  async start(ctx: AuthContext, input: LedgerStartInput): Promise<LedgerStart> {
    const refuse = (refusal: ErkhetLedgerRefusal): LedgerStart => ({
      started: false,
      refusal,
      run: null,
    });
    const saved = await this.signIn.saved();
    if (saved.account === null) return refuse('NOT_CONFIGURED');
    const settings = await this.settings();
    let download = true;
    let own: ErkhetOwnDocument[] = [];
    if (input.kind === 'POST') {
      download = settings.posting;
      if (!download && (await this.freshCheck()) === null) return refuse('NOT_CHECKED');
      const found = await this.ownDocuments();
      own = found.all;
      if (own.length > 0) {
        if (input.ownDocuments === undefined) return refuse('CHOICE_REQUIRED');
        if (
          input.ownDocuments === 'REVERSE' &&
          (found.truncated || own.some((document) => document.blocker !== null))
        ) {
          return refuse('NOT_REVERSIBLE');
        }
      }
    }
    if (input.kind === 'REVERT' && (await this.copyCounts()).posted === 0) {
      return refuse('NOTHING_POSTED');
    }
    const reverse = input.kind === 'POST' && input.ownDocuments === 'REVERSE' ? own : [];
    const reason = (input.reason ?? '').trim();
    if (reverse.length > 0 && (reason.length === 0 || reason.length > MAX_REASON)) {
      throw invalid('reason', 'length', `1 to ${MAX_REASON} characters`);
    }
    try {
      const row = await inTransaction(this.db, async (tx) => {
        await this.closeInterrupted(tx);
        const [created] = await tx
          .insert(erkhetLedgerRuns)
          .values({
            kind: input.kind,
            trigger: 'MANUAL',
            businessDay: businessDate(),
            activeSlot: 1,
            download: input.kind === 'CHECK' ? true : input.kind === 'POST' ? download : false,
            ownChoice: own.length > 0 ? (input.ownDocuments ?? null) : null,
            ownReversed: reverse.length,
            startedBy: ctx.userId,
          })
          .returning();
        if (!created) throw new Error('run insert returned no row');
        // Each through its own service, so the voucher or the entry is reversed and audited as any
        // reversal by hand is, with this person's rights.
        for (const document of reverse) {
          if (document.kind === 'VOUCHER' && document.documentId !== null) {
            await this.payments.voidInTx(tx, ctx, document.documentId, reason);
          } else {
            await this.journal.reverseManualInTx(tx, ctx, document.entryId, {
              description: reason,
            });
          }
        }
        if (input.kind !== 'CHECK') {
          await this.audit.record(tx, ctx, {
            action: input.kind === 'POST' ? 'POST' : 'REVERT',
            entity: 'erkhet_ledger_runs',
            entityId: created.id,
            after: {
              kind: input.kind,
              ownDocuments: own.length,
              ownChoice: created.ownChoice,
              ownReversed: reverse.map((document) => document.number),
            },
          });
        }
        await this.enqueue(tx, created.id);
        return created;
      });
      return { started: true, refusal: null, run: (await this.views([row]))[0] as ErkhetLedgerRun };
    } catch (error: unknown) {
      if (isOneActive(error)) return refuse('RUNNING');
      throw error;
    }
  }

  /**
   * The night's run: a download, and a post once «Bto-д оруулах» ran (before that the night posts
   * nothing). Once a day, only with a complete sign-in and the night's switch on.
   */
  async startNightly(actor: Actor): Promise<{ started: boolean; reason?: string; runId?: number }> {
    const saved = await this.signIn.saved();
    if (saved.account === null) return { started: false, reason: saved.failure };
    const [switched] = await this.db
      .select({ nightly: erkhetSettings.nightly })
      .from(erkhetSettings)
      .where(eq(erkhetSettings.id, 1));
    if (switched && !switched.nightly) return { started: false, reason: 'SWITCHED_OFF' };
    const settings = await this.settings();
    if (!settings.posting) return { started: false, reason: 'NOT_POSTED_YET' };
    try {
      const row = await inTransaction(this.db, async (tx) => {
        await this.closeInterrupted(tx);
        const [created] = await tx
          .insert(erkhetLedgerRuns)
          .values({
            kind: 'POST',
            trigger: 'NIGHTLY',
            businessDay: businessDate(),
            activeSlot: 1,
            download: true,
            startedBy: actorUserId(actor),
          })
          .returning();
        if (!created) throw new Error('run insert returned no row');
        await this.enqueue(tx, created.id);
        return created;
      });
      return { started: true, runId: row.id };
    } catch (error: unknown) {
      if (isOneActive(error)) return { started: false, reason: 'RUNNING' };
      const database = databaseErrorOf(error);
      if (database?.code === '23505' && database.constraint === 'erkhet_ledger_runs_nightly_day') {
        return { started: false, reason: 'ALREADY_TODAY' };
      }
      throw error;
    }
  }

  /**
   * Bto's own documents on the copied accounts, as the books hold them now, each with what keeps
   * it from being reversed here: its kind (only a voucher and a manual entry have a reversal this
   * page can call), or a bank statement line that holds it.
   */
  async ownDocuments(): Promise<{
    data: ErkhetOwnDocument[];
    all: ErkhetOwnDocument[];
    total: Decimal;
    truncated: boolean;
  }> {
    const found = await this.books.ownDocuments();
    const held = await this.receivables.heldByBankStatement(
      found.documents.flatMap((document) =>
        document.kind === 'VOUCHER' && document.documentId !== null ? [document.documentId] : [],
      ),
      found.documents.flatMap((document) =>
        document.kind === 'JOURNAL' ? [document.entryId] : [],
      ),
    );
    const blockerOf = (document: OwnDocument): ErkhetOwnDocument['blocker'] => {
      if (document.kind === 'OTHER') return 'KIND';
      if (document.kind === 'VOUCHER') {
        if (document.documentId === null) return 'KIND';
        return held.payments.has(document.documentId) ? 'BANK_STATEMENT' : null;
      }
      return held.journalEntries.has(document.entryId) ? 'BANK_STATEMENT' : null;
    };
    const all = found.documents.map((document) => ({ ...document, blocker: blockerOf(document) }));
    return {
      data: all.slice(0, ERKHET_LEDGER_LIMITS.maxListed),
      all,
      total: all.reduce((sum, document) => sum.plus(document.amount), new Decimal(0)),
      truncated: found.truncated || all.length > ERKHET_LEDGER_LIMITS.maxListed,
    };
  }

  /**
   * The parties of the copied accounts as Erkhet shows them: the opening balance, the turnover
   * since the start date and the balance now, to hold against Erkhet's own report; by account and
   * code.
   */
  async parties(
    query: LedgerPartiesQuery,
  ): Promise<{ data: ErkhetLedgerParty[]; nextCursor: string | null }> {
    const settings = await this.settings();
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const accounts = [settings.receivableAccount, settings.payableAccount].filter(
      (account) => query.account === undefined || query.account === account,
    );
    if (accounts.length === 0) return { data: [], nextCursor: null };
    const after = decodeCursor(query.cursor);
    const q = query.q?.trim();
    const sideOf = (account: string): ErkhetLedgerSide =>
      account === settings.receivableAccount ? 'RECEIVABLE' : 'PAYABLE';
    const rows = (await this.partyRows(accounts)).map((row) => ({
      ...row,
      side: sideOf(row.account),
    }));
    const known = await this.knownParties(rows);
    const data = rows
      .map((row): ErkhetLedgerParty => ({
        ...row,
        btoId: known[row.side].get(row.code) ?? null,
        closing: row.opening.plus(row.debit).minus(row.credit),
      }))
      .filter((row) => !query.unmatched || row.btoId === null)
      .filter(
        (row) =>
          !q ||
          row.code.includes(q) ||
          row.name.toLocaleLowerCase('mn').includes(q.toLocaleLowerCase('mn')),
      )
      .filter(
        (row) =>
          typeof after?.account !== 'string' ||
          typeof after.code !== 'string' ||
          row.account > after.account ||
          (row.account === after.account && row.code > after.code),
      );
    const page = data.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page,
      nextCursor:
        data.length > limit && last
          ? encodeCursor({ account: last.account, code: last.code })
          : null,
    };
  }

  /**
   * The address that opens each copied transaction in Erkhet: its own page once the run has asked
   * Erkhet for it, until then the journal list of that day and account. Unknown keys are left out.
   */
  async links(keys: readonly string[]): Promise<{ key: string; url: string; exact: boolean }[]> {
    const parsed = [...new Set(keys)].slice(0, ERKHET_LEDGER_LIMITS.maxLinkKeys).flatMap((key) => {
      const one = parseErkhetTrKey(key);
      return one ? [{ key, ...one }] : [];
    });
    if (parsed.length === 0) return [];
    const [signIn] = await this.db
      .select({ baseUrl: erkhetSettings.baseUrl, companyId: erkhetSettings.companyId })
      .from(erkhetSettings)
      .where(eq(erkhetSettings.id, 1));
    if (!signIn?.baseUrl || !signIn.companyId) return [];
    const settings = await this.settings();
    const rows = await this.db
      .select({
        account: erkhetLedgerTrs.account,
        trId: erkhetLedgerTrs.trId,
        trDate: erkhetLedgerTrs.trDate,
        updatePath: erkhetLedgerTrs.updatePath,
      })
      .from(erkhetLedgerTrs)
      .where(
        inArray(
          erkhetLedgerTrs.trId,
          parsed.map((one) => Number.parseInt(one.trId, 10)),
        ),
      );
    const byKey = new Map(rows.map((row) => [`${row.account}:${row.trId}`, row]));
    const accountId = (account: string): string | null =>
      account === settings.receivableAccount
        ? settings.receivableAccountId
        : account === settings.payableAccount
          ? settings.payableAccountId
          : null;
    return parsed.flatMap((one): { key: string; url: string; exact: boolean }[] => {
      const row = byKey.get(one.key);
      if (!row) return [];
      if (row.updatePath) {
        return [{ key: one.key, url: `${signIn.baseUrl}${row.updatePath}`, exact: true }];
      }
      const id = accountId(row.account);
      if (id === null) return [];
      const params = new URLSearchParams({ date1: row.trDate, date2: row.trDate, account: id });
      return [
        {
          key: one.key,
          url: `${signIn.baseUrl}/${signIn.companyId}/transactions/?${params.toString()}`,
          exact: false,
        },
      ];
    });
  }

  /** The latest finished check a first post may use: fresh, and not followed by a revert. */
  async freshCheck(executor: Db | Tx = this.db): Promise<RunRow | null> {
    const [row] = await executor
      .select()
      .from(erkhetLedgerRuns)
      .where(
        and(
          eq(erkhetLedgerRuns.status, 'DONE'),
          sql`${erkhetLedgerRuns.finishedAt} > now() - make_interval(hours => ${ERKHET_LEDGER_LIMITS.checkFreshHours})`,
        ),
      )
      .orderBy(desc(erkhetLedgerRuns.id))
      .limit(1);
    return row && row.kind === 'CHECK' ? row : null;
  }

  /** Erkhet's totals per party over what the last download holds. */
  private async partyRows(accounts: readonly string[]): Promise<
    {
      account: string;
      code: string;
      name: string;
      lines: number;
      opening: Decimal;
      debit: Decimal;
      credit: Decimal;
    }[]
  > {
    const list = sql.join(
      accounts.map((account) => sql`${account}`),
      sql`, `,
    );
    const result = await this.db.execute<{
      account: string;
      code: string;
      name: string;
      lines: string;
      opening: string;
      debit: string;
      credit: string;
    }>(sql`
      WITH moved AS (
        SELECT t.account, l.party_code AS code, max(l.party_name) AS name, count(*) AS lines,
               sum(l.debit) AS debit, sum(l.credit) AS credit
          FROM erkhet_ledger_lines l
          JOIN erkhet_ledger_trs t ON t.id = l.tr_row_id
         WHERE NOT t.gone AND t.account IN (${list})
         GROUP BY t.account, l.party_code),
      opened AS (
        SELECT o.account, o.party_code AS code, o.party_name AS name, o.debit - o.credit AS opening
          FROM erkhet_ledger_openings o
         WHERE NOT o.gone AND o.account IN (${list}))
      SELECT coalesce(m.account, o.account) AS account, coalesce(m.code, o.code) AS code,
             coalesce(nullif(m.name, ''), o.name, '') AS name, coalesce(m.lines, 0)::text AS lines,
             coalesce(o.opening, 0)::text AS opening, coalesce(m.debit, 0)::text AS debit,
             coalesce(m.credit, 0)::text AS credit
        FROM moved m
        FULL JOIN opened o ON o.account = m.account AND o.code = m.code
       ORDER BY 1, 2`);
    return result.rows.map((row) => ({
      account: row.account,
      code: row.code,
      name: row.name,
      lines: Number.parseInt(row.lines, 10),
      opening: new Decimal(row.opening),
      debit: new Decimal(row.debit),
      credit: new Decimal(row.credit),
    }));
  }

  /** Bto's customers (receivables) and suppliers (payables) of these party codes, by code. */
  async knownParties(
    rows: readonly { side: ErkhetLedgerSide; code: string }[],
    executor: Db | Tx = this.db,
  ): Promise<Record<ErkhetLedgerSide, Map<string, number>>> {
    const codes = (side: ErkhetLedgerSide) => [
      ...new Set(rows.filter((row) => row.side === side && row.code).map((row) => row.code)),
    ];
    const customers = await this.customers.findByCodes(codes('RECEIVABLE'), executor);
    const suppliers = await this.suppliers.findByCodes(codes('PAYABLE'), executor);
    return {
      RECEIVABLE: new Map(customers.map((customer) => [customer.code, customer.id])),
      PAYABLE: new Map(suppliers.map((supplier) => [supplier.code, supplier.id])),
    };
  }

  private async copyCounts(): Promise<{ posted: number; blocked: number }> {
    const count = async (
      table: typeof erkhetLedgerTrs | typeof erkhetLedgerOpenings,
    ): Promise<{ posted: number; blocked: number }> => {
      const [row] = await this.db
        .select({
          posted: sql<string>`count(*)`,
          blocked: sql<string>`count(*) FILTER (WHERE ${table.state} = ${'BLOCKED' satisfies ErkhetLedgerState})`,
        })
        .from(table)
        .where(isNotNull(table.postedHash));
      return {
        posted: Number.parseInt(row?.posted ?? '0', 10),
        blocked: Number.parseInt(row?.blocked ?? '0', 10),
      };
    };
    const trs = await count(erkhetLedgerTrs);
    const openings = await count(erkhetLedgerOpenings);
    return { posted: trs.posted + openings.posted, blocked: trs.blocked + openings.blocked };
  }

  private async enqueue(tx: Tx, runId: number): Promise<void> {
    await this.jobs.enqueue(
      tx,
      'erkhet.ledger',
      { runId },
      { singletonKey: `erkhet-ledger-${runId}` },
    );
  }

  /** Closes a run that waited or ran past its time: its worker died with it. */
  private async closeInterrupted(tx: Tx): Promise<void> {
    await tx
      .update(erkhetLedgerRuns)
      .set({ status: 'FAILED', failure: 'INTERRUPTED', activeSlot: null, finishedAt: sql`now()` })
      .where(
        and(
          inArray(erkhetLedgerRuns.status, ACTIVE),
          sql`${erkhetLedgerRuns.createdAt} < now() - make_interval(mins => ${ERKHET_LEDGER_LIMITS.staleMinutes})`,
        ),
      );
  }

  private async views(rows: readonly RunRow[]): Promise<ErkhetLedgerRun[]> {
    const names = await this.names.namesOf(
      rows.map((row) => row.startedBy).filter((id): id is number => id !== null),
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      trigger: row.trigger,
      startedBy: row.startedBy === null ? null : (names.get(row.startedBy) ?? null),
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      failure: row.failure,
      failureDetail: row.failureDetail,
      ownChoice: row.ownChoice,
      ownReversed: row.ownReversed,
      summary: row.summary,
    }));
  }
}

function isOneActive(error: unknown): boolean {
  const database = databaseErrorOf(error);
  return database?.code === '23505' && database.constraint === 'erkhet_ledger_runs_one_active';
}

function isInterrupted(row: RunRow): boolean {
  return (
    ACTIVE.includes(row.status) &&
    Date.now() - row.createdAt.getTime() > ERKHET_LEDGER_LIMITS.staleMinutes * 60_000
  );
}
