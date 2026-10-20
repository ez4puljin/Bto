import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { type CompanyScope, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import type { FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { type FinRuleView, rulesOn } from '../ledger/chart.service';
import { openPeriodInTx } from '../ledger/periods';
import {
  finAccounts,
  finJournalEntries,
  finJournalLines,
  finMoneyAccounts,
  finSourceSystems,
} from '../schema';

/** The core's own screens post as source FIN (ADR-0070 #6); a USER principal posts through it. */
export const FIN_OWN_SOURCE = 'FIN';

const MONEY_SCALE = 2;
const MAX_LINES = 500;
const MAX_TEXT = 500;

/**
 * One line of an entry. The account is, in order: `accountId` when given (a manual entry, a
 * voucher's other account), else the money account's when `moneyAccountId` is given, else the
 * company-default rule of `key` on the entry date. `key` is stored on the line whichever decides.
 */
export interface FinEntryLineIn {
  key?: string | null;
  accountId?: number | null;
  moneyAccountId?: number | null;
  /** A party of the company (`FinPartyRef.partyId`). */
  partyId?: string | null;
  debit: Decimal;
  credit: Decimal;
  description?: string | null;
}

export interface FinEntryIn {
  company: string;
  /** The entry's number, from the source's series until F2 brings the core's (ADR-0089 #4). */
  number: string;
  /** A business date `YYYY-MM-DD` in the company's timezone. */
  entryDate: string;
  description: string;
  /** The source document (`INVOICE` / `<id>`); none for an entry typed on the core's screens. */
  sourceDoc?: { type: string; id: string } | null;
  lines: readonly FinEntryLineIn[];
}

export interface FinEntryRef {
  id: number;
  number: string;
}

function invalid(path: string): FinError {
  return new FinError('FIN_PAYLOAD_INVALID', undefined, { path });
}

/**
 * F1's posting façade (ADR-0089; ADR-0083 #2): Bto's journal writers post balanced entries into
 * the core inside their own transaction until F2's intake (`submitInTx`) replaces it. The checks
 * here repeat at commit in the database (the deferred balance trigger, the composite keys, UNIQUE
 * `(company_id, reverses_id)`). ESLint lets only `modules/finance` import it.
 */
@Injectable()
export class FinJournalPosting {
  /** Posts an entry inside the caller's transaction. */
  async postEntryInTx(tx: FinTx, ctx: FinCallContext, input: FinEntryIn): Promise<FinEntryRef> {
    const scope = await this.scope(tx, ctx, input.company);
    return this.insert(tx, ctx, scope, input, null);
  }

  /**
   * Reverses an entry: its lines with the sides swapped, dated `entryDate`, naming the original and
   * keeping its source document. An entry is reversed once (the unique key refuses a second one).
   */
  async reverseEntryInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: {
      company: string;
      entryId: number;
      number: string;
      entryDate: string;
      description: string;
    },
  ): Promise<FinEntryRef> {
    const scope = await this.scope(tx, ctx, input.company);
    const [original] = await tx
      .select({
        id: finJournalEntries.id,
        sourceDocType: finJournalEntries.sourceDocType,
        sourceDocId: finJournalEntries.sourceDocId,
      })
      .from(finJournalEntries)
      .where(
        and(
          eq(finJournalEntries.companyId, scope.companyId),
          eq(finJournalEntries.id, input.entryId),
        ),
      );
    if (!original) throw invalid('entryId');
    const lines = await tx
      .select()
      .from(finJournalLines)
      .where(
        and(
          eq(finJournalLines.companyId, scope.companyId),
          eq(finJournalLines.entryId, original.id),
        ),
      )
      .orderBy(asc(finJournalLines.lineNo));
    return this.insert(
      tx,
      ctx,
      scope,
      {
        company: input.company,
        number: input.number,
        entryDate: input.entryDate,
        description: input.description,
        sourceDoc:
          original.sourceDocType === null || original.sourceDocId === null
            ? null
            : { type: original.sourceDocType, id: original.sourceDocId },
        lines: lines.map((line) => ({
          key: line.postingKey,
          accountId: line.accountId,
          moneyAccountId: line.moneyAccountId,
          partyId: line.partyId === null ? null : String(line.partyId),
          debit: line.credit,
          credit: line.debit,
          description: line.description,
        })),
      },
      original.id,
    );
  }

  private async scope(tx: FinTx, ctx: FinCallContext, company: string): Promise<CompanyScope> {
    const scope = await resolveCompany(tx, ctx, company, {
      source: true,
      userAnyOf: ['finance.journal.manage'],
    });
    if (scope.sourceSystemId !== null) return scope;
    const [own] = await tx
      .select({ id: finSourceSystems.id })
      .from(finSourceSystems)
      .where(
        and(
          eq(finSourceSystems.tenantId, scope.tenantId),
          eq(finSourceSystems.code, FIN_OWN_SOURCE),
        ),
      );
    if (!own) throw new FinError('FIN_SOURCE_NOT_GRANTED', undefined, { system: FIN_OWN_SOURCE });
    return { ...scope, sourceSystemId: own.id };
  }

  private async insert(
    tx: FinTx,
    ctx: FinCallContext,
    scope: CompanyScope,
    input: FinEntryIn,
    reversesId: number | null,
  ): Promise<FinEntryRef> {
    const number = input.number.trim();
    if (number.length < 1 || number.length > 64) throw invalid('number');
    const description = input.description.trim();
    if (description.length < 1 || description.length > MAX_TEXT) throw invalid('description');
    if (input.sourceDoc && (input.sourceDoc.type.length === 0 || input.sourceDoc.id.length === 0)) {
      throw invalid('sourceDoc');
    }
    const { lines } = input;
    if (lines.length < 2) throw invalid('lines');
    if (lines.length > MAX_LINES) throw invalid('lines');
    let debit = new Decimal(0);
    let credit = new Decimal(0);
    lines.forEach((line, index) => {
      for (const [side, value] of [
        ['debit', line.debit],
        ['credit', line.credit],
      ] as const) {
        if (!Decimal.isDecimal(value) || value.isNegative())
          throw invalid(`lines[${index}].${side}`);
        if (value.decimalPlaces() > MONEY_SCALE) {
          throw new FinError('FIN_AMOUNT_PRECISION', undefined, {
            path: `lines[${index}].${side}`,
          });
        }
      }
      if (line.debit.isZero() === line.credit.isZero()) throw invalid(`lines[${index}]`);
      if (line.description != null && line.description.trim().length > MAX_TEXT) {
        throw invalid(`lines[${index}].description`);
      }
      debit = debit.plus(line.debit);
      credit = credit.plus(line.credit);
    });
    if (!debit.eq(credit)) {
      throw new FinError('FIN_UNBALANCED', undefined, {
        debit: debit.toFixed(MONEY_SCALE),
        credit: credit.toFixed(MONEY_SCALE),
      });
    }

    const resolved = await this.accountsOf(tx, scope.companyId, input.entryDate, lines);
    const periodId = await openPeriodInTx(tx, scope.companyId, input.entryDate);
    const [entry] = await tx
      .insert(finJournalEntries)
      .values({
        companyId: scope.companyId,
        number,
        entryDate: input.entryDate,
        periodId,
        sourceSystemId: scope.sourceSystemId ?? 0,
        sourceDocType: input.sourceDoc?.type ?? null,
        sourceDocId: input.sourceDoc?.id ?? null,
        reversesId,
        description,
        actorKind: ctx.actor.kind,
        actorRef: ctx.actor.ref,
        actorLabel: ctx.actor.label,
        requestId: ctx.requestId,
      })
      .returning({ id: finJournalEntries.id });
    if (!entry) throw new Error('fin journal entry was not created');
    await tx.insert(finJournalLines).values(
      lines.map((line, index) => ({
        companyId: scope.companyId,
        entryId: entry.id,
        lineNo: index + 1,
        accountId: resolved[index]?.accountId ?? 0,
        debit: line.debit,
        credit: line.credit,
        partyId: line.partyId == null ? null : Number.parseInt(line.partyId, 10),
        moneyAccountId: line.moneyAccountId ?? null,
        postingKey: line.key ?? null,
        postingRuleId: resolved[index]?.ruleId ?? null,
        description: line.description?.trim() || null,
      })),
    );
    return { id: entry.id, number };
  }

  /** Each line's account (and the rule that chose it); every account must be ACTIVE. */
  private async accountsOf(
    tx: FinTx,
    companyId: number,
    entryDate: string,
    lines: readonly FinEntryLineIn[],
  ): Promise<{ accountId: number; ruleId: number | null }[]> {
    const moneyIds = [
      ...new Set(
        lines.flatMap((line) => (line.moneyAccountId == null ? [] : [line.moneyAccountId])),
      ),
    ];
    const money = new Map(
      moneyIds.length
        ? (
            await tx
              .select({ id: finMoneyAccounts.id, accountId: finMoneyAccounts.accountId })
              .from(finMoneyAccounts)
              .where(
                and(
                  eq(finMoneyAccounts.companyId, companyId),
                  inArray(finMoneyAccounts.id, moneyIds),
                ),
              )
          ).map((row) => [row.id, row.accountId])
        : [],
    );
    const needRules = lines.some((line) => line.accountId == null && line.moneyAccountId == null);
    const rules: Map<string, FinRuleView> = needRules
      ? await rulesOn(tx, companyId, entryDate)
      : new Map<string, FinRuleView>();
    const resolved = lines.map((line, index) => {
      if (line.accountId != null) return { accountId: line.accountId, ruleId: null };
      if (line.moneyAccountId != null) {
        const accountId = money.get(line.moneyAccountId);
        if (accountId === undefined) throw invalid(`lines[${index}].moneyAccountId`);
        return { accountId, ruleId: null };
      }
      if (!line.key) throw invalid(`lines[${index}].key`);
      const rule = rules.get(line.key);
      if (!rule || rule.accountId === null) {
        throw new FinError('FIN_MAPPING_MISSING', undefined, { key: line.key });
      }
      return { accountId: rule.accountId, ruleId: rule.ruleId };
    });
    const accountIds = [...new Set(resolved.map((row) => row.accountId))];
    const accounts = new Map(
      (
        await tx
          .select({ id: finAccounts.id, status: finAccounts.status })
          .from(finAccounts)
          .where(and(eq(finAccounts.companyId, companyId), inArray(finAccounts.id, accountIds)))
      ).map((row) => [row.id, row.status]),
    );
    resolved.forEach((row, index) => {
      const status = accounts.get(row.accountId);
      if (status === undefined) throw invalid(`lines[${index}].accountId`);
      if (status !== 'ACTIVE') {
        throw new FinError('FIN_ACCOUNT_INACTIVE', undefined, {
          path: `lines[${index}].accountId`,
          accountId: row.accountId,
        });
      }
    });
    return resolved;
  }
}
