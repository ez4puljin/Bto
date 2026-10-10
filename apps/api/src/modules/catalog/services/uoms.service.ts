import { Inject, Injectable } from '@nestjs/common';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { productUnits, uoms } from '../schema';
import { notFound } from './support';

export type Uom = typeof uoms.$inferSelect;

export interface UomInput {
  name: string;
  fractional: boolean;
  measureUnit?: string | null;
}

export interface UomPatch {
  name?: string;
  measureUnit?: string | null;
}

/** Units of measure. System units (with a code) may be renamed but never deleted. */
@Injectable()
export class UomsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<Uom[]> {
    return this.db
      .select()
      .from(uoms)
      .orderBy(sql`${uoms.code} IS NULL`, asc(uoms.id));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<Uom> {
    const [row] = await executor.select().from(uoms).where(eq(uoms.id, id));
    if (!row) throw notFound('unit of measure', id);
    return row;
  }

  create(actor: Actor, input: UomInput): Promise<Uom> {
    return inTransaction(this.db, async (tx) => {
      const name = normalizeName(input.name);
      const [row] = await tx
        .insert(uoms)
        .values({
          name,
          nameKey: nameKey(name),
          fractional: input.fractional,
          measureUnit: input.measureUnit ?? null,
        })
        .returning();
      if (!row) throw new Error('uom insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'uoms',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  /** Name and e-Barimt measure unit only: `fractional` defines what quantities mean and never changes. */
  update(actor: Actor, id: number, patch: UomPatch): Promise<Uom> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const name = patch.name === undefined ? undefined : normalizeName(patch.name);
      const [row] = await tx
        .update(uoms)
        .set({
          ...(name === undefined ? {} : { name, nameKey: nameKey(name) }),
          ...(patch.measureUnit === undefined ? {} : { measureUnit: patch.measureUnit }),
          updatedAt: sql`now()`,
        })
        .where(eq(uoms.id, id))
        .returning();
      if (!row) throw notFound('unit of measure', id);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'uoms',
        entityId: id,
        before,
        after: row,
      });
      return row;
    });
  }

  remove(actor: Actor, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const [used] = await tx
        .select({ id: productUnits.id })
        .from(productUnits)
        .where(eq(productUnits.uomId, id))
        .limit(1);
      if (before.code !== null || used) {
        throw new AppError(
          'IN_USE',
          `unit of measure ${id} is ${before.code ? 'a system unit' : 'in use'}`,
          {
            resource: 'uoms',
          },
        );
      }
      await tx.delete(uoms).where(eq(uoms.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'uoms',
        entityId: id,
        before,
      });
    });
  }
}
