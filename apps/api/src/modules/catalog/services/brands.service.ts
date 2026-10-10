import { Inject, Injectable } from '@nestjs/common';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { asc, count, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { brands, products } from '../schema';
import { notFound } from './support';

export type Brand = typeof brands.$inferSelect;
export type BrandView = Brand & { productCount: number };

@Injectable()
export class BrandsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<BrandView[]> {
    const rows = await this.db
      .select({ brand: brands, productCount: count(products.id) })
      .from(brands)
      .leftJoin(products, eq(products.brandId, brands.id))
      .groupBy(brands.id)
      .orderBy(asc(brands.name), asc(brands.id));
    return rows.map((row) => ({ ...row.brand, productCount: row.productCount }));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<Brand> {
    const [row] = await executor.select().from(brands).where(eq(brands.id, id));
    if (!row) throw notFound('brand', id);
    return row;
  }

  create(actor: Actor, input: { name: string }): Promise<Brand> {
    return inTransaction(this.db, async (tx) => {
      const name = normalizeName(input.name);
      const [row] = await tx
        .insert(brands)
        .values({ name, nameKey: nameKey(name) })
        .returning();
      if (!row) throw new Error('brand insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'brands',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  update(actor: Actor, id: number, input: { name: string }): Promise<Brand> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const name = normalizeName(input.name);
      const [row] = await tx
        .update(brands)
        .set({ name, nameKey: nameKey(name), updatedAt: sql`now()` })
        .where(eq(brands.id, id))
        .returning();
      if (!row) throw notFound('brand', id);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'brands',
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
        .select({ id: products.id })
        .from(products)
        .where(eq(products.brandId, id))
        .limit(1);
      if (used) throw new AppError('IN_USE', `brand ${id} is in use`, { resource: 'brands' });
      await tx.delete(brands).where(eq(brands.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'brands',
        entityId: id,
        before,
      });
    });
  }
}
