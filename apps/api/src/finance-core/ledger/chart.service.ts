import { Inject, Injectable } from '@nestjs/common';
import type { FinPermission } from '@tugeel/fin-contract';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import { type CompanyScope, type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb, type FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import {
  FIN_ACCOUNT_KINDS,
  FIN_MONEY_ACCOUNT_KINDS,
  type FIN_SIDES,
  FIN_STATUSES,
  finAccounts,
  finBranchRefs,
  finMoneyAccounts,
  finPostingKeys,
  finPostingRules,
  finSourceSystems,
} from '../schema';
import type { FinAccountControl } from '../org/ensure-default-company';

export type FinAccountKind = (typeof FIN_ACCOUNT_KINDS)[number];
export type FinSide = (typeof FIN_SIDES)[number];
export type FinMoneyAccountKind = (typeof FIN_MONEY_ACCOUNT_KINDS)[number];
export type FinStatus = (typeof FIN_STATUSES)[number];

export interface FinAccountView {
  id: number;
  code: string;
  name: string;
  kind: FinAccountKind;
  normalSide: FinSide;
  control: FinAccountControl;
  status: FinStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** A posting key's company-default rule in force on a date; `accountId` null = no account. */
export interface FinRuleView {
  key: string;
  ruleId: number;
  accountId: number | null;
  effectiveFrom: string;
}

/** A source system's own id of a branch (Bto: `identity.branches.id`). */
export interface FinBranchRef {
  system: string;
  externalId: string;
}

export interface FinMoneyAccountView {
  id: number;
  code: string;
  name: string;
  kind: FinMoneyAccountKind;
  /** The branch's refs, so each source finds its own id; empty without a branch. */
  branchRefs: FinBranchRef[];
  accountId: number;
  accountCode: string;
  accountName: string;
  bankName: string | null;
  bankAccountNo: string | null;
  showToCustomers: boolean;
  status: FinStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinMoneyAccountInput {
  code: string;
  name: string;
  kind: FinMoneyAccountKind;
  /** The branch by a source's ref; it must be mapped in the company (null: no branch). */
  branch: FinBranchRef | null;
  accountId: number;
  bankName: string | null;
  bankAccountNo: string | null;
  showToCustomers: boolean;
}

export interface FinMoneyAccountPatch extends Partial<Omit<FinMoneyAccountInput, 'kind'>> {
  status?: FinStatus;
}

/** One account of a chart template, with the posting key its rule maps (if any). */
export interface FinChartTemplateAccount {
  code: string;
  name: string;
  kind: FinAccountKind;
  normalSide: FinSide;
  control: FinAccountControl;
  key: string | null;
}

/** The date a seeded rule is in force from: the beginning of the books. */
export const FIN_RULES_FROM_START = '2000-01-01';

/** pg_advisory_xact_lock key per company for rule changes (the role dialog's check-then-insert). */
const RULES_LOCK = 72_026_132;

const READ: FinPermission[] = ['finance.read'];
const CHART_WRITE: FinPermission[] = ['finance.config.manage', 'finance.journal.manage'];
const RULE_WRITE: FinPermission[] = ['finance.config.manage', 'finance.settings.manage'];
const MONEY_WRITE: FinPermission[] = ['finance.config.manage', 'finance.settings.manage'];

function invalid(path: string): FinError {
  return new FinError('FIN_PAYLOAD_INVALID', undefined, { path });
}

function normalSideOf(kind: FinAccountKind): FinSide {
  return kind === 'ASSET' || kind === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

function trimmed(value: string, path: string, max: number): string {
  const text = value.trim();
  if (text.length < 1 || text.length > max) throw invalid(path);
  return text;
}

function optional(value: string | null | undefined, path: string, max: number): string | null {
  const text = value?.trim() ?? '';
  if (text.length === 0) return null;
  if (text.length > max) throw invalid(path);
  return text;
}

/**
 * A company's chart, posting rules and money accounts (ADR-0072, ADR-0089): read by any granted
 * source or a user with `finance.read`; changed by a user with the right of today's screens
 * (accounts: `finance.journal.manage`; rules and money accounts: `finance.settings.manage`) or
 * `finance.config.manage`. Rules are append-only: a change is a new row from a date.
 */
@Injectable()
export class FinChartService {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  async accounts(
    ctx: FinCallContext,
    query: { company: string },
    executor: FinExecutor = this.db,
  ): Promise<FinAccountView[]> {
    const scope = await this.read(executor, ctx, query.company);
    return executor
      .select(accountColumns)
      .from(finAccounts)
      .where(eq(finAccounts.companyId, scope.companyId))
      .orderBy(asc(finAccounts.code));
  }

  /** These accounts of the company, by id (missing ids are left out). */
  async accountsByIds(
    ctx: FinCallContext,
    query: { company: string; ids: readonly number[] },
    executor: FinExecutor = this.db,
  ): Promise<Map<number, FinAccountView>> {
    const scope = await this.read(executor, ctx, query.company);
    const ids = [...new Set(query.ids)];
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select(accountColumns)
      .from(finAccounts)
      .where(and(eq(finAccounts.companyId, scope.companyId), inArray(finAccounts.id, ids)));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** A new account inside the caller's transaction, its normal side from its kind. */
  async createAccountInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; code: string; name: string; kind: FinAccountKind },
  ): Promise<FinAccountView> {
    const code = trimmed(input.code, 'code', 64);
    const name = trimmed(input.name, 'name', 200);
    if (!FIN_ACCOUNT_KINDS.includes(input.kind)) throw invalid('kind');
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: CHART_WRITE,
    });
    const values = { code, name, kind: input.kind, normalSide: normalSideOf(input.kind) };
    const [row] = await tx
      .insert(finAccounts)
      .values({ companyId: scope.companyId, ...values })
      .returning(accountColumns);
    if (!row) throw new Error('fin account was not created');
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'CREATE',
      entity: 'account',
      entityId: row.id,
      after: values,
    });
    return row;
  }

  /**
   * Changes an account inside the caller's transaction (the caller checks its own rules first,
   * e.g. that an account holding a role stays active); null when the company has no such account.
   */
  async updateAccountInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: {
      company: string;
      id: number;
      patch: { code?: string; name?: string; kind?: FinAccountKind; status?: FinStatus };
    },
  ): Promise<{ before: FinAccountView; after: FinAccountView } | null> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: CHART_WRITE,
    });
    const [before] = await tx
      .select(accountColumns)
      .from(finAccounts)
      .where(and(eq(finAccounts.companyId, scope.companyId), eq(finAccounts.id, input.id)))
      .for('update');
    if (!before) return null;
    const { patch } = input;
    if (patch.kind !== undefined && !FIN_ACCOUNT_KINDS.includes(patch.kind)) throw invalid('kind');
    if (patch.status !== undefined && !FIN_STATUSES.includes(patch.status)) throw invalid('status');
    const set = {
      ...(patch.code !== undefined ? { code: trimmed(patch.code, 'code', 64) } : {}),
      ...(patch.name !== undefined ? { name: trimmed(patch.name, 'name', 200) } : {}),
      ...(patch.kind !== undefined
        ? {
            kind: patch.kind,
            // A contra account keeps its side; a plain one follows its new kind.
            normalSide:
              before.normalSide === normalSideOf(before.kind)
                ? normalSideOf(patch.kind)
                : before.normalSide,
          }
        : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    const [after] = await tx
      .update(finAccounts)
      .set({ ...set, updatedAt: sql`now()` })
      .where(and(eq(finAccounts.companyId, scope.companyId), eq(finAccounts.id, input.id)))
      .returning(accountColumns);
    if (!after) return null;
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'UPDATE',
      entity: 'account',
      entityId: input.id,
      before: { code: before.code, name: before.name, kind: before.kind, status: before.status },
      after: set,
    });
    return { before, after };
  }

  /**
   * The company-default rule of every key in force on `on` (the newest `effective_from` ≤ `on`,
   * then the newest row). With `lock`, rule changes of the company wait until this transaction ends.
   */
  async rules(
    ctx: FinCallContext,
    query: { company: string; on: string; lock?: boolean },
    executor: FinExecutor = this.db,
  ): Promise<Map<string, FinRuleView>> {
    const scope = await this.read(executor, ctx, query.company);
    if (query.lock) {
      await executor.execute(sql`SELECT pg_advisory_xact_lock(${RULES_LOCK}, ${scope.companyId})`);
    }
    return rulesOn(executor, scope.companyId, query.on);
  }

  /** A new company-default rule for `key` from `effectiveFrom` (append-only); `accountId` null unmaps. */
  async setRuleInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; key: string; accountId: number | null; effectiveFrom: string },
  ): Promise<FinRuleView> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: RULE_WRITE,
    });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RULES_LOCK}, ${scope.companyId})`);
    const [key] = await tx
      .select({ code: finPostingKeys.code })
      .from(finPostingKeys)
      .where(
        and(eq(finPostingKeys.companyId, scope.companyId), eq(finPostingKeys.code, input.key)),
      );
    if (!key) throw new FinError('FIN_MAPPING_MISSING', undefined, { key: input.key });
    if (input.accountId !== null) {
      const [account] = await tx
        .select({ status: finAccounts.status })
        .from(finAccounts)
        .where(
          and(eq(finAccounts.companyId, scope.companyId), eq(finAccounts.id, input.accountId)),
        );
      if (!account) throw invalid('accountId');
      if (account.status !== 'ACTIVE') {
        throw new FinError('FIN_ACCOUNT_INACTIVE', undefined, { accountId: input.accountId });
      }
    }
    const [row] = await tx
      .insert(finPostingRules)
      .values({
        companyId: scope.companyId,
        postingKey: input.key,
        accountId: input.accountId,
        effectiveFrom: input.effectiveFrom,
      })
      .returning({ id: finPostingRules.id });
    if (!row) throw new Error('fin posting rule was not created');
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'CREATE',
      entity: 'posting_rule',
      entityId: row.id,
      after: { key: input.key, accountId: input.accountId, effectiveFrom: input.effectiveFrom },
    });
    return {
      key: input.key,
      ruleId: row.id,
      accountId: input.accountId,
      effectiveFrom: input.effectiveFrom,
    };
  }

  async moneyAccounts(
    ctx: FinCallContext,
    query: { company: string; ids?: readonly number[] },
    executor: FinExecutor = this.db,
  ): Promise<FinMoneyAccountView[]> {
    const scope = await this.read(executor, ctx, query.company);
    return moneyAccountRows(executor, scope.companyId, query.ids);
  }

  /** The money account a posting uses: shared-locked; null when the company has none of this id. */
  async lockMoneyAccountInTx(
    tx: FinTx,
    ctx: FinCallContext,
    query: { company: string; id: number },
  ): Promise<FinMoneyAccountView | null> {
    const scope = await this.read(tx, ctx, query.company);
    const [locked] = await tx
      .select({ id: finMoneyAccounts.id })
      .from(finMoneyAccounts)
      .where(
        and(eq(finMoneyAccounts.companyId, scope.companyId), eq(finMoneyAccounts.id, query.id)),
      )
      .for('share');
    if (!locked) return null;
    const [row] = await moneyAccountRows(tx, scope.companyId, [query.id]);
    return row ?? null;
  }

  async createMoneyAccountInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string } & FinMoneyAccountInput,
  ): Promise<FinMoneyAccountView> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: MONEY_WRITE,
    });
    if (!FIN_MONEY_ACCOUNT_KINDS.includes(input.kind)) throw invalid('kind');
    const values = {
      ...(await this.moneyValues(tx, scope, input, input.kind)),
      branchId: await this.branchIdOf(tx, scope, input.branch),
    };
    const [row] = await tx
      .insert(finMoneyAccounts)
      .values({ companyId: scope.companyId, kind: input.kind, ...values })
      .returning({ id: finMoneyAccounts.id });
    if (!row) throw new Error('fin money account was not created');
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'CREATE',
      entity: 'money_account',
      entityId: row.id,
      after: { kind: input.kind, ...values },
    });
    const [view] = await moneyAccountRows(tx, scope.companyId, [row.id]);
    if (!view) throw new Error('fin money account vanished');
    return view;
  }

  /** null when the company has no money account of this id. */
  async updateMoneyAccountInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; id: number; patch: FinMoneyAccountPatch },
  ): Promise<FinMoneyAccountView | null> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: MONEY_WRITE,
    });
    const [before] = await tx
      .select()
      .from(finMoneyAccounts)
      .where(
        and(eq(finMoneyAccounts.companyId, scope.companyId), eq(finMoneyAccounts.id, input.id)),
      )
      .for('update');
    if (!before) return null;
    const { patch } = input;
    const merged = {
      code: patch.code ?? before.code,
      name: patch.name ?? before.name,
      accountId: patch.accountId ?? before.accountId,
      bankName: patch.bankName === undefined ? before.bankName : patch.bankName,
      bankAccountNo: patch.bankAccountNo === undefined ? before.bankAccountNo : patch.bankAccountNo,
      showToCustomers: patch.showToCustomers ?? before.showToCustomers,
    };
    const values = {
      ...(await this.moneyValues(tx, scope, merged, before.kind)),
      branchId:
        patch.branch === undefined
          ? before.branchId
          : await this.branchIdOf(tx, scope, patch.branch),
    };
    const status = patch.status ?? before.status;
    if (!FIN_STATUSES.includes(status)) throw invalid('status');
    await tx
      .update(finMoneyAccounts)
      .set({ ...values, status, updatedAt: sql`now()` })
      .where(
        and(eq(finMoneyAccounts.companyId, scope.companyId), eq(finMoneyAccounts.id, input.id)),
      );
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'UPDATE',
      entity: 'money_account',
      entityId: input.id,
      before: {
        code: before.code,
        name: before.name,
        branchId: before.branchId,
        accountId: before.accountId,
        bankName: before.bankName,
        bankAccountNo: before.bankAccountNo,
        showToCustomers: before.showToCustomers,
        status: before.status,
      },
      after: { ...values, status },
    });
    const [view] = await moneyAccountRows(tx, scope.companyId, [input.id]);
    return view ?? null;
  }

  private read(executor: FinExecutor, ctx: FinCallContext, company: string) {
    return resolveCompany(executor, ctx, company, { source: true, userAnyOf: READ });
  }

  private async moneyValues(
    tx: FinTx,
    scope: CompanyScope,
    input: Omit<FinMoneyAccountInput, 'kind' | 'branch'>,
    kind: FinMoneyAccountKind,
  ) {
    if (input.showToCustomers && kind !== 'BANK') throw invalid('showToCustomers');
    const [account] = await tx
      .select({ id: finAccounts.id })
      .from(finAccounts)
      .where(and(eq(finAccounts.companyId, scope.companyId), eq(finAccounts.id, input.accountId)));
    if (!account) throw invalid('accountId');
    return {
      code: trimmed(input.code, 'code', 64),
      name: trimmed(input.name, 'name', 200),
      accountId: input.accountId,
      bankName: optional(input.bankName, 'bankName', 120),
      bankAccountNo: optional(input.bankAccountNo, 'bankAccountNo', 40),
      showToCustomers: input.showToCustomers,
    };
  }

  /** The company's branch of a source's ref; a ref that is not mapped is refused. */
  private async branchIdOf(
    tx: FinTx,
    scope: CompanyScope,
    branch: FinBranchRef | null,
  ): Promise<number | null> {
    if (branch === null) return null;
    const [mapped] = await tx
      .select({ branchId: finBranchRefs.branchId })
      .from(finBranchRefs)
      .innerJoin(finSourceSystems, eq(finSourceSystems.id, finBranchRefs.sourceSystemId))
      .where(
        and(
          eq(finBranchRefs.companyId, scope.companyId),
          eq(finSourceSystems.tenantId, scope.tenantId),
          eq(finSourceSystems.code, branch.system),
          eq(finBranchRefs.externalId, branch.externalId),
        ),
      );
    if (!mapped) throw invalid('branch');
    return mapped.branchId;
  }
}

const accountColumns = {
  id: finAccounts.id,
  code: finAccounts.code,
  name: finAccounts.name,
  kind: finAccounts.kind,
  normalSide: finAccounts.normalSide,
  control: finAccounts.control,
  status: finAccounts.status,
  createdAt: finAccounts.createdAt,
  updatedAt: finAccounts.updatedAt,
};

/** The company-default rule of every key in force on `on`. */
export async function rulesOn(
  executor: FinExecutor,
  companyId: number,
  on: string,
): Promise<Map<string, FinRuleView>> {
  const rows = await executor
    .selectDistinctOn([finPostingRules.postingKey], {
      key: finPostingRules.postingKey,
      ruleId: finPostingRules.id,
      accountId: finPostingRules.accountId,
      effectiveFrom: finPostingRules.effectiveFrom,
    })
    .from(finPostingRules)
    .where(and(eq(finPostingRules.companyId, companyId), lte(finPostingRules.effectiveFrom, on)))
    .orderBy(
      asc(finPostingRules.postingKey),
      desc(finPostingRules.effectiveFrom),
      desc(finPostingRules.id),
    );
  return new Map(rows.map((row) => [row.key, row]));
}

async function moneyAccountRows(
  executor: FinExecutor,
  companyId: number,
  ids?: readonly number[],
): Promise<FinMoneyAccountView[]> {
  if (ids && ids.length === 0) return [];
  const rows = await executor
    .select({
      account: finMoneyAccounts,
      accountCode: finAccounts.code,
      accountName: finAccounts.name,
    })
    .from(finMoneyAccounts)
    .innerJoin(
      finAccounts,
      and(
        eq(finAccounts.companyId, finMoneyAccounts.companyId),
        eq(finAccounts.id, finMoneyAccounts.accountId),
      ),
    )
    .where(
      and(
        eq(finMoneyAccounts.companyId, companyId),
        ids ? inArray(finMoneyAccounts.id, [...ids]) : undefined,
      ),
    )
    .orderBy(asc(finMoneyAccounts.code));
  const branchIds = [
    ...new Set(
      rows.flatMap((row) => (row.account.branchId === null ? [] : [row.account.branchId])),
    ),
  ];
  const refs = branchIds.length
    ? await executor
        .select({
          branchId: finBranchRefs.branchId,
          system: finSourceSystems.code,
          externalId: finBranchRefs.externalId,
        })
        .from(finBranchRefs)
        .innerJoin(finSourceSystems, eq(finSourceSystems.id, finBranchRefs.sourceSystemId))
        .where(
          and(eq(finBranchRefs.companyId, companyId), inArray(finBranchRefs.branchId, branchIds)),
        )
    : [];
  return rows.map(({ account, accountCode, accountName }) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    kind: account.kind,
    branchRefs: refs
      .filter((ref) => ref.branchId === account.branchId)
      .map((ref) => ({ system: ref.system, externalId: ref.externalId })),
    accountId: account.accountId,
    accountCode,
    accountName,
    bankName: account.bankName,
    bankAccountNo: account.bankAccountNo,
    showToCustomers: account.showToCustomers,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }));
}

/**
 * Fills an empty chart from a template and maps each template key to its account from the beginning
 * (docs/modules/finance-core.md §5): never touches a chart that has accounts, so an imported or
 * edited chart is never re-seeded. Runs at boot under ensureDefaultCompany's advisory lock.
 */
export async function ensureDefaultChart(
  tx: FinTx,
  scope: { tenantId: number; companyId: number },
  template: readonly FinChartTemplateAccount[],
): Promise<void> {
  const [any] = await tx
    .select({ id: finAccounts.id })
    .from(finAccounts)
    .where(eq(finAccounts.companyId, scope.companyId))
    .limit(1);
  if (any || template.length === 0) return;
  const created = await tx
    .insert(finAccounts)
    .values(
      template.map((account) => ({
        companyId: scope.companyId,
        code: account.code,
        name: account.name,
        kind: account.kind,
        normalSide: account.normalSide,
        control: account.control,
      })),
    )
    .returning({ id: finAccounts.id, code: finAccounts.code });
  const idOf = new Map(created.map((row) => [row.code, row.id]));
  const rules = template.flatMap((account) =>
    account.key === null
      ? []
      : [
          {
            companyId: scope.companyId,
            postingKey: account.key,
            accountId: idOf.get(account.code) ?? null,
            effectiveFrom: FIN_RULES_FROM_START,
          },
        ],
  );
  if (rules.length) await tx.insert(finPostingRules).values(rules);
  await recordFinAudit(
    tx,
    { system: 'boot' },
    {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'CREATE',
      entity: 'chart',
      entityId: scope.companyId,
      after: { accounts: template.length, rules: rules.length },
    },
  );
}
