import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PartyIn } from '@tugeel/fin-contract';
import {
  ERKHET_BOOKS,
  ERKHET_HISTORY_START,
  ERKHET_LEDGER_LIMITS,
  type ErkhetLedgerFailure,
  type ErkhetLedgerSide,
  type ErkhetLedgerState,
} from '@tugeel/shared/erkhet';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import {
  type ErkhetClient,
  ErkhetError,
  ErkhetGateway,
  type ErkhetJournalLine,
  ErkhetPageError,
  joinJournalPages,
  readJournalPage,
} from '../../../integrations/erkhet';
import { ErkhetBooksRefusal, type ErkhetCopyCommand, FinErkhetBooks } from '../../fin-bridge';
import { type Actor, AuditService, systemActor } from '../../identity';
import {
  type ErkhetLedgerAccountSummary,
  type ErkhetLedgerCounts,
  type ErkhetLedgerSummary,
  erkhetLedgerAllocations,
  erkhetLedgerLines,
  erkhetLedgerOpeningReads,
  erkhetLedgerOpenings,
  erkhetLedgerParties,
  erkhetLedgerRuns,
  erkhetLedgerSettings,
  erkhetLedgerTrs,
} from '../schema';
import {
  type CopyAction,
  groupJournal,
  type OpeningSum,
  openingPosting,
  pairOldestFirst,
  PARTY_KEY,
  planCopy,
  type StagedTr,
  sumOpening,
  type TrPosting,
  trPosting,
} from './erkhet-ledger-plan';
import { ErkhetLedgerService } from './erkhet-ledger.service';
import { ErkhetSettingsFlowService } from './erkhet-settings-flow.service';

type RunRow = typeof erkhetLedgerRuns.$inferSelect;
type TrRow = typeof erkhetLedgerTrs.$inferSelect;
type OpeningRow = typeof erkhetLedgerOpenings.$inferSelect;

const CHUNK = 500;
/** Pairs in one ALLOCATION document (the intake takes 200). */
const MAX_PAIRS = 200;
/** How often a list that moved while it was read is read again. */
const READ_ATTEMPTS = 3;
/** A transaction whose address Erkhet did not give is asked for again after this many days. */
const PATH_RETRY_DAYS = 7;

/** A run stops here with a reason the page can say. */
class LedgerStop extends Error {
  constructor(
    readonly failure: ErkhetLedgerFailure,
    readonly detail: Record<string, string> = {},
  ) {
    super(`the Erkhet ledger run stopped: ${failure}`);
    this.name = 'LedgerStop';
  }
}

interface AccountRead {
  account: string;
  side: ErkhetLedgerSide;
  erkhetId: string;
  trs: StagedTr[];
  /** The opening balances, when this run read the history; null when an earlier run's stand. */
  opening: { through: string; pages: number; lines: number; sums: OpeningSum[] } | null;
}

/** One copy to act on: a party's opening balance or a transaction. */
interface Step {
  table: 'tr' | 'opening';
  id: number;
  date: string;
  action: CopyAction;
  /** Left out of the books for a party Bto does not have, after this plan. */
  unmatched: boolean;
}

interface Done {
  posted: number;
  reversed: number;
  blocked: number;
}

type Known = Record<ErkhetLedgerSide, Map<string, number>>;

/**
 * A run of «Авлага, өглөгийн гүйлгээ» in the worker (ADR-0219).
 *
 * A download reads Erkhet's general journal page by page for the two accounts, with no transaction
 * open, and then replaces what the tables hold of it in one transaction; a list that could not be
 * read whole changes nothing. A post goes copy by copy, oldest first, each in its own transaction
 * together with the row that says it is posted, so a run that dies is continued by the next one and
 * the intake's key keeps a copy from posting twice. Only GET requests reach Erkhet.
 */
@Injectable()
export class ErkhetLedgerFlowService {
  private readonly logger = new Logger('ErkhetLedger');
  /** The pause between two requests to Erkhet; tests run without it. */
  pauseMs: number = process.env.NODE_ENV === 'test' ? 0 : ERKHET_LEDGER_LIMITS.pauseMs;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gateway: ErkhetGateway,
    private readonly signIn: ErkhetSettingsFlowService,
    private readonly ledger: ErkhetLedgerService,
    private readonly books: FinErkhetBooks,
    private readonly audit: AuditService,
  ) {}

  async execute(runId: number): Promise<{ status: string; failure?: ErkhetLedgerFailure }> {
    const [run] = await this.db
      .update(erkhetLedgerRuns)
      .set({ status: 'RUNNING', startedAt: sql`now()` })
      .where(
        and(
          eq(erkhetLedgerRuns.id, runId),
          inArray(erkhetLedgerRuns.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .returning();
    if (!run) return { status: 'SKIPPED' };
    const actor: Actor =
      run.startedBy === null
        ? systemActor('job:erkhet.ledger')
        : { kind: 'STAFF', userId: run.startedBy };
    let client: ErkhetClient | null = null;
    try {
      if (run.kind === 'REVERT') {
        const done = await this.revert(actor);
        await this.finish(run, actor, await this.summary(run, null, done));
        return { status: 'DONE' };
      }
      if (run.download) {
        const saved = await this.signIn.saved();
        if (saved.account === null) throw new LedgerStop(saved.failure);
        client = this.gateway.clientFor(saved.account);
        await this.stage(await this.download(client));
      }
      const plan = await this.plan();
      if (run.kind === 'CHECK') {
        await this.finish(run, actor, await this.summary(run, plan, null));
      } else {
        if (!(await this.books.clearingReady())) throw new LedgerStop('CLEARING_MISSING');
        const done = await this.post(actor, plan);
        await this.db
          .update(erkhetLedgerSettings)
          .set({ posting: true })
          .where(eq(erkhetLedgerSettings.id, 1));
        await this.finish(run, actor, await this.summary(run, plan, done));
      }
    } catch (error: unknown) {
      if (error instanceof LedgerStop) return this.fail(run.id, error.failure, error.detail);
      if (error instanceof ErkhetError) {
        this.logger.warn({ reason: error.reason, status: error.status }, error.message);
        return this.fail(run.id, error.reason);
      }
      this.logger.error({ runId, err: error }, 'the Erkhet ledger run failed');
      return this.fail(run.id, 'INTERNAL');
    }
    // The run has ended and the page shows it; the addresses are a slow extra after it.
    if (client) await this.fillPaths(client, run.id);
    return { status: 'DONE' };
  }

  // ---- download --------------------------------------------------------------------------------

  private async download(client: ErkhetClient): Promise<AccountRead[]> {
    const settings = await this.ledger.settings();
    await client.signIn();
    const ids = await client.accountIds();
    const today = businessDate();
    const through = addDays(settings.startDate, -1);
    const reads: AccountRead[] = [];
    for (const [side, account] of [
      ['RECEIVABLE', settings.receivableAccount],
      ['PAYABLE', settings.payableAccount],
    ] as const) {
      const erkhetId = ids.get(account);
      if (erkhetId === undefined) throw new LedgerStop('ACCOUNT_NOT_FOUND', { account });
      const current = await this.readAll(client, account, erkhetId, settings.startDate, today);
      const [read] = await this.db
        .select({ through: erkhetLedgerOpeningReads.through })
        .from(erkhetLedgerOpeningReads)
        .where(eq(erkhetLedgerOpeningReads.account, account));
      let opening: AccountRead['opening'] = null;
      if (read?.through !== through) {
        const history = await this.readAll(
          client,
          account,
          erkhetId,
          ERKHET_HISTORY_START,
          through,
        );
        opening = {
          through,
          pages: history.pages,
          lines: history.lines.length,
          sums: sumOpening(history.lines),
        };
      }
      reads.push({ account, side, erkhetId, trs: groupJournal(current.lines), opening });
    }
    return reads;
  }

  /**
   * Every page of the journal of one account between two days. The list is newest first and has
   * no stable end marker, so the pages are read until one is empty; a line added meanwhile shifts
   * the pages, so the first page is read once more at the end and the read starts again when it
   * moved.
   */
  private async readAll(
    client: ErkhetClient,
    account: string,
    erkhetId: string,
    from: string,
    to: string,
  ): Promise<{ lines: ErkhetJournalLine[]; pages: number }> {
    if (from > to) return { lines: [], pages: 0 };
    const page = async (number: number): Promise<ErkhetJournalLine[]> => {
      let lines: ErkhetJournalLine[];
      try {
        lines = readJournalPage(
          await client.journalPage({ from, to, account: erkhetId, page: number }),
        );
      } catch (error: unknown) {
        if (error instanceof ErkhetPageError) {
          this.logger.warn({ account, page: number }, error.message);
          throw new LedgerStop('UNEXPECTED_PAGE', { account, page: String(number) });
        }
        throw error;
      }
      // The filter must have held: a line of another account or day is not ours to copy.
      for (const line of lines) {
        if (
          (line.accountCode !== '' && line.accountCode !== account) ||
          line.date < from ||
          line.date > to
        ) {
          throw new LedgerStop('UNEXPECTED_PAGE', { account, page: String(number) });
        }
      }
      await this.pause();
      return lines;
    };
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
      const read: ErkhetJournalLine[][] = [];
      for (let number = 1; ; number += 1) {
        if (number > ERKHET_LEDGER_LIMITS.maxPages) {
          throw new LedgerStop('UNEXPECTED_PAGE', { account, page: String(number) });
        }
        const found = await page(number);
        if (found.length === 0) break;
        read.push(found);
      }
      if (read.length > 0 && JSON.stringify(await page(1)) !== JSON.stringify(read[0])) continue;
      try {
        return { lines: joinJournalPages(read), pages: read.length };
      } catch (error: unknown) {
        if (!(error instanceof ErkhetPageError)) throw error;
        this.logger.warn({ account }, error.message);
        throw new LedgerStop('UNEXPECTED_PAGE', { account, page: '1' });
      }
    }
    throw new LedgerStop('UNEXPECTED_PAGE', { account, page: '1' });
  }

  private async pause(): Promise<void> {
    if (this.pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, this.pauseMs));
  }

  // ---- stage -----------------------------------------------------------------------------------

  /** Replaces what the tables hold of Erkhet with a complete download, in one transaction. */
  private async stage(reads: readonly AccountRead[]): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const accounts = reads.map((read) => read.account);
      // Copies of an account that is no longer copied leave the books with the next post.
      await tx
        .update(erkhetLedgerTrs)
        .set({ gone: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(erkhetLedgerTrs.gone, false),
            sql`${erkhetLedgerTrs.account} NOT IN (${list(accounts)})`,
          ),
        );
      await tx
        .update(erkhetLedgerOpenings)
        .set({ gone: true, updatedAt: sql`now()` })
        .where(
          and(
            eq(erkhetLedgerOpenings.gone, false),
            sql`${erkhetLedgerOpenings.account} NOT IN (${list(accounts)})`,
          ),
        );
      for (const read of reads) {
        await this.stageTrs(tx, read);
        if (read.opening) await this.stageOpenings(tx, read, read.opening);
      }
      const of = (side: ErkhetLedgerSide) => reads.find((read) => read.side === side)?.erkhetId;
      await tx
        .update(erkhetLedgerSettings)
        .set({
          receivableAccountId: of('RECEIVABLE') ?? null,
          payableAccountId: of('PAYABLE') ?? null,
        })
        .where(eq(erkhetLedgerSettings.id, 1));
    });
  }

  private async stageTrs(tx: Tx, read: AccountRead): Promise<void> {
    const known = new Map(
      (
        await tx
          .select({
            id: erkhetLedgerTrs.id,
            trId: erkhetLedgerTrs.trId,
            hash: erkhetLedgerTrs.hash,
            gone: erkhetLedgerTrs.gone,
          })
          .from(erkhetLedgerTrs)
          .where(eq(erkhetLedgerTrs.account, read.account))
      ).map((row) => [row.trId, row]),
    );
    const seen = new Set<number>();
    const fresh: StagedTr[] = [];
    const lines: (typeof erkhetLedgerLines.$inferInsert)[] = [];
    const linesOf = (rowId: number, tr: StagedTr) =>
      tr.lines.map((line) => ({
        trRowId: rowId,
        n: line.n,
        partyCode: line.partyCode,
        partyName: line.partyName,
        debit: line.debit,
        credit: line.credit,
        description: line.description,
        billNumber: line.billNumber,
      }));
    const back: number[] = [];
    for (const tr of read.trs) {
      seen.add(tr.trId);
      const row = known.get(tr.trId);
      if (!row) {
        fresh.push(tr);
      } else if (row.hash !== tr.hash) {
        await tx
          .update(erkhetLedgerTrs)
          .set({
            ptrId: tr.ptrId,
            trDate: tr.date,
            debit: tr.debit,
            credit: tr.credit,
            lineCount: tr.lines.length,
            hash: tr.hash,
            gone: false,
            updatedAt: sql`now()`,
          })
          .where(eq(erkhetLedgerTrs.id, row.id));
        await tx.delete(erkhetLedgerLines).where(eq(erkhetLedgerLines.trRowId, row.id));
        lines.push(...linesOf(row.id, tr));
      } else if (row.gone) {
        back.push(row.id);
      }
    }
    for (const part of chunks(back)) {
      await tx
        .update(erkhetLedgerTrs)
        .set({ gone: false, updatedAt: sql`now()` })
        .where(inArray(erkhetLedgerTrs.id, part));
    }
    for (const part of chunks(fresh)) {
      const made = await tx
        .insert(erkhetLedgerTrs)
        .values(
          part.map((tr) => ({
            account: read.account,
            side: read.side,
            trId: tr.trId,
            ptrId: tr.ptrId,
            trDate: tr.date,
            debit: tr.debit,
            credit: tr.credit,
            lineCount: tr.lines.length,
            hash: tr.hash,
          })),
        )
        .returning({ id: erkhetLedgerTrs.id, trId: erkhetLedgerTrs.trId });
      const idOf = new Map(made.map((row) => [row.trId, row.id]));
      for (const tr of part) {
        const rowId = idOf.get(tr.trId);
        if (rowId === undefined) throw new Error('a staged transaction has no row');
        lines.push(...linesOf(rowId, tr));
      }
    }
    for (const part of chunks(lines)) await tx.insert(erkhetLedgerLines).values(part);
    const vanished = [...known.values()].filter((row) => !row.gone && !seen.has(row.trId));
    for (const part of chunks(vanished.map((row) => row.id))) {
      await tx
        .update(erkhetLedgerTrs)
        .set({ gone: true, updatedAt: sql`now()` })
        .where(inArray(erkhetLedgerTrs.id, part));
    }
  }

  private async stageOpenings(
    tx: Tx,
    read: Pick<AccountRead, 'account' | 'side'>,
    opening: NonNullable<AccountRead['opening']>,
  ): Promise<void> {
    const { account } = read;
    const known = new Map(
      (
        await tx
          .select({ id: erkhetLedgerOpenings.id, partyCode: erkhetLedgerOpenings.partyCode })
          .from(erkhetLedgerOpenings)
          .where(eq(erkhetLedgerOpenings.account, account))
      ).map((row) => [row.partyCode, row.id]),
    );
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const sum of opening.sums) {
      debit = debit.plus(sum.debit);
      credit = credit.plus(sum.credit);
      const facts = {
        partyName: sum.partyName,
        through: opening.through,
        debit: sum.debit,
        credit: sum.credit,
        lineCount: sum.lines,
        hash: `${opening.through}|${sum.debit.toFixed(2)}|${sum.credit.toFixed(2)}`,
        gone: false,
        updatedAt: sql`now()`,
      };
      const id = known.get(sum.partyCode);
      known.delete(sum.partyCode);
      if (id === undefined) {
        await tx
          .insert(erkhetLedgerOpenings)
          .values({ account, side: read.side, partyCode: sum.partyCode, ...facts });
      } else {
        await tx.update(erkhetLedgerOpenings).set(facts).where(eq(erkhetLedgerOpenings.id, id));
      }
    }
    for (const part of chunks([...known.values()])) {
      await tx
        .update(erkhetLedgerOpenings)
        .set({ gone: true, updatedAt: sql`now()` })
        .where(inArray(erkhetLedgerOpenings.id, part));
    }
    const summed = {
      through: opening.through,
      pages: opening.pages,
      lines: opening.lines,
      debit,
      credit,
      readAt: sql`now()`,
    };
    await tx
      .insert(erkhetLedgerOpeningReads)
      .values({ account, ...summed })
      .onConflictDoUpdate({ target: erkhetLedgerOpeningReads.account, set: summed });
  }

  // ---- plan ------------------------------------------------------------------------------------

  /** What a post would do with every copy, oldest first; nothing is written. */
  private async plan(): Promise<{ steps: Step[]; known: Known; unmatchedParties: number }> {
    const trs = await this.db.select().from(erkhetLedgerTrs);
    const openings = await this.db.select().from(erkhetLedgerOpenings);
    const codes = await this.partyCodes();
    const known = await this.ledger.knownParties([
      ...trs.flatMap((tr) => (codes.get(tr.id) ?? []).map((code) => ({ side: tr.side, code }))),
      ...openings.map((opening) => ({ side: opening.side, code: opening.partyCode })),
    ]);
    const missing = new Set<string>();
    const knows = (side: ErkhetLedgerSide) => (code: string) => {
      const found = known[side].has(code);
      if (!found) missing.add(`${side}:${code}`);
      return found;
    };
    const step = (
      table: Step['table'],
      row: TrRow | OpeningRow,
      date: string,
      partyCodes: readonly string[],
    ): Step => {
      const action = planCopy({ ...row, partyCodes }, knows(row.side));
      return {
        table,
        id: row.id,
        date,
        action,
        unmatched:
          action === 'LEAVE_OUT' ||
          action === 'UNMATCH' ||
          (action === 'NONE' && !row.gone && row.state === 'UNMATCHED'),
      };
    };
    const steps: Step[] = [
      ...openings.map((opening) => step('opening', opening, opening.through, [opening.partyCode])),
      ...trs.map((tr) => step('tr', tr, tr.trDate, codes.get(tr.id) ?? [''])),
    ];
    // Oldest first: a closed month refuses the first copy dated in it, before anything later posts.
    steps.sort((a, b) =>
      a.date === b.date
        ? a.table === b.table
          ? a.id - b.id
          : a.table === 'opening'
            ? -1
            : 1
        : a.date < b.date
          ? -1
          : 1,
    );
    return { steps, known, unmatchedParties: missing.size };
  }

  /** The party codes of each staged transaction, by its row. */
  private async partyCodes(
    executor: Db | Tx = this.db,
    trRowId?: number,
  ): Promise<Map<number, string[]>> {
    const rows = await executor
      .selectDistinct({ id: erkhetLedgerLines.trRowId, code: erkhetLedgerLines.partyCode })
      .from(erkhetLedgerLines)
      .where(trRowId === undefined ? undefined : eq(erkhetLedgerLines.trRowId, trRowId));
    const byRow = new Map<number, string[]>();
    for (const row of rows) byRow.set(row.id, [...(byRow.get(row.id) ?? []), row.code]);
    return byRow;
  }

  // ---- post ------------------------------------------------------------------------------------

  private async post(actor: Actor, plan: { steps: Step[]; known: Known }): Promise<Done> {
    const done: Done = { posted: 0, reversed: 0, blocked: 0 };
    // A blocked copy that Erkhet shows again as the books hold it has nothing left to reverse.
    for (const table of [erkhetLedgerTrs, erkhetLedgerOpenings]) {
      await this.db
        .update(table)
        .set({ state: 'POSTED', blockedReason: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(table.state, 'BLOCKED'),
            eq(table.gone, false),
            sql`${table.hash} = ${table.postedHash}`,
          ),
        );
    }
    const steps = plan.steps.filter((step) => step.action !== 'NONE');
    let stopped: LedgerStop | null = null;
    try {
      await this.unpair(actor, steps);
      for (const step of steps) {
        const outcome = await this.act(actor, plan.known, step);
        done.posted += outcome.posted;
        done.reversed += outcome.reversed;
        done.blocked += outcome.blocked;
      }
    } catch (error: unknown) {
      if (!(error instanceof LedgerStop)) throw error;
      stopped = error;
    }
    // Also after a stop: what was unpaired for a reversal that did not happen is paired again.
    await this.pair(actor, plan.known);
    if (stopped) throw stopped;
    return done;
  }

  /**
   * One copy in one transaction: its row is locked and looked at again, so a second delivery of
   * the job finds what the first one did. A reversal another allocation holds marks the copy
   * BLOCKED and the run goes on; any other refusal of the books stops the run.
   */
  private async act(actor: Actor, known: Known, step: Step): Promise<Done> {
    try {
      return await inTransaction(this.db, (tx) =>
        step.table === 'tr'
          ? this.actOnTr(tx, actor, known, step.id)
          : this.actOnOpening(tx, actor, known, step.id),
      );
    } catch (error: unknown) {
      if (!(error instanceof ErkhetBooksRefusal)) throw error;
      if (error.code === 'FIN_REVERSAL_BLOCKED') {
        const table = step.table === 'tr' ? erkhetLedgerTrs : erkhetLedgerOpenings;
        await this.db
          .update(table)
          .set({ state: 'BLOCKED', blockedReason: error.code, updatedAt: sql`now()` })
          .where(eq(table.id, step.id));
        return { posted: 0, reversed: 0, blocked: 1 };
      }
      throw stopOf(error, step);
    }
  }

  private async actOnTr(tx: Tx, actor: Actor, known: Known, id: number): Promise<Done> {
    const [row] = await tx
      .select()
      .from(erkhetLedgerTrs)
      .where(eq(erkhetLedgerTrs.id, id))
      .for('update');
    if (!row) return { posted: 0, reversed: 0, blocked: 0 };
    const { side } = row;
    const codes = (await this.partyCodes(tx, id)).get(id) ?? [''];
    const action = planCopy({ ...row, partyCodes: codes }, (code) => known[side].has(code));
    const docId = `${row.account}:${row.trId}`;
    const build = async (): Promise<TrPosting | null> => {
      const lines = await tx
        .select()
        .from(erkhetLedgerLines)
        .where(eq(erkhetLedgerLines.trRowId, id))
        .orderBy(asc(erkhetLedgerLines.n));
      const parties = await this.partiesIn(tx, side, known, codes);
      return trPosting(
        { trId: row.trId, ptrId: row.ptrId, date: row.trDate, lines },
        side,
        row.account,
        (code) => partyOf(parties, code),
      );
    };
    const next = await this.apply(tx, actor, {
      action,
      row,
      docType: ERKHET_BOOKS.trDocType,
      docId,
      build,
      date: row.trDate,
    });
    if (next === 'DROP') {
      await tx.delete(erkhetLedgerTrs).where(eq(erkhetLedgerTrs.id, id));
      return { posted: 0, reversed: 0, blocked: 0 };
    }
    if (next === null) return { posted: 0, reversed: 0, blocked: 0 };
    await tx
      .update(erkhetLedgerTrs)
      .set({ ...next.set, postedParties: next.set.postedHash === null ? null : codes })
      .where(eq(erkhetLedgerTrs.id, id));
    await this.markDirty(tx, side, [...codes, ...(row.postedParties ?? [])]);
    return next.done;
  }

  private async actOnOpening(tx: Tx, actor: Actor, known: Known, id: number): Promise<Done> {
    const [row] = await tx
      .select()
      .from(erkhetLedgerOpenings)
      .where(eq(erkhetLedgerOpenings.id, id))
      .for('update');
    if (!row) return { posted: 0, reversed: 0, blocked: 0 };
    const { side } = row;
    const action = planCopy({ ...row, partyCodes: [row.partyCode] }, (code) =>
      known[side].has(code),
    );
    const build = async (): Promise<TrPosting | null> => {
      const parties = await this.partiesIn(tx, side, known, [row.partyCode]);
      return openingPosting(row, side, row.account, row.through, partyOf(parties, row.partyCode));
    };
    const next = await this.apply(tx, actor, {
      action,
      row,
      docType: ERKHET_BOOKS.openingDocType,
      docId: `${row.account}:${row.partyCode}`,
      build,
      date: row.through,
    });
    if (next === 'DROP') {
      await tx.delete(erkhetLedgerOpenings).where(eq(erkhetLedgerOpenings.id, id));
      return { posted: 0, reversed: 0, blocked: 0 };
    }
    if (next === null) return { posted: 0, reversed: 0, blocked: 0 };
    await tx.update(erkhetLedgerOpenings).set(next.set).where(eq(erkhetLedgerOpenings.id, id));
    await this.markDirty(tx, side, [row.partyCode]);
    return next.done;
  }

  /**
   * What an action does to the books, and the copy's new standing. The posted revision is
   * reversed on its own accounting date; a new one takes the next revision number, which the
   * intake accepts only once the one before it is reversed.
   */
  private async apply(
    tx: Tx,
    actor: Actor,
    input: {
      action: CopyAction;
      row: Pick<
        TrRow | OpeningRow,
        'hash' | 'state' | 'liveRevision' | 'lastRevision' | 'postedDate'
      >;
      docType: ErkhetCopyCommand['docType'];
      docId: string;
      build: () => Promise<TrPosting | null>;
      date: string;
    },
  ): Promise<
    | {
        set: {
          state: ErkhetLedgerState;
          postedHash: string | null;
          liveRevision: number | null;
          lastRevision: number;
          postedDate: string | null;
          blockedReason: null;
          updatedAt: ReturnType<typeof sql>;
        };
        done: Done;
      }
    | 'DROP'
    | null
  > {
    const { action, row } = input;
    if (action === 'DROP') return 'DROP';
    if (action === 'NONE') return null;
    const done: Done = { posted: 0, reversed: 0, blocked: 0 };
    const set = (
      state: ErkhetLedgerState,
      postedHash: string | null,
      liveRevision: number | null,
      lastRevision: number,
      postedDate: string | null,
    ) => ({
      set: {
        state,
        postedHash,
        liveRevision,
        lastRevision,
        postedDate,
        blockedReason: null,
        updatedAt: sql`now()`,
      },
      done,
    });
    if (action === 'LEAVE_OUT') return set('UNMATCHED', null, null, row.lastRevision, null);
    if (action !== 'POST' && row.liveRevision !== null) {
      await this.books.submitInTx(tx, actor, {
        docType: input.docType,
        docId: input.docId,
        revision: row.liveRevision,
        body: {
          action: 'REVERSE',
          ...(row.postedDate ? { accountingDate: row.postedDate } : {}),
          reason: `Erkhet: ${action}`,
        },
      });
      done.reversed += 1;
    }
    if (action === 'REVERSE') return set('REVERSED', null, null, row.lastRevision, null);
    if (action === 'UNMATCH') return set('UNMATCHED', null, null, row.lastRevision, null);
    // POST or REVISE: the next revision, or nothing when Erkhet's lines carry no amount.
    const posting = await input.build();
    if (posting === null) return set('POSTED', row.hash, null, row.lastRevision, null);
    const revision = row.lastRevision + 1;
    await this.books.submitInTx(tx, actor, {
      docType: input.docType,
      docId: input.docId,
      revision,
      docNo: posting.docNo,
      body: posting.body,
    });
    done.posted += 1;
    return set('POSTED', row.hash, revision, revision, input.date);
  }

  /** The parties of these codes as the intake names them. */
  private async partiesIn(
    tx: Tx,
    side: ErkhetLedgerSide,
    known: Known,
    codes: readonly string[],
  ): Promise<Map<string, PartyIn>> {
    const parties = new Map<string, PartyIn>();
    for (const code of new Set(codes)) {
      const id = known[side].get(code);
      if (id === undefined) throw new Error(`party ${code} is not in Bto`);
      parties.set(code, await this.books.partyIn(tx, side, id));
    }
    return parties;
  }

  private async markDirty(tx: Tx, side: ErkhetLedgerSide, codes: readonly string[]): Promise<void> {
    const values = [...new Set(codes)].filter(Boolean).map((partyCode) => ({ side, partyCode }));
    if (values.length === 0) return;
    await tx
      .insert(erkhetLedgerParties)
      .values(values)
      .onConflictDoUpdate({
        target: [erkhetLedgerParties.side, erkhetLedgerParties.partyCode],
        set: { dirty: true },
      });
  }

  // ---- pairing ---------------------------------------------------------------------------------

  /**
   * Before a posted copy is reversed, the pairings of its parties are taken back: the books refuse
   * to reverse a document while an allocation holds its item. They are paired again afterwards.
   */
  private async unpair(actor: Actor, steps: readonly Step[]): Promise<void> {
    const reversing = steps.filter((step) =>
      (['REVISE', 'REVERSE', 'UNMATCH'] satisfies CopyAction[] as CopyAction[]).includes(
        step.action,
      ),
    );
    if (reversing.length === 0) return;
    const wanted = new Map<string, { side: ErkhetLedgerSide; code: string }>();
    const want = (side: ErkhetLedgerSide, codes: readonly string[]) => {
      for (const code of codes) wanted.set(`${side}:${code}`, { side, code });
    };
    const trIds = reversing.filter((step) => step.table === 'tr').map((step) => step.id);
    for (const part of chunks(trIds)) {
      for (const row of await this.db
        .select({ side: erkhetLedgerTrs.side, parties: erkhetLedgerTrs.postedParties })
        .from(erkhetLedgerTrs)
        .where(inArray(erkhetLedgerTrs.id, part))) {
        want(row.side, row.parties ?? []);
      }
    }
    const openingIds = reversing.filter((step) => step.table === 'opening').map((step) => step.id);
    for (const part of chunks(openingIds)) {
      for (const row of await this.db
        .select({ side: erkhetLedgerOpenings.side, code: erkhetLedgerOpenings.partyCode })
        .from(erkhetLedgerOpenings)
        .where(inArray(erkhetLedgerOpenings.id, part))) {
        want(row.side, [row.code]);
      }
    }
    for (const party of wanted.values()) await this.unpairParty(actor, party.side, party.code);
  }

  private async unpairParty(actor: Actor, side: ErkhetLedgerSide, code: string): Promise<void> {
    const [party] = await this.db
      .select({ id: erkhetLedgerParties.id })
      .from(erkhetLedgerParties)
      .where(and(eq(erkhetLedgerParties.side, side), eq(erkhetLedgerParties.partyCode, code)));
    if (!party) return;
    const live = await this.db
      .select({ id: erkhetLedgerAllocations.id })
      .from(erkhetLedgerAllocations)
      .where(
        and(
          eq(erkhetLedgerAllocations.partyRowId, party.id),
          eq(erkhetLedgerAllocations.live, true),
        ),
      )
      .orderBy(desc(erkhetLedgerAllocations.id));
    for (const allocation of live) {
      try {
        await inTransaction(this.db, async (tx) => {
          const [locked] = await tx
            .select({ live: erkhetLedgerAllocations.live })
            .from(erkhetLedgerAllocations)
            .where(eq(erkhetLedgerAllocations.id, allocation.id))
            .for('update');
          if (!locked?.live) return;
          await this.books.submitInTx(tx, actor, {
            docType: ERKHET_BOOKS.allocationDocType,
            docId: String(allocation.id),
            revision: 1,
            body: { action: 'REVERSE', reason: 'Erkhet: a copy of the party changed' },
          });
          await tx
            .update(erkhetLedgerAllocations)
            .set({ live: false })
            .where(eq(erkhetLedgerAllocations.id, allocation.id));
          await tx
            .update(erkhetLedgerParties)
            .set({ dirty: true })
            .where(eq(erkhetLedgerParties.id, party.id));
        });
      } catch (error: unknown) {
        if (!(error instanceof ErkhetBooksRefusal)) throw error;
        throw stopOf(error, { table: 'opening', id: allocation.id, date: businessDate() });
      }
    }
  }

  /**
   * Erkhet settles by balance: a party's copied credits close its copied debits oldest first, as
   * ALLOCATION documents of at most 200 pairs. Only the copies' own items are paired; an item one of
   * Bto's own documents opened is never touched.
   */
  private async pair(actor: Actor, known: Known): Promise<void> {
    const dirty = await this.db
      .select()
      .from(erkhetLedgerParties)
      .where(eq(erkhetLedgerParties.dirty, true))
      .orderBy(asc(erkhetLedgerParties.id));
    const today = businessDate();
    for (const party of dirty) {
      const id = known[party.side].get(party.partyCode);
      try {
        for (let round = 0; id !== undefined && round < 50; round += 1) {
          const pairs = pairOldestFirst(
            await this.books.copiedOpenItems(party.side, id),
            MAX_PAIRS,
          );
          if (pairs.length === 0) break;
          const amount = pairs.reduce((sum, pair) => sum.plus(pair.amount), new Decimal(0));
          await inTransaction(this.db, async (tx) => {
            const [row] = await tx
              .insert(erkhetLedgerAllocations)
              .values({ partyRowId: party.id, pairs: pairs.length, amount })
              .returning({ id: erkhetLedgerAllocations.id });
            if (!row) throw new Error('allocation insert returned no row');
            await this.books.submitInTx(tx, actor, {
              docType: ERKHET_BOOKS.allocationDocType,
              docId: String(row.id),
              revision: 1,
              body: {
                action: 'POST',
                documentType: ERKHET_BOOKS.allocationType,
                documentDate: today,
                currency: 'MNT',
                party: await this.books.partyIn(tx, party.side, id),
                description: `Erkhet ${party.partyCode}`,
                controlTotal: amount.toFixed(2),
                lines: [],
                allocate: {
                  key: PARTY_KEY[party.side],
                  pairs: pairs.map((pair) => ({
                    debit: { itemId: String(pair.debitId) },
                    credit: { itemId: String(pair.creditId) },
                    amount: pair.amount.toFixed(2),
                  })),
                },
              },
            });
          });
        }
        await this.db
          .update(erkhetLedgerParties)
          .set({ dirty: false })
          .where(eq(erkhetLedgerParties.id, party.id));
      } catch (error: unknown) {
        // An item moved under the pairing (a person allocated it meanwhile): the next run pairs.
        if (!(error instanceof ErkhetBooksRefusal)) throw error;
        this.logger.warn({ party: party.partyCode, code: error.code }, 'a pairing was refused');
      }
    }
  }

  // ---- revert ----------------------------------------------------------------------------------

  /** «Хуулсныг буцаах»: every pairing is taken back and every posted copy reversed. */
  private async revert(actor: Actor): Promise<Done> {
    const done: Done = { posted: 0, reversed: 0, blocked: 0 };
    const parties = await this.db
      .selectDistinct({ side: erkhetLedgerParties.side, code: erkhetLedgerParties.partyCode })
      .from(erkhetLedgerAllocations)
      .innerJoin(
        erkhetLedgerParties,
        eq(erkhetLedgerParties.id, erkhetLedgerAllocations.partyRowId),
      )
      .where(eq(erkhetLedgerAllocations.live, true));
    for (const party of parties) await this.unpairParty(actor, party.side, party.code);
    const trs = await this.db
      .select({ id: erkhetLedgerTrs.id, date: erkhetLedgerTrs.trDate })
      .from(erkhetLedgerTrs)
      .where(isNotNull(erkhetLedgerTrs.postedHash));
    const openings = await this.db
      .select({ id: erkhetLedgerOpenings.id, date: erkhetLedgerOpenings.through })
      .from(erkhetLedgerOpenings)
      .where(isNotNull(erkhetLedgerOpenings.postedHash));
    const steps: Step[] = [
      ...openings.map((row) => ({
        table: 'opening' as const,
        ...row,
        action: 'REVERSE' as const,
        unmatched: false,
      })),
      ...trs.map((row) => ({
        table: 'tr' as const,
        ...row,
        action: 'REVERSE' as const,
        unmatched: false,
      })),
    ].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
    for (const step of steps) {
      const outcome = await this.revertOne(actor, step);
      done.reversed += outcome.reversed;
      done.blocked += outcome.blocked;
    }
    await this.db.update(erkhetLedgerParties).set({ dirty: false });
    await this.db
      .update(erkhetLedgerSettings)
      .set({ posting: false })
      .where(eq(erkhetLedgerSettings.id, 1));
    return done;
  }

  private async revertOne(actor: Actor, step: Step): Promise<Done> {
    const table = step.table === 'tr' ? erkhetLedgerTrs : erkhetLedgerOpenings;
    try {
      return await inTransaction(this.db, async (tx) => {
        const [row] = await tx.select().from(table).where(eq(table.id, step.id)).for('update');
        if (!row || row.postedHash === null) return { posted: 0, reversed: 0, blocked: 0 };
        const docId =
          'trId' in row ? `${row.account}:${row.trId}` : `${row.account}:${row.partyCode}`;
        if (row.liveRevision !== null) {
          await this.books.submitInTx(tx, actor, {
            docType: step.table === 'tr' ? ERKHET_BOOKS.trDocType : ERKHET_BOOKS.openingDocType,
            docId,
            revision: row.liveRevision,
            body: {
              action: 'REVERSE',
              ...(row.postedDate ? { accountingDate: row.postedDate } : {}),
              reason: 'Erkhet: REVERT',
            },
          });
        }
        await tx
          .update(table)
          .set({
            state: 'REVERSED',
            postedHash: null,
            liveRevision: null,
            postedDate: null,
            blockedReason: null,
            updatedAt: sql`now()`,
          })
          .where(eq(table.id, step.id));
        return { posted: 0, reversed: row.liveRevision === null ? 0 : 1, blocked: 0 };
      });
    } catch (error: unknown) {
      if (!(error instanceof ErkhetBooksRefusal)) throw error;
      if (error.code !== 'FIN_REVERSAL_BLOCKED') throw stopOf(error, step);
      await this.db
        .update(table)
        .set({ state: 'BLOCKED', blockedReason: error.code, updatedAt: sql`now()` })
        .where(eq(table.id, step.id));
      return { posted: 0, reversed: 0, blocked: 1 };
    }
  }

  // ---- the end of a run ------------------------------------------------------------------------

  private async summary(
    run: RunRow,
    plan: { steps: Step[]; unmatchedParties: number } | null,
    done: Done | null,
  ): Promise<ErkhetLedgerSummary> {
    const settings = await this.ledger.settings();
    const result = await this.db.execute<{
      account: string;
      trs: string;
      lines: string;
      debit: string;
      credit: string;
      opening: string;
      parties: string;
    }>(sql`
      SELECT a.account,
             (SELECT count(*) FROM erkhet_ledger_trs t WHERE t.account = a.account AND NOT t.gone)::text AS trs,
             (SELECT coalesce(sum(t.line_count), 0) FROM erkhet_ledger_trs t
               WHERE t.account = a.account AND NOT t.gone)::text AS lines,
             (SELECT coalesce(sum(t.debit), 0) FROM erkhet_ledger_trs t
               WHERE t.account = a.account AND NOT t.gone)::text AS debit,
             (SELECT coalesce(sum(t.credit), 0) FROM erkhet_ledger_trs t
               WHERE t.account = a.account AND NOT t.gone)::text AS credit,
             (SELECT coalesce(sum(o.debit - o.credit), 0) FROM erkhet_ledger_openings o
               WHERE o.account = a.account AND NOT o.gone)::text AS opening,
             (SELECT count(*) FROM erkhet_ledger_openings o
               WHERE o.account = a.account AND NOT o.gone AND o.debit <> o.credit)::text AS parties
        FROM (VALUES (${settings.receivableAccount}), (${settings.payableAccount})) AS a (account)`);
    const accounts = result.rows.map((row): ErkhetLedgerAccountSummary => {
      const opening = new Decimal(row.opening);
      const debit = new Decimal(row.debit);
      const credit = new Decimal(row.credit);
      return {
        account: row.account,
        side: row.account === settings.receivableAccount ? 'RECEIVABLE' : 'PAYABLE',
        trs: Number.parseInt(row.trs, 10),
        lines: Number.parseInt(row.lines, 10),
        opening: opening.toFixed(2),
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        closing: opening.plus(debit).minus(credit).toFixed(2),
        openingParties: Number.parseInt(row.parties, 10),
      };
    });
    const counts = (table: Step['table']): ErkhetLedgerCounts => {
      const of = (...actions: CopyAction[]) =>
        (plan?.steps ?? []).filter((step) => step.table === table && actions.includes(step.action))
          .length;
      return {
        post: of('POST'),
        revise: of('REVISE'),
        reverse: of('REVERSE', 'UNMATCH'),
        unmatched: (plan?.steps ?? []).filter((step) => step.table === table && step.unmatched)
          .length,
      };
    };
    const own = await this.books.ownDocuments();
    return {
      accounts,
      trs: counts('tr'),
      openings: counts('opening'),
      unmatchedParties: plan?.unmatchedParties ?? 0,
      ownDocuments: {
        count: own.documents.length,
        total: own.documents
          .reduce((sum, document) => sum.plus(document.amount), new Decimal(0))
          .toFixed(2),
      },
      done: done ? { ...done, ownReversed: run.ownReversed, links: 0 } : null,
    };
  }

  private async finish(run: RunRow, actor: Actor, summary: ErkhetLedgerSummary): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [ended] = await tx
        .update(erkhetLedgerRuns)
        .set({ status: 'DONE', activeSlot: null, finishedAt: sql`now()`, summary })
        .where(and(eq(erkhetLedgerRuns.id, run.id), eq(erkhetLedgerRuns.status, 'RUNNING')))
        .returning({ id: erkhetLedgerRuns.id });
      if (!ended || run.kind === 'CHECK') return;
      await this.audit.record(tx, actor, {
        action: run.kind === 'POST' ? 'POSTED' : 'REVERTED',
        entity: 'erkhet_ledger_runs',
        entityId: run.id,
        after: { trigger: run.trigger, ...summary.done },
      });
    });
  }

  private async fail(
    runId: number,
    failure: ErkhetLedgerFailure,
    detail: Record<string, string> = {},
  ): Promise<{ status: string; failure: ErkhetLedgerFailure }> {
    await this.db
      .update(erkhetLedgerRuns)
      .set({
        status: 'FAILED',
        failure,
        failureDetail: Object.keys(detail).length > 0 ? detail : null,
        activeSlot: null,
        finishedAt: sql`now()`,
      })
      .where(and(eq(erkhetLedgerRuns.id, runId), eq(erkhetLedgerRuns.status, 'RUNNING')));
    return { status: 'FAILED', failure };
  }

  // ---- the addresses ---------------------------------------------------------------------------

  /**
   * Asks Erkhet where each copied transaction opens (the path differs by journal, so it is asked
   * transaction by transaction), newest first, a bounded number a run. A failure ends the filling
   * quietly: the links then open the journal list of the day, and the next run goes on.
   */
  private async fillPaths(client: ErkhetClient, runId: number): Promise<void> {
    const rows = await this.db
      .select({ id: erkhetLedgerTrs.id, trId: erkhetLedgerTrs.trId })
      .from(erkhetLedgerTrs)
      .where(
        and(
          eq(erkhetLedgerTrs.gone, false),
          isNull(erkhetLedgerTrs.updatePath),
          or(
            isNull(erkhetLedgerTrs.pathAskedAt),
            lt(erkhetLedgerTrs.pathAskedAt, sql`now() - make_interval(days => ${PATH_RETRY_DAYS})`),
          ),
        ),
      )
      .orderBy(desc(erkhetLedgerTrs.trDate), desc(erkhetLedgerTrs.id))
      .limit(ERKHET_LEDGER_LIMITS.maxLinksPerRun);
    let found = 0;
    try {
      for (const row of rows) {
        const path = await client.transactionPath(row.trId);
        await this.db
          .update(erkhetLedgerTrs)
          .set({ updatePath: path, pathAskedAt: sql`now()` })
          .where(eq(erkhetLedgerTrs.id, row.id));
        if (path !== null) found += 1;
        await this.pause();
      }
    } catch (error: unknown) {
      if (!(error instanceof ErkhetError)) throw error;
      this.logger.warn({ reason: error.reason }, 'the transaction addresses stopped');
    }
    if (found === 0) return;
    await this.db
      .update(erkhetLedgerRuns)
      .set({
        summary: sql`jsonb_set(${erkhetLedgerRuns.summary}, '{done,links}', ${String(found)}::jsonb)`,
      })
      .where(
        and(
          eq(erkhetLedgerRuns.id, runId),
          sql`${erkhetLedgerRuns.summary} -> 'done' <> 'null'::jsonb`,
        ),
      );
  }
}

/** A refusal of the books as the run's failure. */
function stopOf(error: ErkhetBooksRefusal, step: Pick<Step, 'table' | 'id' | 'date'>): LedgerStop {
  if (error.code === 'FIN_PERIOD_CLOSED') {
    const period = error.params.period;
    return new LedgerStop('PERIOD_CLOSED', {
      month: typeof period === 'string' ? period : step.date.slice(0, 7),
    });
  }
  if (error.code === 'FIN_MAPPING_MISSING' && error.params.key === ERKHET_BOOKS.clearingKey) {
    return new LedgerStop('CLEARING_MISSING');
  }
  return new LedgerStop('POSTING_REFUSED', {
    code: error.code,
    copy: `${step.table}:${step.id}`,
    date: step.date,
  });
}

function partyOf(parties: ReadonlyMap<string, PartyIn>, code: string): PartyIn {
  const party = parties.get(code);
  if (!party) throw new Error(`party ${code} was not resolved`);
  return party;
}

function chunks<T>(rows: readonly T[]): T[][] {
  const parts: T[][] = [];
  for (let start = 0; start < rows.length; start += CHUNK)
    parts.push(rows.slice(start, start + CHUNK));
  return parts;
}

function list(values: readonly string[]) {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );
}
