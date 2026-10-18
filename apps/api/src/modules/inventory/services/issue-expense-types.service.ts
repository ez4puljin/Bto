import { Inject, Injectable } from '@nestjs/common';
import mn from '@tugeel/shared/i18n/mn.json';
import { DEFAULT_ISSUE_EXPENSE_TYPES } from '@tugeel/shared/inventory';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService } from '../../identity';
import { issueExpenseTypes } from '../schema';

/** pg_advisory_xact_lock key of the expense types' boot sync (finance uses 72_026_110). */
const EXPENSE_TYPES_LOCK = 72_026_120;

export interface IssueExpenseType {
  id: number;
  name: string;
  /** A seeded type's stable code; null for one the admin added. */
  code: string | null;
  active: boolean;
  sortOrder: number;
}

export interface IssueExpenseTypeInput {
  name: string;
  sortOrder?: number;
}

export type IssueExpenseTypePatch = Partial<IssueExpenseTypeInput> & { active?: boolean };

/**
 * What goods issues are for (ADR-0081): a short list the admin keeps (`inventory.setup.manage`).
 * Types are never deleted (issues name them); a retired one stays on its issues and leaves the
 * pickers. The books map each type to an account later (the Finance Core).
 */
@Injectable()
export class IssueExpenseTypesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Inserts the default types that are missing (ADR-0081 #5), named from mn.json, at api boot like
   * finance's chart (a database whose tables were emptied gets them back; the test harness truncates
   * everything). A renamed or retired default keeps its code and is left alone.
   */
  async ensureDefaults(): Promise<void> {
    const names: Record<string, string> = mn.inventory.issueExpenseTypes;
    await inTransaction(this.db, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${EXPENSE_TYPES_LOCK})`);
      for (const [index, code] of DEFAULT_ISSUE_EXPENSE_TYPES.entries()) {
        const name = normalizeName(names[code] ?? code);
        await tx
          .insert(issueExpenseTypes)
          .values({ name, nameKey: nameKey(name), code, sortOrder: (index + 1) * 10 })
          .onConflictDoNothing();
      }
    });
  }

  async list(executor: Db | Tx = this.db): Promise<IssueExpenseType[]> {
    return executor
      .select({
        id: issueExpenseTypes.id,
        name: issueExpenseTypes.name,
        code: issueExpenseTypes.code,
        active: issueExpenseTypes.active,
        sortOrder: issueExpenseTypes.sortOrder,
      })
      .from(issueExpenseTypes)
      .orderBy(asc(issueExpenseTypes.sortOrder), asc(issueExpenseTypes.id));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<IssueExpenseType> {
    const found = (await this.list(executor)).find((type) => type.id === id);
    if (!found) throw notFound('issue_expense_type', id);
    return found;
  }

  /** An active type, shared-locked so it cannot be retired while an issue names it. */
  async assertActive(tx: Tx, id: number): Promise<IssueExpenseType> {
    const [row] = await tx
      .select({ id: issueExpenseTypes.id, active: issueExpenseTypes.active })
      .from(issueExpenseTypes)
      .where(eq(issueExpenseTypes.id, id))
      .for('share');
    if (!row) throw invalid('expenseTypeId', 'exists', `expense type ${id} does not exist`);
    if (!row.active) {
      throw new AppError('EXPENSE_TYPE_INACTIVE', `expense type ${id} is retired`, { id });
    }
    return this.get(id, tx);
  }

  create(ctx: AuthContext, input: IssueExpenseTypeInput): Promise<IssueExpenseType> {
    const name = normalizeName(input.name);
    if (name.length === 0 || name.length > 100) throw invalid('name', 'length', '1–100 characters');
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(issueExpenseTypes)
        .values({
          name,
          nameKey: nameKey(name),
          sortOrder: input.sortOrder ?? (await this.nextOrder(tx)),
        })
        .returning();
      if (!row) throw new Error('expense type insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'issue_expense_types',
        entityId: row.id,
        after: row,
      });
      return this.get(row.id, tx);
    });
  }

  update(ctx: AuthContext, id: number, patch: IssueExpenseTypePatch): Promise<IssueExpenseType> {
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(issueExpenseTypes)
        .where(eq(issueExpenseTypes.id, id))
        .for('update');
      if (!before) throw notFound('issue_expense_type', id);
      const name = patch.name === undefined ? before.name : normalizeName(patch.name);
      if (name.length === 0 || name.length > 100) {
        throw invalid('name', 'length', '1–100 characters');
      }
      const [after] = await tx
        .update(issueExpenseTypes)
        .set({
          name,
          nameKey: nameKey(name),
          ...(patch.active === undefined ? {} : { active: patch.active }),
          ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
          updatedAt: sql`now()`,
        })
        .where(eq(issueExpenseTypes.id, id))
        .returning();
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'issue_expense_types',
        entityId: id,
        before,
        after,
      });
      return this.get(id, tx);
    });
  }

  /** Types by name key, for the issues import (ADR-0081 #7). */
  async byNameKeys(executor: Db | Tx = this.db): Promise<Map<string, IssueExpenseType>> {
    return new Map(
      (await this.list(executor)).map((type) => [nameKey(normalizeName(type.name)), type]),
    );
  }

  private async nextOrder(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number>`coalesce(max(${issueExpenseTypes.sortOrder}), 0)::int` })
      .from(issueExpenseTypes);
    return (row?.max ?? 0) + 10;
  }
}
