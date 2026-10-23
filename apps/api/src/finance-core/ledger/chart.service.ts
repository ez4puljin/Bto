import { Inject, Injectable } from '@nestjs/common';
import { CODE_PATTERN, type FinPermission } from '@tugeel/fin-contract';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import { type CompanyScope, type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb, type FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { accountsWithLines } from '../posting/journal-reader.service';
import {
  FIN_ACCOUNT_CONTROLS,
  FIN_ACCOUNT_KINDS,
  FIN_MONEY_ACCOUNT_KINDS,
  type FIN_SIDES,
  FIN_STATUSES,
  finAccountGroups,
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
  /** Its group in the chart (ADR-0102 #4), or null. */
  groupId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FinAccountGroupView {
  id: number;
  code: string;
  name: string;
  status: FinStatus;
}

/**
 * One account of an imported chart (ADR-0102 #4). `normalSide` null: the kind's (an existing
 * account of the same kind keeps its own); `control` and `group` null: the account's own (NONE /
 * none for a new one); `group.name` null keeps a group's name (a new group is named by its code);
 * `key` re-points that posting key's rule to the account.
 */
export interface FinChartImportRow {
  code: string;
  name: string;
  kind: FinAccountKind;
  normalSide: FinSide | null;
  control: FinAccountControl | null;
  group: { code: string; name: string | null } | null;
  key: string | null;
}

interface FinAccountFields {
  name: string;
  kind: FinAccountKind;
  normalSide: FinSide;
  control: FinAccountControl;
  groupId: number | null;
}

/** What an imported row did, kept by the import for its revert. */
export interface FinChartImportApplied {
  code: string;
  accountId: number;
  action: 'CREATE' | 'UPDATE' | 'UNCHANGED';
  before: FinAccountFields | null;
  after: FinAccountFields;
  /** The key re-pointed to the account and the account it pointed to before (null: none). */
  rule: { key: string; previousAccountId: number | null } | null;
  /** A group this row created, or one it renamed with its previous name. */
  groupCreated: number | null;
  groupBefore: { id: number; name: string } | null;
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

  /**
   * A posting key of the company that wants no control of its account, created when missing (a
   * source's own key for a record it adds at runtime, e.g. Bto's goods-issue expense type, ADR-0106
   * #3); its account comes from a rule (`setRuleInTx`). Returns whether it was created.
   */
  async defineKeyInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; code: string },
  ): Promise<boolean> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: RULE_WRITE,
    });
    if (!CODE_PATTERN.test(input.code)) throw invalid('code');
    const [created] = await tx
      .insert(finPostingKeys)
      .values({ companyId: scope.companyId, code: input.code, requiredControl: 'NONE' })
      .onConflictDoNothing()
      .returning({ code: finPostingKeys.code });
    if (!created) return false;
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'CREATE',
      entity: 'posting_key',
      entityId: input.code,
      after: { code: input.code, requiredControl: 'NONE' },
    });
    return true;
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

  /** The company's posting keys with the control each wants of its account. */
  async postingKeys(
    ctx: FinCallContext,
    query: { company: string },
    executor: FinExecutor = this.db,
  ): Promise<Map<string, FinAccountControl>> {
    const scope = await this.read(executor, ctx, query.company);
    const rows = await executor
      .select({ code: finPostingKeys.code, requiredControl: finPostingKeys.requiredControl })
      .from(finPostingKeys)
      .where(eq(finPostingKeys.companyId, scope.companyId));
    return new Map(rows.map((row) => [row.code, row.requiredControl]));
  }

  /** The company's account groups. */
  async groups(
    ctx: FinCallContext,
    query: { company: string },
    executor: FinExecutor = this.db,
  ): Promise<FinAccountGroupView[]> {
    const scope = await this.read(executor, ctx, query.company);
    return executor
      .select({
        id: finAccountGroups.id,
        code: finAccountGroups.code,
        name: finAccountGroups.name,
        status: finAccountGroups.status,
      })
      .from(finAccountGroups)
      .where(eq(finAccountGroups.companyId, scope.companyId))
      .orderBy(asc(finAccountGroups.code));
  }

  /**
   * Erkhet's chart, inside the caller's transaction (ADR-0102 #4): each row's group is found or made
   * by code, its account made or changed by code (name, kind, normal side, control, group; a null
   * control or group keeps the account's), and its posting key, if any, re-pointed to it by a rule
   * from `on`. An account holding journal lines keeps its kind, side and control
   * (FIN_ACCOUNT_IN_USE); a key that wants a control the account lacks is refused
   * (FIN_PAYLOAD_INVALID `rows.<n>.key`). Returns what changed, for the revert.
   */
  async importChartInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; rows: readonly FinChartImportRow[]; on: string },
  ): Promise<FinChartImportApplied[]> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: CHART_WRITE,
    });
    if (input.rows.some((row) => row.key !== null)) {
      await resolveCompany(tx, ctx, input.company, { source: false, userAnyOf: RULE_WRITE });
    }
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RULES_LOCK}, ${scope.companyId})`);
    const codes = input.rows.map((row, index) => trimmed(row.code, `rows.${index}.code`, 64));
    const existing = new Map(
      (
        await tx
          .select(accountColumns)
          .from(finAccounts)
          .where(and(eq(finAccounts.companyId, scope.companyId), inArray(finAccounts.code, codes)))
          .orderBy(asc(finAccounts.id))
          .for('update')
      ).map((row) => [row.code, row]),
    );
    const inUse = await accountsWithLines(
      tx,
      scope.companyId,
      [...existing.values()].map((row) => row.id),
    );
    const keys = new Map(
      (
        await tx
          .select({ code: finPostingKeys.code, requiredControl: finPostingKeys.requiredControl })
          .from(finPostingKeys)
          .where(eq(finPostingKeys.companyId, scope.companyId))
      ).map((row) => [row.code, row.requiredControl]),
    );
    const rules = await rulesOn(tx, scope.companyId, input.on);
    const groups = await this.groupsInTx(tx, scope.companyId);
    const applied: FinChartImportApplied[] = [];
    for (const [index, row] of input.rows.entries()) {
      const path = `rows.${index}`;
      const code = codes[index] ?? '';
      const name = trimmed(row.name, `${path}.name`, 200);
      if (!FIN_ACCOUNT_KINDS.includes(row.kind)) throw invalid(`${path}.kind`);
      if (row.control !== null && !FIN_ACCOUNT_CONTROLS.includes(row.control)) {
        throw invalid(`${path}.control`);
      }
      const before = existing.get(code) ?? null;
      let groupId = before?.groupId ?? null;
      let groupCreated: number | null = null;
      let groupBefore: { id: number; name: string } | null = null;
      if (row.group) {
        const groupCode = trimmed(row.group.code, `${path}.group.code`, 64);
        const groupName =
          row.group.name === null ? null : trimmed(row.group.name, `${path}.group.name`, 200);
        const found = groups.get(groupCode);
        if (found) {
          groupId = found.id;
          if (groupName !== null && groupName !== found.name) {
            groupBefore = { id: found.id, name: found.name };
            await tx
              .update(finAccountGroups)
              .set({ name: groupName, status: 'ACTIVE', updatedAt: sql`now()` })
              .where(
                and(
                  eq(finAccountGroups.companyId, scope.companyId),
                  eq(finAccountGroups.id, found.id),
                ),
              );
            found.name = groupName;
          }
        } else {
          const [made] = await tx
            .insert(finAccountGroups)
            .values({ companyId: scope.companyId, code: groupCode, name: groupName ?? groupCode })
            .returning({ id: finAccountGroups.id });
          if (!made) throw new Error('fin account group was not created');
          groupId = made.id;
          groupCreated = made.id;
          groups.set(groupCode, { id: made.id, name: groupName ?? groupCode });
        }
      }
      const control = row.control ?? before?.control ?? 'NONE';
      const values: FinAccountFields = {
        name,
        kind: row.kind,
        normalSide:
          row.normalSide ??
          (before && before.kind === row.kind ? before.normalSide : normalSideOf(row.kind)),
        control,
        groupId,
      };
      let accountId: number;
      let action: FinChartImportApplied['action'];
      if (!before) {
        const [made] = await tx
          .insert(finAccounts)
          .values({ companyId: scope.companyId, code, ...values })
          .returning({ id: finAccounts.id });
        if (!made) throw new Error('fin account was not created');
        accountId = made.id;
        action = 'CREATE';
      } else {
        accountId = before.id;
        if (
          inUse.has(before.id) &&
          (before.kind !== values.kind ||
            before.normalSide !== values.normalSide ||
            before.control !== values.control)
        ) {
          throw new FinError('FIN_ACCOUNT_IN_USE', undefined, { path, code });
        }
        const same =
          before.name === values.name &&
          before.kind === values.kind &&
          before.normalSide === values.normalSide &&
          before.control === values.control &&
          before.groupId === values.groupId;
        action = same ? 'UNCHANGED' : 'UPDATE';
        if (!same) {
          await tx
            .update(finAccounts)
            .set({ ...values, updatedAt: sql`now()` })
            .where(and(eq(finAccounts.companyId, scope.companyId), eq(finAccounts.id, before.id)));
        }
      }
      let rule: FinChartImportApplied['rule'] = null;
      if (row.key !== null) {
        const required = keys.get(row.key);
        if (required === undefined) {
          throw new FinError('FIN_MAPPING_MISSING', undefined, {
            key: row.key,
            path: `${path}.key`,
          });
        }
        if (required !== 'NONE' && required !== control) throw invalid(`${path}.key`);
        const current = rules.get(row.key) ?? null;
        if (current?.accountId !== accountId) {
          await tx.insert(finPostingRules).values({
            companyId: scope.companyId,
            postingKey: row.key,
            accountId,
            effectiveFrom: input.on,
          });
          rule = { key: row.key, previousAccountId: current?.accountId ?? null };
        }
      }
      applied.push({
        code,
        accountId,
        action,
        before: before
          ? {
              name: before.name,
              kind: before.kind,
              normalSide: before.normalSide,
              control: before.control,
              groupId: before.groupId,
            }
          : null,
        after: values,
        rule,
        groupCreated,
        groupBefore,
      });
    }
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'IMPORT',
      entity: 'chart',
      entityId: scope.companyId,
      after: {
        created: applied.filter((row) => row.action === 'CREATE').length,
        updated: applied.filter((row) => row.action === 'UPDATE').length,
        rules: applied.flatMap((row) => (row.rule ? [row.rule.key] : [])),
      },
    });
    return applied;
  }

  /**
   * Takes an imported chart back (ADR-0102 #4), newest row first: a re-pointed key goes back to its
   * previous account while it still points to the imported one (a rule from `on`); a changed account
   * gets back the fields that still hold the imported values (its kind, side and control only while
   * it holds no lines); a created account is deactivated unless it holds lines, a rule or a money
   * account; a renamed group gets its name back, a created one is deactivated once it is empty.
   */
  async revertChartInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; applied: readonly FinChartImportApplied[]; on: string },
  ): Promise<void> {
    const scope = await resolveCompany(tx, ctx, input.company, {
      source: false,
      userAnyOf: CHART_WRITE,
    });
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${RULES_LOCK}, ${scope.companyId})`);
    const ids = input.applied.map((row) => row.accountId);
    const current = new Map(
      (
        await tx
          .select(accountColumns)
          .from(finAccounts)
          .where(and(eq(finAccounts.companyId, scope.companyId), inArray(finAccounts.id, ids)))
          .for('update')
      ).map((row) => [row.id, row]),
    );
    const inUse = await accountsWithLines(tx, scope.companyId, ids);
    const rules = await rulesOn(tx, scope.companyId, input.on);
    const where = (id: number) =>
      and(eq(finAccounts.companyId, scope.companyId), eq(finAccounts.id, id));
    for (const row of [...input.applied].reverse()) {
      if (row.rule && rules.get(row.rule.key)?.accountId === row.accountId) {
        await tx.insert(finPostingRules).values({
          companyId: scope.companyId,
          postingKey: row.rule.key,
          accountId: row.rule.previousAccountId,
          effectiveFrom: input.on,
        });
        rules.set(row.rule.key, {
          key: row.rule.key,
          ruleId: 0,
          accountId: row.rule.previousAccountId,
          effectiveFrom: input.on,
        });
      }
      const account = current.get(row.accountId);
      if (!account) continue;
      if (row.action === 'CREATE') {
        const [money] = await tx
          .select({ id: finMoneyAccounts.id })
          .from(finMoneyAccounts)
          .where(
            and(
              eq(finMoneyAccounts.companyId, scope.companyId),
              eq(finMoneyAccounts.accountId, account.id),
            ),
          )
          .limit(1);
        const held =
          inUse.has(account.id) ||
          money !== undefined ||
          [...rules.values()].some((rule) => rule.accountId === account.id);
        if (!held && account.status === 'ACTIVE') {
          await tx
            .update(finAccounts)
            .set({ status: 'INACTIVE', updatedAt: sql`now()` })
            .where(where(account.id));
        }
      } else if (row.action === 'UPDATE' && row.before) {
        const sidesHold =
          !inUse.has(account.id) &&
          account.kind === row.after.kind &&
          account.normalSide === row.after.normalSide &&
          account.control === row.after.control;
        const back = {
          ...(account.name === row.after.name ? { name: row.before.name } : {}),
          ...(account.groupId === row.after.groupId ? { groupId: row.before.groupId } : {}),
          ...(sidesHold
            ? {
                kind: row.before.kind,
                normalSide: row.before.normalSide,
                control: row.before.control,
              }
            : {}),
        };
        if (Object.keys(back).length) {
          await tx
            .update(finAccounts)
            .set({ ...back, updatedAt: sql`now()` })
            .where(where(account.id));
        }
      }
      if (row.groupBefore) {
        await tx
          .update(finAccountGroups)
          .set({ name: row.groupBefore.name, updatedAt: sql`now()` })
          .where(
            and(
              eq(finAccountGroups.companyId, scope.companyId),
              eq(finAccountGroups.id, row.groupBefore.id),
            ),
          );
      }
    }
    for (const row of input.applied) {
      if (row.groupCreated === null) continue;
      const [member] = await tx
        .select({ id: finAccounts.id })
        .from(finAccounts)
        .where(
          and(
            eq(finAccounts.companyId, scope.companyId),
            eq(finAccounts.groupId, row.groupCreated),
            eq(finAccounts.status, 'ACTIVE'),
          ),
        )
        .limit(1);
      if (!member) {
        await tx
          .update(finAccountGroups)
          .set({ status: 'INACTIVE', updatedAt: sql`now()` })
          .where(
            and(
              eq(finAccountGroups.companyId, scope.companyId),
              eq(finAccountGroups.id, row.groupCreated),
            ),
          );
      }
    }
    await recordFinAudit(tx, ctx, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'REVERT',
      entity: 'chart',
      entityId: scope.companyId,
      after: { rows: input.applied.length },
    });
  }

  private async groupsInTx(
    tx: FinTx,
    companyId: number,
  ): Promise<Map<string, { id: number; name: string }>> {
    const rows = await tx
      .select({ id: finAccountGroups.id, code: finAccountGroups.code, name: finAccountGroups.name })
      .from(finAccountGroups)
      .where(eq(finAccountGroups.companyId, companyId))
      .for('update');
    return new Map(rows.map((row) => [row.code, { id: row.id, name: row.name }]));
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
  groupId: finAccounts.groupId,
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
