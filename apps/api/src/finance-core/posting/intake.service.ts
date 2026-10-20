import { Inject, Injectable } from '@nestjs/common';
import {
  FIN_HELD_CODES,
  type FinErrorCode,
  type IntakeCommandV1,
  type IntakeOutcome,
  type IntakeResultV1,
  type ItemRefV1,
  type LineV1,
  type PartyIn,
  type PostBody,
  type ReverseBody,
  type SettleTarget,
  type SourceKey,
} from '@tugeel/fin-contract';
import { Decimal } from '@tugeel/shared/money';
import { businessDateIn } from '@tugeel/shared/time';
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { isCodedError } from '../../common/errors/coded-error';
import { recordFinAudit } from '../audit/fin-audit';
import { type CompanyScope, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb, type FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { rulesOn } from '../ledger/chart.service';
import { openPeriodInTx } from '../ledger/periods';
import { FIN_SERIES, nextNumberInTx } from '../numbering/numbers';
import { FinPartiesService } from '../parties/parties.service';
import {
  FIN_ACCOUNT_CONTROLS,
  FIN_INTAKE_VIAS,
  finAccounts,
  finAllocations,
  finBranchRefs,
  finCompanies,
  finDocuments,
  finDocumentTypes,
  finFiscalPeriods,
  finIntakeAttempts,
  finIntakeRequests,
  finJournalEntries,
  finJournalLines,
  finMoneyAccounts,
  finOpenItems,
  finPartyCompanies,
  finPartyRefs,
  finPostingKeys,
  finSourceSystems,
} from '../schema';
import {
  type FinDocumentClass,
  hashCommand,
  parseCommand,
  POSTING_RIGHTS,
  RIGHT_OF_CLASS,
} from './intake-command';
import { FIN_OWN_SOURCE } from './journal-posting.service';
import { lockPartiesInTx, refreshPartyBalancesInTx, writeAllocationInTx } from './sub-ledger';

type Control = (typeof FIN_ACCOUNT_CONTROLS)[number];
type Side = 'DEBIT' | 'CREDIT';
export type FinIntakeVia = (typeof FIN_INTAKE_VIAS)[number];

/** The accounts whose lines open items (ADR-0072 #5). */
export const PARTY_CONTROLS: ReadonlySet<Control> = new Set([
  'RECEIVABLE',
  'PAYABLE',
  'ADVANCE_RECEIVED',
  'ADVANCE_PAID',
]);

/** The in-process result: the contract's, plus the journal entry's id for Bto's documents. */
export type FinIntakeResult = IntakeResultV1 & {
  document?: IntakeResultV1['document'] & { journalEntryId: string | null };
};

interface Scope extends CompanyScope {
  sourceSystemId: number;
  timezone: string;
  currency: string;
}

interface DocType {
  id: number;
  code: string;
  sourceSystemId: number;
  class: FinDocumentClass;
  numberMode: 'SOURCE' | 'CORE';
  numberSeries: string | null;
  status: string;
}

interface Claim {
  requestId: number;
}

interface ResolvedLine {
  input: LineV1;
  path: string;
  accountId: number;
  accountCode: string;
  control: Control;
  ruleId: number | null;
  partyId: number | null;
  moneyAccountId: number | null;
  amount: Decimal;
}

interface ItemRow {
  id: number;
  partyId: number;
  accountId: number;
  side: Side;
  documentId: number;
  dueDate: string | null;
  amount: Decimal;
  openAmount: Decimal;
}

const ITEM_COLUMNS = {
  id: finOpenItems.id,
  partyId: finOpenItems.partyId,
  accountId: finOpenItems.accountId,
  side: finOpenItems.side,
  documentId: finOpenItems.documentId,
  dueDate: finOpenItems.dueDate,
  amount: finOpenItems.amount,
  openAmount: finOpenItems.openAmount,
};

const opposite = (side: Side): Side => (side === 'DEBIT' ? 'CREDIT' : 'DEBIT');

function rule(name: string, params: Record<string, string | number | null> = {}): FinError {
  return new FinError('FIN_CLASS_RULE', undefined, { rule: name, ...params });
}

function invalid(path: string): FinError {
  return new FinError('FIN_PAYLOAD_INVALID', undefined, { path });
}

/**
 * The intake (ADR-0071, docs/modules/finance-core.md §6): every source system's command goes through
 * here, in one transaction — the caller's (`submitInTx`, Bto's sale, voucher, return) or its own
 * (`submit`, the core's screens). The steps and the lock order are §6's: parse and hash, authorise,
 * claim the business key, the class rules and the period, the parties, the money accounts, the
 * accounts and the controls, the settled items, the numbers last, then the writes. POSTED and
 * DUPLICATE answer; every other outcome throws a FinError so the caller's transaction rolls back.
 * ESLint lets only modules finance, pos and fin-bridge import it (G2).
 */
@Injectable()
export class FinIntakeInTx {
  constructor(
    @Inject(FIN_DB) private readonly db: FinDb,
    private readonly parties: FinPartiesService,
  ) {}

  /** Posts inside the caller's transaction. */
  async submitInTx(
    tx: FinTx,
    ctx: FinCallContext,
    raw: unknown,
    options: { via?: FinIntakeVia } = {},
  ): Promise<FinIntakeResult> {
    return this.process(tx, ctx, raw, options.via ?? 'INPROC', null);
  }

  /**
   * Posts in its own transaction; a refusal is kept on the key (REJECTED, or HELD for a closed
   * month) with an attempt row, written by a second short transaction (ADR-0071 #3, #5).
   */
  async submit(
    ctx: FinCallContext,
    raw: unknown,
    options: { via?: FinIntakeVia } = {},
  ): Promise<FinIntakeResult> {
    const via = options.via ?? 'UI';
    const known: { value: KnownKey | null } = { value: null };
    try {
      return await this.db.transaction((tx) => this.process(tx, ctx, raw, via, known));
    } catch (error) {
      if (known.value && error instanceof FinError) {
        await this.recordRefusal(known.value, error, via);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------------------------

  private async process(
    tx: FinTx,
    ctx: FinCallContext,
    raw: unknown,
    via: FinIntakeVia,
    known: { value: KnownKey | null } | null,
  ): Promise<FinIntakeResult> {
    const cmd = parseCommand(raw);
    const hash = hashCommand(cmd);
    if (cmd.tenant !== ctx.principal.tenant) {
      throw new FinError('FIN_SOURCE_MISMATCH', undefined, { path: 'tenant' });
    }
    const system = ctx.principal.kind === 'SOURCE' ? ctx.principal.system : FIN_OWN_SOURCE;
    if (cmd.source.system !== system) {
      throw new FinError('FIN_SOURCE_MISMATCH', undefined, { path: 'source.system' });
    }
    const scope = await this.scope(tx, ctx, cmd.company);
    await tx.execute(sql`SELECT set_config('fin.company_ids', ${`{${scope.companyId}}`}, true)`);
    const action = cmd.body.action;
    const key = {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      sourceSystemId: scope.sourceSystemId,
      docType: cmd.source.docType,
      docId: cmd.source.docId,
      revision: cmd.source.revision ?? 1,
      action,
      cmd,
      hash,
    };
    if (known) known.value = key;

    const claimed = await this.claim(tx, key, via);
    if ('answer' in claimed) return claimed.answer;
    const claim = claimed.claim;

    const result =
      cmd.body.action === 'REVERSE'
        ? await this.reverse(tx, ctx, scope, cmd, cmd.body, claim)
        : await this.post(tx, ctx, scope, cmd, cmd.body, claim);

    await tx
      .update(finIntakeRequests)
      .set({
        status: result.outcome === 'CANCELLED' ? 'POSTED' : 'POSTED',
        errorCode: null,
        errorParams: null,
        documentId: result.document ? Number.parseInt(result.document.id, 10) : null,
        result,
        lastAt: sql`now()`,
      })
      .where(
        and(
          eq(finIntakeRequests.companyId, scope.companyId),
          eq(finIntakeRequests.id, claim.requestId),
        ),
      );
    await tx.insert(finIntakeAttempts).values({
      tenantId: scope.tenantId,
      sourceSystemId: scope.sourceSystemId,
      companyId: scope.companyId,
      requestId: claim.requestId,
      commandId: cmd.commandId,
      payloadHash: hash,
      outcome: result.outcome,
      transport: via,
    });
    return result;
  }

  /** The company, the sending source system's id, the company's timezone and currency. */
  private async scope(tx: FinTx, ctx: FinCallContext, company: string): Promise<Scope> {
    const resolved = await resolveCompany(tx, ctx, company, {
      source: true,
      userAnyOf: POSTING_RIGHTS,
    });
    let sourceSystemId = resolved.sourceSystemId;
    if (sourceSystemId === null) {
      const [own] = await tx
        .select({ id: finSourceSystems.id })
        .from(finSourceSystems)
        .where(
          and(
            eq(finSourceSystems.tenantId, resolved.tenantId),
            eq(finSourceSystems.code, FIN_OWN_SOURCE),
          ),
        );
      if (!own) throw new FinError('FIN_SOURCE_NOT_GRANTED', undefined, { system: FIN_OWN_SOURCE });
      sourceSystemId = own.id;
    }
    const [company_] = await tx
      .select({ timezone: finCompanies.timezone, currency: finCompanies.functionalCurrency })
      .from(finCompanies)
      .where(eq(finCompanies.id, resolved.companyId));
    if (!company_) throw new FinError('FIN_COMPANY_UNKNOWN', undefined, { company });
    return { ...resolved, sourceSystemId, ...company_ };
  }

  /**
   * Claims the business key (ADR-0071 #2-#4): a new key is inserted, a known one locked FOR
   * UPDATE so a concurrent twin waits here. POSTED with the same hash (or written by a migration)
   * answers DUPLICATE; another hash or another company is a conflict; HELD or REJECTED takes the
   * new payload.
   */
  private async claim(
    tx: FinTx,
    key: KnownKey,
    via: FinIntakeVia,
  ): Promise<{ claim: Claim } | { answer: FinIntakeResult }> {
    const values = {
      tenantId: key.tenantId,
      companyId: key.companyId,
      sourceSystemId: key.sourceSystemId,
      sourceDocType: key.docType,
      sourceDocId: key.docId,
      revision: key.revision,
      action: key.action,
      sourceDocNo: key.cmd.source.docNo ?? null,
      contract: key.cmd.contract,
      lastCommandId: key.cmd.commandId,
      payload: key.cmd,
      payloadHash: key.hash,
      status: 'REJECTED' as const,
      via,
    };
    const [inserted] = await tx
      .insert(finIntakeRequests)
      .values(values)
      .onConflictDoNothing({
        target: [
          finIntakeRequests.tenantId,
          finIntakeRequests.sourceSystemId,
          finIntakeRequests.sourceDocType,
          finIntakeRequests.sourceDocId,
          finIntakeRequests.revision,
          finIntakeRequests.action,
        ],
      })
      .returning({ id: finIntakeRequests.id });
    if (inserted) {
      await this.assertRevision(tx, key);
      return { claim: { requestId: inserted.id } };
    }
    const [existing] = await tx
      .select({
        id: finIntakeRequests.id,
        companyId: finIntakeRequests.companyId,
        status: finIntakeRequests.status,
        payloadHash: finIntakeRequests.payloadHash,
        via: finIntakeRequests.via,
        result: finIntakeRequests.result,
      })
      .from(finIntakeRequests)
      .where(
        and(
          eq(finIntakeRequests.tenantId, key.tenantId),
          eq(finIntakeRequests.sourceSystemId, key.sourceSystemId),
          eq(finIntakeRequests.sourceDocType, key.docType),
          eq(finIntakeRequests.sourceDocId, key.docId),
          eq(finIntakeRequests.revision, key.revision),
          eq(finIntakeRequests.action, key.action),
        ),
      )
      .for('update');
    if (!existing) throw new Error('the intake key vanished while claimed');
    if (existing.companyId !== key.companyId) {
      throw new FinError('FIN_SOURCE_COMPANY_MISMATCH', undefined, { docId: key.docId });
    }
    if (existing.status === 'POSTED' || existing.via === 'MIGRATION') {
      if (existing.payloadHash !== key.hash) {
        throw new FinError('FIN_PAYLOAD_CONFLICT', undefined, { docId: key.docId });
      }
      await tx.insert(finIntakeAttempts).values({
        tenantId: key.tenantId,
        sourceSystemId: key.sourceSystemId,
        companyId: key.companyId,
        requestId: existing.id,
        commandId: key.cmd.commandId,
        payloadHash: key.hash,
        outcome: 'DUPLICATE',
        transport: via,
      });
      const stored = existing.result as FinIntakeResult;
      return { answer: { ...stored, commandId: key.cmd.commandId, outcome: 'DUPLICATE' } };
    }
    if (existing.status === 'CANCELLED') {
      throw new FinError('FIN_REVISION_NOT_ALLOWED', undefined, {
        docId: key.docId,
        status: 'CANCELLED',
      });
    }
    await tx
      .update(finIntakeRequests)
      .set({
        payload: key.cmd,
        payloadHash: key.hash,
        lastCommandId: key.cmd.commandId,
        sourceDocNo: key.cmd.source.docNo ?? null,
        contract: key.cmd.contract,
        attempts: sql`${finIntakeRequests.attempts} + 1`,
        lastAt: sql`now()`,
      })
      .where(
        and(eq(finIntakeRequests.companyId, key.companyId), eq(finIntakeRequests.id, existing.id)),
      );
    await this.assertRevision(tx, key);
    return { claim: { requestId: existing.id } };
  }

  /** Revision n + 1 of a document posts only once revision n is reversed or cancelled. */
  private async assertRevision(tx: FinTx, key: KnownKey): Promise<void> {
    if (key.action !== 'POST' || key.revision === 1) return;
    const [previous] = await tx
      .select({ status: finIntakeRequests.status, documentId: finIntakeRequests.documentId })
      .from(finIntakeRequests)
      .where(
        and(
          eq(finIntakeRequests.tenantId, key.tenantId),
          eq(finIntakeRequests.sourceSystemId, key.sourceSystemId),
          eq(finIntakeRequests.sourceDocType, key.docType),
          eq(finIntakeRequests.sourceDocId, key.docId),
          eq(finIntakeRequests.revision, key.revision - 1),
          eq(finIntakeRequests.action, 'POST'),
        ),
      );
    if (!previous) {
      throw new FinError('FIN_REVISION_NOT_ALLOWED', undefined, { revision: key.revision });
    }
    if (previous.status === 'CANCELLED') return;
    if (previous.status === 'POSTED' && previous.documentId !== null) {
      const [reversal] = await tx
        .select({ id: finDocuments.id })
        .from(finDocuments)
        .where(
          and(
            eq(finDocuments.companyId, key.companyId),
            eq(finDocuments.reversesDocumentId, previous.documentId),
          ),
        );
      if (reversal) return;
    }
    throw new FinError('FIN_REVISION_NOT_ALLOWED', undefined, { revision: key.revision });
  }

  // ---- POST -----------------------------------------------------------------------------------

  private async post(
    tx: FinTx,
    ctx: FinCallContext,
    scope: Scope,
    cmd: IntakeCommandV1,
    body: PostBody,
    claim: Claim,
  ): Promise<FinIntakeResult> {
    const type = await this.documentType(tx, scope, body.documentType);
    this.authorise(ctx, scope, type.class);
    if (type.sourceSystemId !== scope.sourceSystemId) {
      throw new FinError('FIN_DOCTYPE_UNKNOWN', undefined, { documentType: body.documentType });
    }
    if (body.currency !== scope.currency) {
      throw new FinError('FIN_CURRENCY_UNSUPPORTED', undefined, { currency: body.currency });
    }
    const accountingDate = body.accountingDate ?? body.documentDate;
    const today = businessDateIn(scope.timezone, new Date());
    if (body.documentDate > today || accountingDate > today) {
      throw new FinError('FIN_FUTURE_DATE', undefined, { path: 'body.documentDate' });
    }
    if (type.class === 'SETTLEMENT' || type.class === 'OPENING') {
      throw rule('CLASS_NOT_BUILT', { class: type.class });
    }
    const isAllocation = type.class === 'ALLOCATION';
    if (isAllocation !== (body.allocate !== undefined)) throw rule('ALLOCATION_BODY');
    if (scope.sourceSystemId !== (await this.ownSourceId(tx, scope)) && body.lines.some((l) => l.accountCode)) {
      throw rule('ACCOUNT_CODE_SOURCE');
    }

    const periodId = await openPeriodInTx(tx, scope.companyId, accountingDate);
    const branchId = body.branch === undefined ? null : await this.branchOf(tx, scope, body.branch);

    if (isAllocation && body.allocate) {
      return this.postAllocation(tx, ctx, scope, cmd, body, type, claim, periodId, branchId);
    }

    // Parties: inserted on first sight for a source, never for the core's screens; then locked.
    const headerParty = body.party ? await this.partyOf(tx, ctx, scope, body.party, 'body.party') : null;
    const lineParties = new Map<number, number>();
    for (const [index, line] of body.lines.entries()) {
      if (line.party) {
        lineParties.set(index, await this.partyOf(tx, ctx, scope, line.party, `body.lines.${index}.party`));
      }
    }
    // Money accounts FOR SHARE (by code, in id order).
    const moneyCodes = [...new Set(body.lines.flatMap((line) => (line.moneyAccount ? [line.moneyAccount] : [])))];
    const money = new Map<string, { id: number; accountId: number; status: string }>();
    if (moneyCodes.length) {
      const rows = await tx
        .select({
          id: finMoneyAccounts.id,
          code: finMoneyAccounts.code,
          accountId: finMoneyAccounts.accountId,
          status: finMoneyAccounts.status,
        })
        .from(finMoneyAccounts)
        .where(and(eq(finMoneyAccounts.companyId, scope.companyId), inArray(finMoneyAccounts.code, moneyCodes)))
        .orderBy(asc(finMoneyAccounts.id))
        .for('share');
      for (const row of rows) money.set(row.code, row);
    }

    const lines = await this.resolveLines(tx, scope, body, type, accountingDate, headerParty, lineParties, money);
    this.checkAmounts(body, lines);
    this.checkClass(type.class, headerParty, lines);

    await lockPartiesInTx(
      tx,
      scope.companyId,
      lines.flatMap((line) => (line.partyId === null ? [] : [line.partyId])),
    );

    // Settled targets, locked FOR UPDATE by (due date, id) once the parties are held.
    const settlements = await this.settleTargets(tx, scope, lines);

    // Numbers last (ADR-0071 #6): the document's (its own series, or the sender's), then the entry's.
    const number = await this.documentNumber(tx, scope, type, cmd, body.documentDate);
    const journalNo = await nextNumberInTx(tx, scope.companyId, FIN_SERIES.JOURNAL, accountingDate);
    const moneyLine = lines.find((line) => line.control === 'MONEY');
    const [document] = await tx
      .insert(finDocuments)
      .values({
        companyId: scope.companyId,
        branchId,
        documentTypeId: type.id,
        class: type.class,
        number,
        documentDate: body.documentDate,
        accountingDate,
        periodId,
        currency: body.currency,
        partyId: headerParty,
        dueDate: body.dueDate ?? null,
        amount: new Decimal(body.controlTotal),
        description: body.description.trim(),
        sourceSystemId: scope.sourceSystemId,
        sourceDocType: cmd.source.docType,
        sourceDocId: cmd.source.docId,
        sourceRevision: cmd.source.revision ?? 1,
        sourceDocNo: cmd.source.docNo ?? null,
        attributes: body.attributes ?? {},
        moneyAccountId:
          (type.class === 'RECEIPT' || type.class === 'PAYMENT') && moneyLine ? moneyLine.moneyAccountId : null,
        intakeRequestId: claim.requestId,
        actorKind: ctx.actor.kind,
        actorRef: ctx.actor.ref,
        actorLabel: ctx.actor.label,
        requestId: ctx.requestId,
      })
      .returning({ id: finDocuments.id });
    if (!document) throw new Error('fin document was not created');
    const entryId = await this.writeEntry(tx, ctx, scope, {
      number: journalNo,
      entryDate: accountingDate,
      periodId,
      sourceDocType: cmd.source.docType,
      sourceDocId: cmd.source.docId,
      reversesId: null,
      documentId: document.id,
      description: entryDescription(type.numberMode, number, body.description),
    });
    const lineIds = await this.writeLines(tx, scope, entryId, branchId, lines);

    // An item per party-control line (ADR-0072 #5), then what it settles.
    const touched: { partyId: number; accountId: number }[] = [];
    const itemOfLine = new Map<number, number>();
    for (const [index, line] of lines.entries()) {
      if (!PARTY_CONTROLS.has(line.control) || line.partyId === null) continue;
      const debit = line.input.side === 'DEBIT';
      const [item] = await tx
        .insert(finOpenItems)
        .values({
          companyId: scope.companyId,
          partyId: line.partyId,
          accountId: line.accountId,
          side: line.input.side,
          documentId: document.id,
          journalLineId: lineIds[index] ?? 0,
          sourceSystemId: scope.sourceSystemId,
          groupRef: line.input.openItem?.groupRef ?? null,
          itemRef: line.input.openItem?.itemRef ?? null,
          itemDate: line.input.openItem?.itemDate ?? accountingDate,
          dueDate: debit ? (line.input.openItem?.dueDate ?? body.dueDate ?? accountingDate) : (line.input.openItem?.dueDate ?? null),
          amount: line.amount,
          openAmount: line.amount,
        })
        .returning({ id: finOpenItems.id });
      if (!item) throw new Error('fin open item was not created');
      itemOfLine.set(index, item.id);
      touched.push({ partyId: line.partyId, accountId: line.accountId });
    }
    const allocationIds: number[] = [];
    for (const settlement of settlements) {
      const own = itemOfLine.get(settlement.lineIndex);
      if (own === undefined) throw new Error('a settling line without its item');
      let remaining = settlement.amount;
      for (const target of settlement.targets) {
        if (remaining.lte(0)) break;
        const take = target.amount === null ? Decimal.min(remaining, target.item.openAmount) : target.amount;
        if (take.lte(0)) continue;
        if (take.gt(target.item.openAmount) || take.gt(remaining)) {
          throw new FinError('FIN_OVER_ALLOCATION', undefined, {
            path: settlement.path,
            itemId: target.item.id,
          });
        }
        const debitItemId = settlement.side === 'DEBIT' ? own : target.item.id;
        const creditItemId = settlement.side === 'DEBIT' ? target.item.id : own;
        const written = await writeAllocationInTx(tx, {
          companyId: scope.companyId,
          partyId: target.item.partyId,
          accountId: target.item.accountId,
          debitItemId,
          creditItemId,
          amount: take,
          documentId: document.id,
        });
        allocationIds.push(written.id);
        target.item.openAmount = target.item.openAmount.minus(take);
        remaining = remaining.minus(take);
      }
    }
    await refreshPartyBalancesInTx(tx, scope.companyId, touched);
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'POST',
      entity: 'document',
      entityId: document.id,
      after: { type: type.code, number, source: `${cmd.source.system}/${cmd.source.docType}/${cmd.source.docId}` },
    });
    return this.result(tx, scope, cmd, 'POSTED', document.id, allocationIds);
  }

  /** An ALLOCATION (ADR-0072 #7): pairs existing items of the header party; no entry. */
  private async postAllocation(
    tx: FinTx,
    ctx: FinCallContext,
    scope: Scope,
    cmd: IntakeCommandV1,
    body: PostBody,
    type: DocType,
    claim: Claim,
    periodId: number,
    branchId: number | null,
  ): Promise<FinIntakeResult> {
    const allocate = body.allocate;
    if (!allocate) throw rule('ALLOCATION_BODY');
    if (!body.party) throw new FinError('FIN_PARTY_REQUIRED', undefined, { path: 'body.party' });
    const partyId = await this.existingParty(tx, scope, body.party.ref);
    if (partyId === null) {
      throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path: 'body.party' });
    }
    const accountingDate = body.accountingDate ?? body.documentDate;
    const accountId = await this.accountOfKey(tx, scope, allocate.key, accountingDate, type.code);
    let total = new Decimal(0);
    for (const pair of allocate.pairs) total = total.plus(pair.amount);
    if (!total.eq(body.controlTotal)) {
      throw new FinError('FIN_TOTAL_MISMATCH', undefined, {
        declared: body.controlTotal,
        debit: total.toFixed(2),
        credit: total.toFixed(2),
      });
    }
    await lockPartiesInTx(tx, scope.companyId, [partyId]);
    const refs = allocate.pairs.flatMap((pair) => [pair.debit, pair.credit]);
    const ids: number[] = [];
    for (const [index, ref] of refs.entries()) {
      const pairIndex = Math.floor(index / 2);
      const side = index % 2 === 0 ? 'debit' : 'credit';
      ids.push(await this.itemIdOf(tx, scope, ref, partyId, accountId, `body.allocate.pairs.${pairIndex}.${side}`));
    }
    const items = await this.lockItems(tx, scope.companyId, ids);
    const byId = new Map(items.map((item) => [item.id, item]));
    const writes: { debit: ItemRow; credit: ItemRow; amount: Decimal }[] = [];
    allocate.pairs.forEach((pair, index) => {
      const debit = byId.get(ids[index * 2] ?? 0);
      const credit = byId.get(ids[index * 2 + 1] ?? 0);
      if (!debit || !credit) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path: `body.allocate.pairs.${index}` });
      if (debit.side !== 'DEBIT' || credit.side !== 'CREDIT') throw rule('ALLOCATION_SIDES', { pair: index });
      if (debit.partyId !== partyId || credit.partyId !== partyId) {
        throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path: `body.allocate.pairs.${index}` });
      }
      if (debit.accountId !== accountId || credit.accountId !== accountId) {
        throw rule('ALLOCATION_ACCOUNT', { pair: index });
      }
      const amount = new Decimal(pair.amount);
      if (amount.gt(debit.openAmount) || amount.gt(credit.openAmount)) {
        throw new FinError('FIN_OVER_ALLOCATION', undefined, { path: `body.allocate.pairs.${index}.amount` });
      }
      debit.openAmount = debit.openAmount.minus(amount);
      credit.openAmount = credit.openAmount.minus(amount);
      writes.push({ debit, credit, amount });
    });
    const number = await this.documentNumber(tx, scope, type, cmd, body.documentDate);
    const [document] = await tx
      .insert(finDocuments)
      .values({
        companyId: scope.companyId,
        branchId,
        documentTypeId: type.id,
        class: type.class,
        number,
        documentDate: body.documentDate,
        accountingDate,
        periodId,
        currency: body.currency,
        partyId,
        dueDate: null,
        amount: total,
        description: body.description.trim(),
        sourceSystemId: scope.sourceSystemId,
        sourceDocType: cmd.source.docType,
        sourceDocId: cmd.source.docId,
        sourceRevision: cmd.source.revision ?? 1,
        sourceDocNo: cmd.source.docNo ?? null,
        attributes: body.attributes ?? {},
        intakeRequestId: claim.requestId,
        actorKind: ctx.actor.kind,
        actorRef: ctx.actor.ref,
        actorLabel: ctx.actor.label,
        requestId: ctx.requestId,
      })
      .returning({ id: finDocuments.id });
    if (!document) throw new Error('fin document was not created');
    const allocationIds: number[] = [];
    for (const write of writes) {
      const written = await writeAllocationInTx(tx, {
        companyId: scope.companyId,
        partyId,
        accountId,
        debitItemId: write.debit.id,
        creditItemId: write.credit.id,
        amount: write.amount,
        documentId: document.id,
      });
      allocationIds.push(written.id);
    }
    await refreshPartyBalancesInTx(tx, scope.companyId, [{ partyId, accountId }]);
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'POST',
      entity: 'document',
      entityId: document.id,
      after: { type: type.code, number, pairs: writes.length, amount: total.toFixed(2) },
    });
    return this.result(tx, scope, cmd, 'POSTED', document.id, allocationIds);
  }

  // ---- REVERSE --------------------------------------------------------------------------------

  /**
   * A REVERSE (ADR-0072 #11): the target's own allocations are undone, the mirror entry posts
   * dated the command's accounting date or today (never before the original), and each original
   * item is paired with its mirror. Refused while other allocations on its items are live. An
   * ALLOCATION's reversal undoes its pairs and posts no entry. A REVERSE of a HELD or REJECTED
   * target cancels it.
   */
  private async reverse(
    tx: FinTx,
    ctx: FinCallContext,
    scope: Scope,
    cmd: IntakeCommandV1,
    body: ReverseBody,
    claim: Claim,
  ): Promise<FinIntakeResult> {
    const [target] = await tx
      .select({
        id: finIntakeRequests.id,
        companyId: finIntakeRequests.companyId,
        status: finIntakeRequests.status,
        documentId: finIntakeRequests.documentId,
      })
      .from(finIntakeRequests)
      .where(
        and(
          eq(finIntakeRequests.tenantId, scope.tenantId),
          eq(finIntakeRequests.sourceSystemId, scope.sourceSystemId),
          eq(finIntakeRequests.sourceDocType, cmd.source.docType),
          eq(finIntakeRequests.sourceDocId, cmd.source.docId),
          eq(finIntakeRequests.revision, cmd.source.revision ?? 1),
          eq(finIntakeRequests.action, 'POST'),
        ),
      )
      .for('update');
    if (!target) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path: 'source' });
    if (target.companyId !== scope.companyId) {
      throw new FinError('FIN_SOURCE_COMPANY_MISMATCH', undefined, { docId: cmd.source.docId });
    }
    if (target.status === 'HELD' || target.status === 'REJECTED' || target.status === 'CANCELLED') {
      await tx
        .update(finIntakeRequests)
        .set({ status: 'CANCELLED', lastAt: sql`now()` })
        .where(and(eq(finIntakeRequests.companyId, scope.companyId), eq(finIntakeRequests.id, target.id)));
      return {
        contract: 'fin.intake/1',
        commandId: cmd.commandId,
        source: keyOf(cmd.source),
        action: 'REVERSE',
        outcome: 'CANCELLED',
      };
    }
    if (target.documentId === null) throw new Error('a POSTED request without its document');
    const [original] = await tx
      .select()
      .from(finDocuments)
      .where(and(eq(finDocuments.companyId, scope.companyId), eq(finDocuments.id, target.documentId)));
    if (!original) throw new Error('the reversed document vanished');
    const type = await this.documentTypeById(tx, scope, original.documentTypeId);
    this.authorise(ctx, scope, type.class);
    const today = businessDateIn(scope.timezone, new Date());
    const accountingDate = body.accountingDate ?? today;
    if (accountingDate < original.accountingDate) {
      throw invalid('body.accountingDate');
    }
    if (accountingDate > today) throw new FinError('FIN_FUTURE_DATE', undefined, { path: 'body.accountingDate' });
    const periodId = await openPeriodInTx(tx, scope.companyId, accountingDate);

    const originalItems = await tx
      .select(ITEM_COLUMNS)
      .from(finOpenItems)
      .where(and(eq(finOpenItems.companyId, scope.companyId), eq(finOpenItems.documentId, original.id)));
    // The allocations a document made itself, or (for an ALLOCATION) its pairs.
    const own = await this.liveAllocations(tx, scope.companyId, { documentId: original.id });
    const onItems =
      originalItems.length === 0
        ? []
        : await this.liveAllocations(tx, scope.companyId, { itemIds: originalItems.map((item) => item.id) });
    const ownIds = new Set(own.map((row) => row.id));
    const others = onItems.filter((row) => !ownIds.has(row.id));
    if (others.length > 0) {
      throw new FinError('FIN_REVERSAL_BLOCKED', undefined, { allocations: others.length });
    }
    const parties = new Set<number>([
      ...originalItems.map((item) => item.partyId),
      ...own.map((row) => row.partyId),
      ...(original.partyId === null ? [] : [original.partyId]),
    ]);
    await lockPartiesInTx(tx, scope.companyId, parties);
    const itemIds = [...new Set([...originalItems.map((item) => item.id), ...own.flatMap((row) => [row.debitItemId, row.creditItemId])])];
    await this.lockItems(tx, scope.companyId, itemIds);

    const journalNo =
      original.class === 'ALLOCATION'
        ? null
        : await nextNumberInTx(tx, scope.companyId, FIN_SERIES.JOURNAL, accountingDate);
    const reason = body.reason.trim();
    const [reversal] = await tx
      .insert(finDocuments)
      .values({
        companyId: scope.companyId,
        branchId: original.branchId,
        documentTypeId: original.documentTypeId,
        class: original.class,
        number: original.number,
        documentDate: accountingDate,
        accountingDate,
        periodId,
        currency: original.currency,
        partyId: original.partyId,
        dueDate: null,
        amount: original.amount,
        description: original.description,
        sourceSystemId: scope.sourceSystemId,
        sourceDocType: original.sourceDocType,
        sourceDocId: original.sourceDocId,
        sourceRevision: original.sourceRevision,
        sourceDocNo: original.sourceDocNo,
        attributes: {},
        moneyAccountId: original.moneyAccountId,
        intakeRequestId: claim.requestId,
        reversesDocumentId: original.id,
        reverseReason: reason,
        actorKind: ctx.actor.kind,
        actorRef: ctx.actor.ref,
        actorLabel: ctx.actor.label,
        requestId: ctx.requestId,
      })
      .returning({ id: finDocuments.id });
    if (!reversal) throw new Error('fin reversal document was not created');

    const allocationIds: number[] = [];
    const touched = new Map<string, { partyId: number; accountId: number }>();
    const touch = (partyId: number, accountId: number) => touched.set(`${partyId}:${accountId}`, { partyId, accountId });
    for (const row of own) {
      const undone = await writeAllocationInTx(tx, {
        companyId: scope.companyId,
        partyId: row.partyId,
        accountId: row.accountId,
        debitItemId: row.debitItemId,
        creditItemId: row.creditItemId,
        amount: row.amount,
        documentId: reversal.id,
        reversesAllocationId: row.id,
      });
      allocationIds.push(undone.id);
      touch(row.partyId, row.accountId);
    }

    if (original.class !== 'ALLOCATION' && journalNo !== null) {
      const [originalEntry] = await tx
        .select({ id: finJournalEntries.id, description: finJournalEntries.description })
        .from(finJournalEntries)
        .where(and(eq(finJournalEntries.companyId, scope.companyId), eq(finJournalEntries.documentId, original.id)));
      if (!originalEntry) throw new Error('the reversed document has no entry');
      const lines = await tx
        .select()
        .from(finJournalLines)
        .where(and(eq(finJournalLines.companyId, scope.companyId), eq(finJournalLines.entryId, originalEntry.id)))
        .orderBy(asc(finJournalLines.lineNo));
      const entryId = await this.writeEntry(tx, ctx, scope, {
        number: journalNo,
        entryDate: accountingDate,
        periodId,
        sourceDocType: original.sourceDocType,
        sourceDocId: original.sourceDocId,
        reversesId: originalEntry.id,
        documentId: reversal.id,
        description: originalEntry.description,
      });
      const inserted = await tx
        .insert(finJournalLines)
        .values(
          lines.map((line) => ({
            companyId: scope.companyId,
            entryId,
            lineNo: line.lineNo,
            accountId: line.accountId,
            debit: line.credit,
            credit: line.debit,
            partyId: line.partyId,
            moneyAccountId: line.moneyAccountId,
            branchId: line.branchId,
            postingKey: line.postingKey,
            postingRuleId: line.postingRuleId,
            taxCode: line.taxCode,
            taxBase: line.taxBase,
            description: line.description,
          })),
        )
        .returning({ id: finJournalLines.id, lineNo: finJournalLines.lineNo });
      const mirrorLine = new Map(inserted.map((row) => [row.lineNo, row.id]));
      const lineNoOf = new Map(lines.map((line) => [line.id, line.lineNo]));
      const itemLines = originalItems.length
        ? await tx
            .select({ id: finOpenItems.id, journalLineId: finOpenItems.journalLineId })
            .from(finOpenItems)
            .where(and(eq(finOpenItems.companyId, scope.companyId), inArray(finOpenItems.id, originalItems.map((item) => item.id))))
        : [];
      const lineOfItem = new Map(itemLines.map((row) => [row.id, row.journalLineId]));
      for (const item of originalItems) {
        const lineNo = lineNoOf.get(lineOfItem.get(item.id) ?? 0);
        const mirrorLineId = lineNo === undefined ? undefined : mirrorLine.get(lineNo);
        if (mirrorLineId === undefined) throw new Error('an item without its mirror line');
        const side = opposite(item.side);
        const [mirror] = await tx
          .insert(finOpenItems)
          .values({
            companyId: scope.companyId,
            partyId: item.partyId,
            accountId: item.accountId,
            side,
            documentId: reversal.id,
            journalLineId: mirrorLineId,
            sourceSystemId: scope.sourceSystemId,
            itemDate: accountingDate,
            dueDate: side === 'DEBIT' ? accountingDate : null,
            amount: item.amount,
            openAmount: item.amount,
          })
          .returning({ id: finOpenItems.id });
        if (!mirror) throw new Error('fin mirror item was not created');
        const paired = await writeAllocationInTx(tx, {
          companyId: scope.companyId,
          partyId: item.partyId,
          accountId: item.accountId,
          debitItemId: side === 'DEBIT' ? mirror.id : item.id,
          creditItemId: side === 'DEBIT' ? item.id : mirror.id,
          amount: item.amount,
          documentId: reversal.id,
          mirror: true,
        });
        allocationIds.push(paired.id);
        touch(item.partyId, item.accountId);
      }
    }
    await refreshPartyBalancesInTx(tx, scope.companyId, touched.values());
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'REVERSE',
      entity: 'document',
      entityId: original.id,
      after: { reversal: reversal.id, reason },
    });
    return this.result(tx, scope, cmd, 'POSTED', reversal.id, allocationIds);
  }

  // ---- helpers --------------------------------------------------------------------------------

  private authorise(ctx: FinCallContext, scope: Scope, documentClass: FinDocumentClass): void {
    if (ctx.principal.kind !== 'USER') return;
    const right = RIGHT_OF_CLASS[documentClass];
    if (!ctx.permissions.get(scope.companyCode)?.has(right)) {
      throw new FinError('FIN_COMPANY_FORBIDDEN', undefined, { company: scope.companyCode });
    }
  }

  private async ownSourceId(tx: FinTx, scope: Scope): Promise<number | null> {
    const [own] = await tx
      .select({ id: finSourceSystems.id })
      .from(finSourceSystems)
      .where(and(eq(finSourceSystems.tenantId, scope.tenantId), eq(finSourceSystems.code, FIN_OWN_SOURCE)));
    return own?.id ?? null;
  }

  private async documentType(tx: FinTx, scope: Scope, code: string): Promise<DocType> {
    const [row] = await tx
      .select({
        id: finDocumentTypes.id,
        code: finDocumentTypes.code,
        sourceSystemId: finDocumentTypes.sourceSystemId,
        class: finDocumentTypes.class,
        numberMode: finDocumentTypes.numberMode,
        numberSeries: finDocumentTypes.numberSeries,
        status: finDocumentTypes.status,
      })
      .from(finDocumentTypes)
      .where(and(eq(finDocumentTypes.companyId, scope.companyId), eq(finDocumentTypes.code, code)));
    if (!row || row.status !== 'ACTIVE') {
      throw new FinError('FIN_DOCTYPE_UNKNOWN', undefined, { documentType: code });
    }
    return row;
  }

  private async documentTypeById(tx: FinTx, scope: Scope, id: number): Promise<DocType> {
    const [row] = await tx
      .select({
        id: finDocumentTypes.id,
        code: finDocumentTypes.code,
        sourceSystemId: finDocumentTypes.sourceSystemId,
        class: finDocumentTypes.class,
        numberMode: finDocumentTypes.numberMode,
        numberSeries: finDocumentTypes.numberSeries,
        status: finDocumentTypes.status,
      })
      .from(finDocumentTypes)
      .where(and(eq(finDocumentTypes.companyId, scope.companyId), eq(finDocumentTypes.id, id)));
    if (!row) throw new Error(`document type ${id} vanished`);
    return row;
  }

  private async branchOf(tx: FinTx, scope: Scope, external: string): Promise<number> {
    const [row] = await tx
      .select({ branchId: finBranchRefs.branchId })
      .from(finBranchRefs)
      .where(
        and(
          eq(finBranchRefs.companyId, scope.companyId),
          eq(finBranchRefs.sourceSystemId, scope.sourceSystemId),
          eq(finBranchRefs.externalId, external),
        ),
      );
    if (!row) throw invalid('body.branch');
    return row.branchId;
  }

  /**
   * The party of a ref: a source's own ref (inserted on first sight, following the source's
   * facts); for the core's screens an existing party known by that ref to any source of the tenant.
   */
  private async partyOf(tx: FinTx, ctx: FinCallContext, scope: Scope, party: PartyIn, path: string): Promise<number> {
    if (ctx.principal.kind === 'SOURCE') {
      const made = await this.parties.upsertPartyInTx(tx, ctx, { company: scope.companyCode, party });
      return Number.parseInt(made.partyId, 10);
    }
    const found = await this.existingParty(tx, scope, party.ref);
    if (found === null) throw new FinError('FIN_PARTY_REQUIRED', undefined, { path });
    return found;
  }

  /** A party of the company known by `ref` (the core's own refs first, else exactly one source's). */
  private async existingParty(tx: FinTx, scope: Scope, ref: string): Promise<number | null> {
    const rows = await tx
      .select({ partyId: finPartyRefs.partyId, sourceSystemId: finPartyRefs.sourceSystemId })
      .from(finPartyRefs)
      .innerJoin(
        finPartyCompanies,
        and(eq(finPartyCompanies.partyId, finPartyRefs.partyId), eq(finPartyCompanies.companyId, scope.companyId)),
      )
      .where(and(eq(finPartyRefs.tenantId, scope.tenantId), eq(finPartyRefs.externalId, ref)));
    const own = rows.find((row) => row.sourceSystemId === scope.sourceSystemId);
    if (own) return own.partyId;
    const distinct = [...new Set(rows.map((row) => row.partyId))];
    return distinct.length === 1 ? (distinct[0] ?? null) : null;
  }

  /** The account a key's rule names on a date (the company default; ADR-0072 #2). */
  private async accountOfKey(tx: FinTx, scope: Scope, key: string, on: string, documentType: string): Promise<number> {
    const rules = await rulesOn(tx, scope.companyId, on);
    const found = rules.get(key);
    if (!found || found.accountId === null) {
      throw new FinError('FIN_MAPPING_MISSING', undefined, { key, documentType, branch: null });
    }
    return found.accountId;
  }

  private async resolveLines(
    tx: FinTx,
    scope: Scope,
    body: PostBody,
    type: DocType,
    accountingDate: string,
    headerParty: number | null,
    lineParties: Map<number, number>,
    money: Map<string, { id: number; accountId: number; status: string }>,
  ): Promise<ResolvedLine[]> {
    const keys = await tx
      .select({ code: finPostingKeys.code, requiresTaxCode: finPostingKeys.requiresTaxCode })
      .from(finPostingKeys)
      .where(eq(finPostingKeys.companyId, scope.companyId));
    const keyOf = new Map(keys.map((row) => [row.code, row]));
    const rules = await rulesOn(tx, scope.companyId, accountingDate);
    const codes = [...new Set(body.lines.flatMap((line) => (line.accountCode ? [line.accountCode] : [])))];
    const byCode = new Map<string, number>();
    if (codes.length) {
      for (const row of await tx
        .select({ id: finAccounts.id, code: finAccounts.code })
        .from(finAccounts)
        .where(and(eq(finAccounts.companyId, scope.companyId), inArray(finAccounts.code, codes)))) {
        byCode.set(row.code, row.id);
      }
    }
    const draft = body.lines.map((line, index) => {
      const path = `body.lines.${index}`;
      const key = keyOf.get(line.key);
      if (!key) throw new FinError('FIN_MAPPING_MISSING', undefined, { key: line.key, documentType: type.code, branch: body.branch ?? null });
      if (key.requiresTaxCode && !line.tax) {
        throw new FinError('FIN_TAX_CODE_UNKNOWN', undefined, { path: `${path}.tax` });
      }
      let accountId: number;
      let ruleId: number | null = null;
      let moneyAccountId: number | null = null;
      if (line.moneyAccount) {
        const account = money.get(line.moneyAccount);
        if (!account) throw invalid(`${path}.moneyAccount`);
        if (account.status !== 'ACTIVE') {
          throw new FinError('FIN_ACCOUNT_INACTIVE', undefined, { path: `${path}.moneyAccount` });
        }
        moneyAccountId = account.id;
        accountId = account.accountId;
        if (line.accountCode && byCode.get(line.accountCode) !== accountId) throw invalid(`${path}.accountCode`);
      } else if (line.accountCode) {
        const found = byCode.get(line.accountCode);
        if (found === undefined) throw invalid(`${path}.accountCode`);
        accountId = found;
      } else {
        const found = rules.get(line.key);
        if (!found || found.accountId === null) {
          throw new FinError('FIN_MAPPING_MISSING', undefined, { key: line.key, documentType: type.code, branch: body.branch ?? null });
        }
        accountId = found.accountId;
        ruleId = found.ruleId;
      }
      return { line, index, path, accountId, ruleId, moneyAccountId };
    });
    const accounts = new Map(
      (
        await tx
          .select({ id: finAccounts.id, code: finAccounts.code, control: finAccounts.control, status: finAccounts.status })
          .from(finAccounts)
          .where(and(eq(finAccounts.companyId, scope.companyId), inArray(finAccounts.id, [...new Set(draft.map((row) => row.accountId))])))
      ).map((row) => [row.id, row]),
    );
    return draft.map((row) => {
      const account = accounts.get(row.accountId);
      if (!account) throw invalid(`${row.path}.accountCode`);
      if (account.status !== 'ACTIVE') {
        throw new FinError('FIN_ACCOUNT_INACTIVE', undefined, { path: row.path, accountId: account.id });
      }
      const control = account.control;
      let partyId = lineParties.get(row.index) ?? null;
      if (PARTY_CONTROLS.has(control)) {
        partyId ??= headerParty;
        if (partyId === null) throw new FinError('FIN_PARTY_REQUIRED', undefined, { path: row.path });
      }
      if (control === 'MONEY' && row.moneyAccountId === null) {
        throw new FinError('FIN_MONEY_ACCOUNT_REQUIRED', undefined, { path: row.path });
      }
      if (row.line.settles && !PARTY_CONTROLS.has(control)) throw rule('SETTLES_PARTY_LINE', { line: row.line.lineNo });
      return {
        input: row.line,
        path: row.path,
        accountId: account.id,
        accountCode: account.code,
        control,
        ruleId: row.ruleId,
        partyId,
        moneyAccountId: row.moneyAccountId,
        amount: new Decimal(row.line.amount),
      };
    });
  }

  /** Σ debit = Σ credit = the declared control total, at scale 2 (never recomputed). */
  private checkAmounts(body: PostBody, lines: readonly ResolvedLine[]): void {
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    for (const line of lines) {
      if (line.input.side === 'DEBIT') debit = debit.plus(line.amount);
      else credit = credit.plus(line.amount);
    }
    if (!debit.eq(credit)) {
      throw new FinError('FIN_UNBALANCED', undefined, { debit: debit.toFixed(2), credit: credit.toFixed(2) });
    }
    if (!debit.eq(body.controlTotal)) {
      throw new FinError('FIN_TOTAL_MISMATCH', undefined, {
        declared: body.controlTotal,
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
      });
    }
  }

  /** The class rules of ADR-0072 #1. */
  private checkClass(documentClass: FinDocumentClass, headerParty: number | null, lines: readonly ResolvedLine[]): void {
    const controlled = lines.filter((line) => PARTY_CONTROLS.has(line.control));
    const onControl = (control: Control, side: Side) =>
      controlled.filter((line) => line.control === control && line.input.side === side);
    const settling = lines.filter((line) => line.input.settles !== undefined);
    const moneyLines = lines.filter((line) => line.control === 'MONEY');
    switch (documentClass) {
      case 'AR_INVOICE':
      case 'AP_BILL': {
        if (headerParty === null) throw new FinError('FIN_PARTY_REQUIRED', undefined, { path: 'body.party' });
        const control = documentClass === 'AR_INVOICE' ? 'RECEIVABLE' : 'PAYABLE';
        const side: Side = documentClass === 'AR_INVOICE' ? 'DEBIT' : 'CREDIT';
        if (onControl(control, side).length !== 1 || controlled.length !== 1) throw rule(`${documentClass}_LINES`);
        if (settling.length > 0) throw rule(`${documentClass}_SETTLES`);
        return;
      }
      case 'AR_CREDIT':
      case 'AP_CREDIT': {
        if (headerParty === null) throw new FinError('FIN_PARTY_REQUIRED', undefined, { path: 'body.party' });
        const control = documentClass === 'AR_CREDIT' ? 'RECEIVABLE' : 'PAYABLE';
        const side: Side = documentClass === 'AR_CREDIT' ? 'CREDIT' : 'DEBIT';
        if (onControl(control, side).length !== 1 || controlled.length !== 1) throw rule(`${documentClass}_LINES`);
        return;
      }
      case 'RECEIPT':
      case 'PAYMENT': {
        const side: Side = documentClass === 'RECEIPT' ? 'DEBIT' : 'CREDIT';
        if (moneyLines.length !== 1 || moneyLines[0]?.input.side !== side) throw rule(`${documentClass}_MONEY_LINE`);
        return;
      }
      case 'JOURNAL':
        if (settling.length > 0) throw rule('JOURNAL_SETTLES');
        return;
      default:
        throw rule('CLASS_NOT_BUILT', { class: documentClass });
    }
  }

  /** The items each settling line pairs with, locked FOR UPDATE by (due date, id). */
  private async settleTargets(
    tx: FinTx,
    scope: Scope,
    lines: readonly ResolvedLine[],
  ): Promise<
    {
      lineIndex: number;
      path: string;
      side: Side;
      amount: Decimal;
      targets: { item: ItemRow; amount: Decimal | null }[];
    }[]
  > {
    const result: {
      lineIndex: number;
      path: string;
      side: Side;
      amount: Decimal;
      targets: { item: ItemRow; amount: Decimal | null }[];
    }[] = [];
    for (const [lineIndex, line] of lines.entries()) {
      const settles = line.input.settles;
      if (!settles || line.partyId === null) continue;
      const targetSide = opposite(line.input.side);
      const scoped = and(
        eq(finOpenItems.companyId, scope.companyId),
        eq(finOpenItems.partyId, line.partyId),
        eq(finOpenItems.accountId, line.accountId),
        eq(finOpenItems.side, targetSide),
      ) as SQL;
      if (settles === 'FIFO') {
        const items = await tx
          .select(ITEM_COLUMNS)
          .from(finOpenItems)
          .where(and(scoped, sql`${finOpenItems.openAmount} > 0`))
          .orderBy(sql`coalesce(${finOpenItems.dueDate}, ${finOpenItems.itemDate})`, asc(finOpenItems.id))
          .for('update');
        result.push({
          lineIndex,
          path: `${line.path}.settles`,
          side: line.input.side,
          amount: line.amount,
          targets: items.map((item) => ({ item, amount: null })),
        });
        continue;
      }
      const ids: { ids: number[]; amount: Decimal | null; path: string }[] = [];
      for (const [index, target] of settles.entries()) {
        const path = `${line.path}.settles.${index}`;
        const found = await this.targetItems(tx, scope, target.target, scoped);
        if (found.length === 0) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path });
        ids.push({ ids: found, amount: target.amount === undefined ? null : new Decimal(target.amount), path });
      }
      const locked = await this.lockItems(tx, scope.companyId, ids.flatMap((row) => row.ids));
      const byId = new Map(locked.map((item) => [item.id, item]));
      const targets: { item: ItemRow; amount: Decimal | null }[] = [];
      let named = new Decimal(0);
      for (const row of ids) {
        const items = row.ids.flatMap((id) => {
          const item = byId.get(id);
          return item ? [item] : [];
        });
        if (row.amount === null) {
          for (const item of items) targets.push({ item, amount: null });
          continue;
        }
        // A named amount over a group or a document's items spreads oldest first within it.
        let left = row.amount;
        named = named.plus(row.amount);
        const open = items.reduce((sum, item) => sum.plus(item.openAmount), new Decimal(0));
        if (left.gt(open)) throw new FinError('FIN_OVER_ALLOCATION', undefined, { path: row.path });
        for (const item of items) {
          if (left.lte(0)) break;
          const take = Decimal.min(left, item.openAmount);
          if (take.gt(0)) targets.push({ item, amount: take });
          left = left.minus(take);
        }
      }
      if (named.gt(line.amount)) throw new FinError('FIN_OVER_ALLOCATION', undefined, { path: `${line.path}.settles` });
      result.push({ lineIndex, path: `${line.path}.settles`, side: line.input.side, amount: line.amount, targets });
    }
    return result;
  }

  /** The open items a settle target names, on the line's party, account and opposite side. */
  private async targetItems(tx: FinTx, scope: Scope, target: SettleTarget, scoped: SQL): Promise<number[]> {
    let where: SQL;
    if ('itemId' in target) {
      const id = Number.parseInt(target.itemId, 10);
      if (!Number.isSafeInteger(id)) return [];
      where = eq(finOpenItems.id, id);
    } else if ('groupRef' in target) {
      where = and(
        eq(finOpenItems.groupRef, target.groupRef),
        eq(finOpenItems.sourceSystemId, scope.sourceSystemId),
      ) as SQL;
    } else {
      const documentIds = await this.documentsOfKey(tx, scope, target);
      if (documentIds.length === 0) return [];
      where = inArray(finOpenItems.documentId, documentIds);
    }
    const rows = await tx
      .select({ id: finOpenItems.id })
      .from(finOpenItems)
      .where(and(scoped, where, sql`${finOpenItems.openAmount} > 0`))
      .orderBy(sql`coalesce(${finOpenItems.dueDate}, ${finOpenItems.itemDate})`, asc(finOpenItems.id));
    return rows.map((row) => row.id);
  }

  /** The live (not reversal) documents of a source key in the company. */
  private async documentsOfKey(tx: FinTx, scope: Scope, key: SourceKey): Promise<number[]> {
    const rows = await tx
      .select({ id: finDocuments.id })
      .from(finDocuments)
      .innerJoin(
        finSourceSystems,
        and(eq(finSourceSystems.id, finDocuments.sourceSystemId), eq(finSourceSystems.tenantId, scope.tenantId)),
      )
      .where(
        and(
          eq(finDocuments.companyId, scope.companyId),
          eq(finSourceSystems.code, key.system),
          eq(finDocuments.sourceDocType, key.docType),
          eq(finDocuments.sourceDocId, key.docId),
          eq(finDocuments.sourceRevision, key.revision ?? 1),
          isNull(finDocuments.reversesDocumentId),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** An allocation's item reference: an item id, or a document's item (its line number). */
  private async itemIdOf(
    tx: FinTx,
    scope: Scope,
    ref: ItemRefV1,
    partyId: number,
    accountId: number,
    path: string,
  ): Promise<number> {
    if ('itemId' in ref) {
      const id = Number.parseInt(ref.itemId, 10);
      if (!Number.isSafeInteger(id)) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path });
      const [row] = await tx
        .select({ id: finOpenItems.id })
        .from(finOpenItems)
        .where(and(eq(finOpenItems.companyId, scope.companyId), eq(finOpenItems.id, id)));
      if (!row) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path });
      return row.id;
    }
    const documentIds = await this.documentsOfKey(tx, scope, ref.source);
    if (documentIds.length === 0) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path });
    const rows = await tx
      .select({ id: finOpenItems.id, lineNo: finJournalLines.lineNo })
      .from(finOpenItems)
      .innerJoin(
        finJournalLines,
        and(eq(finJournalLines.companyId, finOpenItems.companyId), eq(finJournalLines.id, finOpenItems.journalLineId)),
      )
      .where(
        and(
          eq(finOpenItems.companyId, scope.companyId),
          inArray(finOpenItems.documentId, documentIds),
          eq(finOpenItems.partyId, partyId),
          eq(finOpenItems.accountId, accountId),
        ),
      );
    const chosen = ref.lineNo === undefined ? rows : rows.filter((row) => row.lineNo === ref.lineNo);
    if (chosen.length !== 1 || !chosen[0]) throw new FinError('FIN_SETTLE_TARGET_NOT_FOUND', undefined, { path });
    return chosen[0].id;
  }

  /** Locks items FOR UPDATE by (due date, id) and reads them. */
  private async lockItems(tx: FinTx, companyId: number, ids: readonly number[]): Promise<ItemRow[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return tx
      .select(ITEM_COLUMNS)
      .from(finOpenItems)
      .where(and(eq(finOpenItems.companyId, companyId), inArray(finOpenItems.id, unique)))
      .orderBy(sql`${finOpenItems.dueDate} NULLS LAST`, asc(finOpenItems.id))
      .for('update');
  }

  /** Allocations neither undone nor undoing, made by a document or touching these items. */
  private async liveAllocations(
    tx: FinTx,
    companyId: number,
    query: { documentId: number } | { itemIds: readonly number[] },
  ): Promise<
    { id: number; partyId: number; accountId: number; debitItemId: number; creditItemId: number; amount: Decimal }[]
  > {
    const filter =
      'documentId' in query
        ? eq(finAllocations.documentId, query.documentId)
        : (or(
            inArray(finAllocations.debitItemId, [...query.itemIds]),
            inArray(finAllocations.creditItemId, [...query.itemIds]),
          ) as SQL);
    return tx
      .select({
        id: finAllocations.id,
        partyId: finAllocations.partyId,
        accountId: finAllocations.accountId,
        debitItemId: finAllocations.debitItemId,
        creditItemId: finAllocations.creditItemId,
        amount: finAllocations.amount,
      })
      .from(finAllocations)
      .where(
        and(
          eq(finAllocations.companyId, companyId),
          filter,
          isNull(finAllocations.reversesAllocationId),
          eq(finAllocations.mirror, false),
          sql`NOT EXISTS (SELECT 1 FROM fin.allocations u WHERE u.company_id = ${finAllocations.companyId} AND u.reverses_allocation_id = ${finAllocations.id})`,
        ),
      )
      .orderBy(asc(finAllocations.id));
  }

  private async documentNumber(
    tx: FinTx,
    scope: Scope,
    type: DocType,
    cmd: IntakeCommandV1,
    documentDate: string,
  ): Promise<string> {
    if (type.numberMode === 'SOURCE') {
      const number = cmd.source.docNo?.trim();
      if (!number) throw invalid('source.docNo');
      return number;
    }
    if (!type.numberSeries) throw new FinError('FIN_DOCTYPE_UNKNOWN', undefined, { documentType: type.code });
    return nextNumberInTx(tx, scope.companyId, type.numberSeries, documentDate);
  }

  private async writeEntry(
    tx: FinTx,
    ctx: FinCallContext,
    scope: Scope,
    entry: {
      number: string;
      entryDate: string;
      periodId: number;
      sourceDocType: string;
      sourceDocId: string;
      reversesId: number | null;
      documentId: number;
      description: string;
    },
  ): Promise<number> {
    const [row] = await tx
      .insert(finJournalEntries)
      .values({
        companyId: scope.companyId,
        number: entry.number,
        entryDate: entry.entryDate,
        periodId: entry.periodId,
        sourceSystemId: scope.sourceSystemId,
        sourceDocType: entry.sourceDocType,
        sourceDocId: entry.sourceDocId,
        reversesId: entry.reversesId,
        documentId: entry.documentId,
        description: entry.description.slice(0, 500),
        actorKind: ctx.actor.kind,
        actorRef: ctx.actor.ref,
        actorLabel: ctx.actor.label,
        requestId: ctx.requestId,
      })
      .returning({ id: finJournalEntries.id });
    if (!row) throw new Error('fin journal entry was not created');
    return row.id;
  }

  private async writeLines(
    tx: FinTx,
    scope: Scope,
    entryId: number,
    branchId: number | null,
    lines: readonly ResolvedLine[],
  ): Promise<number[]> {
    const zero = new Decimal(0);
    const rows = await tx
      .insert(finJournalLines)
      .values(
        lines.map((line) => ({
          companyId: scope.companyId,
          entryId,
          lineNo: line.input.lineNo,
          accountId: line.accountId,
          debit: line.input.side === 'DEBIT' ? line.amount : zero,
          credit: line.input.side === 'CREDIT' ? line.amount : zero,
          partyId: line.partyId,
          moneyAccountId: line.moneyAccountId,
          branchId,
          postingKey: line.input.key,
          postingRuleId: line.ruleId,
          taxCode: line.input.tax?.code ?? null,
          taxBase: line.input.tax ? new Decimal(line.input.tax.base) : null,
          description: line.input.description?.trim() || null,
        })),
      )
      .returning({ id: finJournalLines.id, lineNo: finJournalLines.lineNo });
    const byLineNo = new Map(rows.map((row) => [row.lineNo, row.id]));
    return lines.map((line) => byLineNo.get(line.input.lineNo) ?? 0);
  }

  /** The stored and returned result: the document as booked (ADR-0071 #1). */
  private async result(
    tx: FinTx,
    scope: Scope,
    cmd: IntakeCommandV1,
    outcome: IntakeOutcome,
    documentId: number,
    allocationIds: readonly number[],
  ): Promise<FinIntakeResult> {
    const [document] = await tx
      .select({
        id: finDocuments.id,
        number: finDocuments.number,
        amount: finDocuments.amount,
        accountingDate: finDocuments.accountingDate,
        period: finFiscalPeriods.code,
      })
      .from(finDocuments)
      .innerJoin(
        finFiscalPeriods,
        and(eq(finFiscalPeriods.companyId, finDocuments.companyId), eq(finFiscalPeriods.id, finDocuments.periodId)),
      )
      .where(and(eq(finDocuments.companyId, scope.companyId), eq(finDocuments.id, documentId)));
    if (!document) throw new Error('the posted document vanished');
    const [entry] = await tx
      .select({ id: finJournalEntries.id, number: finJournalEntries.number })
      .from(finJournalEntries)
      .where(and(eq(finJournalEntries.companyId, scope.companyId), eq(finJournalEntries.documentId, documentId)));
    const lines = entry
      ? await tx
          .select({
            lineNo: finJournalLines.lineNo,
            account: finAccounts.code,
            ruleId: finJournalLines.postingRuleId,
            debit: finJournalLines.debit,
            credit: finJournalLines.credit,
          })
          .from(finJournalLines)
          .innerJoin(finAccounts, and(eq(finAccounts.companyId, finJournalLines.companyId), eq(finAccounts.id, finJournalLines.accountId)))
          .where(and(eq(finJournalLines.companyId, scope.companyId), eq(finJournalLines.entryId, entry.id)))
          .orderBy(asc(finJournalLines.lineNo))
      : [];
    const items = await tx
      .select({
        id: finOpenItems.id,
        key: finJournalLines.postingKey,
        side: finOpenItems.side,
        amount: finOpenItems.amount,
        openAmount: finOpenItems.openAmount,
      })
      .from(finOpenItems)
      .innerJoin(finJournalLines, and(eq(finJournalLines.companyId, finOpenItems.companyId), eq(finJournalLines.id, finOpenItems.journalLineId)))
      .where(and(eq(finOpenItems.companyId, scope.companyId), eq(finOpenItems.documentId, documentId)))
      .orderBy(asc(finOpenItems.id));
    const allocations = allocationIds.length
      ? await tx
          .select({
            debitItemId: finAllocations.debitItemId,
            creditItemId: finAllocations.creditItemId,
            amount: finAllocations.amount,
          })
          .from(finAllocations)
          .where(and(eq(finAllocations.companyId, scope.companyId), inArray(finAllocations.id, [...allocationIds])))
          .orderBy(asc(finAllocations.id))
      : [];
    const [reversal] = await tx
      .select({ id: finDocuments.id })
      .from(finDocuments)
      .where(and(eq(finDocuments.companyId, scope.companyId), eq(finDocuments.reversesDocumentId, documentId)));
    return {
      contract: 'fin.intake/1',
      commandId: cmd.commandId,
      source: keyOf(cmd.source),
      action: cmd.body.action,
      outcome,
      document: {
        id: String(document.id),
        number: document.number,
        journalNo: entry?.number ?? null,
        journalEntryId: entry ? String(entry.id) : null,
        amount: document.amount.toFixed(2),
        accountingDate: document.accountingDate,
        period: document.period,
        reversed: reversal !== undefined,
        lines: lines.map((line) => ({
          lineNo: line.lineNo,
          account: line.account,
          ruleId: line.ruleId === null ? null : String(line.ruleId),
          side: line.debit.gt(0) ? 'DEBIT' : 'CREDIT',
          amount: (line.debit.gt(0) ? line.debit : line.credit).toFixed(2),
        })),
        openItems: items.map((item) => ({
          id: String(item.id),
          key: item.key ?? '',
          side: item.side,
          amount: item.amount.toFixed(2),
          openAmount: item.openAmount.toFixed(2),
        })),
        allocations: allocations.map((row) => ({
          debitItemId: String(row.debitItemId),
          creditItemId: String(row.creditItemId),
          amount: row.amount.toFixed(2),
        })),
      },
    };
  }

  /** A refusal of `submit` kept on its key with an attempt row (its own short transaction). */
  private async recordRefusal(key: KnownKey, error: FinError, via: FinIntakeVia): Promise<void> {
    const code = error.code as FinErrorCode;
    const conflict = code === 'FIN_PAYLOAD_CONFLICT' || code === 'FIN_SOURCE_COMPANY_MISMATCH';
    const held = (FIN_HELD_CODES as readonly string[]).includes(code);
    const outcome: IntakeOutcome = conflict ? 'CONFLICT' : held ? 'HELD' : 'REJECTED';
    const params = isCodedError(error) ? (error.params ?? {}) : {};
    await this.db.transaction(async (tx) => {
      let requestId: number | null = null;
      if (!conflict && code !== 'FIN_REVISION_NOT_ALLOWED') {
        const status = held ? ('HELD' as const) : ('REJECTED' as const);
        const [row] = await tx
          .insert(finIntakeRequests)
          .values({
            tenantId: key.tenantId,
            companyId: key.companyId,
            sourceSystemId: key.sourceSystemId,
            sourceDocType: key.docType,
            sourceDocId: key.docId,
            revision: key.revision,
            action: key.action,
            sourceDocNo: key.cmd.source.docNo ?? null,
            contract: key.cmd.contract,
            lastCommandId: key.cmd.commandId,
            payload: key.cmd,
            payloadHash: key.hash,
            status,
            errorCode: code,
            errorParams: params,
            via,
          })
          .onConflictDoUpdate({
            target: [
              finIntakeRequests.tenantId,
              finIntakeRequests.sourceSystemId,
              finIntakeRequests.sourceDocType,
              finIntakeRequests.sourceDocId,
              finIntakeRequests.revision,
              finIntakeRequests.action,
            ],
            set: {
              payload: key.cmd,
              payloadHash: key.hash,
              lastCommandId: key.cmd.commandId,
              status,
              errorCode: code,
              errorParams: params,
              attempts: sql`${finIntakeRequests.attempts} + 1`,
              lastAt: sql`now()`,
            },
            setWhere: sql`${finIntakeRequests.status} IN ('HELD', 'REJECTED')`,
          })
          .returning({ id: finIntakeRequests.id });
        requestId = row?.id ?? null;
      }
      if (requestId === null) {
        const [row] = await tx
          .select({ id: finIntakeRequests.id, companyId: finIntakeRequests.companyId })
          .from(finIntakeRequests)
          .where(
            and(
              eq(finIntakeRequests.tenantId, key.tenantId),
              eq(finIntakeRequests.sourceSystemId, key.sourceSystemId),
              eq(finIntakeRequests.sourceDocType, key.docType),
              eq(finIntakeRequests.sourceDocId, key.docId),
              eq(finIntakeRequests.revision, key.revision),
              eq(finIntakeRequests.action, key.action),
            ),
          );
        requestId = row && row.companyId === key.companyId ? row.id : null;
      }
      await tx.insert(finIntakeAttempts).values({
        tenantId: key.tenantId,
        sourceSystemId: key.sourceSystemId,
        companyId: requestId === null ? null : key.companyId,
        requestId,
        commandId: key.cmd.commandId,
        payloadHash: key.hash,
        outcome,
        errorCode: code,
        transport: via,
      });
    });
  }
}

interface KnownKey {
  tenantId: number;
  companyId: number;
  sourceSystemId: number;
  docType: string;
  docId: string;
  revision: number;
  action: 'POST' | 'REVERSE';
  cmd: IntakeCommandV1;
  hash: string;
}

function keyOf(source: SourceKey): SourceKey {
  return {
    system: source.system,
    docType: source.docType,
    docId: source.docId,
    revision: source.revision ?? 1,
  };
}

/** A CORE-numbered document's entry is described «number — description»; a source's as it says. */
export function entryDescription(mode: 'SOURCE' | 'CORE', number: string, description: string): string {
  const text = description.trim();
  return mode === 'CORE' ? `${number} — ${text}` : text;
}
