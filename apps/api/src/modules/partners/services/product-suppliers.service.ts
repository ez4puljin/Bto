import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, type ProductSummary } from '../../catalog';
import { type Actor, AuditService } from '../../identity';
import { productSuppliers, suppliers } from '../schema';
import type { PartnerStatus } from './customers.service';
import { advisoryLock, LOCKS } from './support';

type LinkRow = typeof productSuppliers.$inferSelect;

/** Rows per multi-row statement. */
const CHUNK = 1_000;
const pairKey = (productId: number, supplierId: number) => `${productId}:${supplierId}`;

export interface ProductSupplierLink {
  id: number;
  productId: number;
  isMain: boolean;
  supplier: { id: number; code: string; name: string; status: PartnerStatus };
}

export interface SupplierProduct {
  linkId: number;
  isMain: boolean;
  product: ProductSummary;
}

/**
 * Which suppliers deliver a product (ADR-0032). One main supplier per product: the first link is
 * the main one, and unlinking it promotes the oldest remaining link. Every change of a product's
 * links runs under a per-product advisory lock (partners may not lock catalog's product row).
 */
@Injectable()
export class ProductSuppliersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
  ) {}

  /** Links of a product, the main supplier first. */
  async ofProduct(productId: number, executor: Db | Tx = this.db): Promise<ProductSupplierLink[]> {
    return this.ofProductIds([productId], executor);
  }

  /**
   * The links of several products (the product list screen, ADR-0037), each product's main
   * supplier first; unknown ids simply have no links.
   */
  async ofProductIds(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<ProductSupplierLink[]> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return [];
    return executor
      .select({
        id: productSuppliers.id,
        productId: productSuppliers.productId,
        isMain: productSuppliers.isMain,
        supplier: {
          id: suppliers.id,
          code: suppliers.code,
          name: suppliers.name,
          status: suppliers.status,
        },
      })
      .from(productSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
      .where(inArray(productSuppliers.productId, ids))
      .orderBy(
        asc(productSuppliers.productId),
        desc(productSuppliers.isMain),
        asc(productSuppliers.id),
      );
  }

  /**
   * Products a supplier delivers, paged by link (products come from CatalogService, so they cannot
   * be sorted by name in SQL here).
   */
  async productsOf(
    supplierId: number,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<{ data: SupplierProduct[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const rows = await this.db
      .select()
      .from(productSuppliers)
      .where(
        and(
          eq(productSuppliers.supplierId, supplierId),
          typeof after?.id === 'number' ? gt(productSuppliers.id, after.id) : undefined,
        ),
      )
      .orderBy(asc(productSuppliers.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const products = new Map(
      (await this.catalog.getMany(page.data.map((row) => row.productId))).map((product) => [
        product.id,
        product,
      ]),
    );
    return {
      data: page.data.flatMap((row) => {
        const product = products.get(row.productId);
        return product ? [{ linkId: row.id, isMain: row.isMain, product }] : [];
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** Every link of these products (the product import compares what it would add). */
  async linksOfProducts(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<LinkRow[]> {
    const rows: LinkRow[] = [];
    const unique = [...new Set(productIds)];
    for (let start = 0; start < unique.length; start += CHUNK) {
      rows.push(
        ...(await executor
          .select()
          .from(productSuppliers)
          .where(inArray(productSuppliers.productId, unique.slice(start, start + CHUNK)))),
      );
    }
    return rows;
  }

  /** Main supplier per product, for receiving (inventory, week 3). */
  async mainSupplierOf(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({ productId: productSuppliers.productId, supplierId: productSuppliers.supplierId })
      .from(productSuppliers)
      .where(
        and(
          inArray(productSuppliers.productId, [...productIds]),
          eq(productSuppliers.isMain, true),
        ),
      );
    return new Map(rows.map((row) => [row.productId, row.supplierId]));
  }

  link(actor: Actor, productId: number, supplierId: number): Promise<ProductSupplierLink> {
    return inTransaction(this.db, async (tx) => {
      const id = await this.linkInTx(tx, actor, productId, supplierId);
      return this.one(tx, id);
    });
  }

  /** Links a supplier to a product; the first link of a product becomes its main supplier. */
  async linkInTx(tx: Tx, actor: Actor, productId: number, supplierId: number): Promise<number> {
    const [product] = await this.catalog.getMany([productId], tx);
    if (!product) throw notFound('product', productId);
    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));
    if (!supplier) throw notFound('supplier', supplierId);
    await advisoryLock(tx, LOCKS.productSuppliers, productId);
    const [main] = await tx
      .select({ id: productSuppliers.id })
      .from(productSuppliers)
      .where(and(eq(productSuppliers.productId, productId), eq(productSuppliers.isMain, true)));
    const [row] = await tx
      .insert(productSuppliers)
      .values({ productId, supplierId, isMain: main === undefined })
      .returning();
    if (!row) throw new Error('link insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'product_suppliers',
      entityId: row.id,
      after: row,
    });
    return row.id;
  }

  /**
   * Many links at once in the caller's transaction (the product import, ADR-0036 #3): the table is
   * locked against concurrent link changes instead of one advisory lock per product, pairs already
   * linked are skipped, and a product's first link becomes its main supplier. Returns the new link
   * id of every pair that was added, keyed `productId:supplierId`.
   */
  async linkManyInTx(
    tx: Tx,
    actor: Actor,
    pairs: readonly { productId: number; supplierId: number }[],
  ): Promise<Map<string, number>> {
    const added = new Map<string, number>();
    if (pairs.length === 0) return added;
    await tx.execute(sql`LOCK TABLE product_suppliers IN SHARE ROW EXCLUSIVE MODE`);
    const productIds = [...new Set(pairs.map((pair) => pair.productId))];
    const existing: LinkRow[] = [];
    for (let start = 0; start < productIds.length; start += CHUNK) {
      existing.push(
        ...(await tx
          .select()
          .from(productSuppliers)
          .where(inArray(productSuppliers.productId, productIds.slice(start, start + CHUNK)))),
      );
    }
    const linked = new Set(existing.map((row) => pairKey(row.productId, row.supplierId)));
    const hasMain = new Set(existing.filter((row) => row.isMain).map((row) => row.productId));
    const values: (typeof productSuppliers.$inferInsert)[] = [];
    for (const pair of pairs) {
      const key = pairKey(pair.productId, pair.supplierId);
      if (linked.has(key)) continue;
      linked.add(key);
      values.push({ ...pair, isMain: !hasMain.has(pair.productId) });
      hasMain.add(pair.productId);
    }
    for (let start = 0; start < values.length; start += CHUNK) {
      const rows = await tx
        .insert(productSuppliers)
        .values(values.slice(start, start + CHUNK))
        .returning();
      for (const row of rows) added.set(pairKey(row.productId, row.supplierId), row.id);
      await this.audit.recordMany(
        tx,
        actor,
        rows.map((row) => ({
          action: 'CREATE',
          entity: 'product_suppliers',
          entityId: row.id,
          after: row,
        })),
      );
    }
    return added;
  }

  /**
   * Removes links in the caller's transaction (an import revert), under the same table lock; a
   * product that loses its main link gets its oldest remaining link as the main one.
   */
  async unlinkManyInTx(tx: Tx, actor: Actor, linkIds: readonly number[]): Promise<void> {
    if (linkIds.length === 0) return;
    await tx.execute(sql`LOCK TABLE product_suppliers IN SHARE ROW EXCLUSIVE MODE`);
    for (let start = 0; start < linkIds.length; start += CHUNK) {
      const removed = await tx
        .delete(productSuppliers)
        .where(inArray(productSuppliers.id, linkIds.slice(start, start + CHUNK)))
        .returning();
      await this.audit.recordMany(
        tx,
        actor,
        removed.map((row) => ({
          action: 'DELETE',
          entity: 'product_suppliers',
          entityId: row.id,
          before: row,
        })),
      );
      for (const productId of new Set(
        removed.filter((row) => row.isMain).map((row) => row.productId),
      )) {
        const [next] = await tx
          .select()
          .from(productSuppliers)
          .where(eq(productSuppliers.productId, productId))
          .orderBy(asc(productSuppliers.id))
          .limit(1);
        if (next) {
          await tx
            .update(productSuppliers)
            .set({ isMain: true })
            .where(eq(productSuppliers.id, next.id));
        }
      }
    }
  }

  /** Makes a link the main supplier of its product. */
  setMain(actor: Actor, id: number): Promise<ProductSupplierLink> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockLink(tx, id);
      if (!before.isMain) {
        await tx
          .update(productSuppliers)
          .set({ isMain: false })
          .where(
            and(
              eq(productSuppliers.productId, before.productId),
              eq(productSuppliers.isMain, true),
            ),
          );
        const [after] = await tx
          .update(productSuppliers)
          .set({ isMain: true })
          .where(eq(productSuppliers.id, id))
          .returning();
        await this.audit.record(tx, actor, {
          action: 'UPDATE',
          entity: 'product_suppliers',
          entityId: id,
          before,
          after,
        });
      }
      return this.one(tx, id);
    });
  }

  /** Removes a link; removing the main one makes the oldest remaining link the main one. */
  unlink(actor: Actor, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.lockLink(tx, id);
      await tx.delete(productSuppliers).where(eq(productSuppliers.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'product_suppliers',
        entityId: id,
        before,
      });
      if (!before.isMain) return;
      const [next] = await tx
        .select()
        .from(productSuppliers)
        .where(and(eq(productSuppliers.productId, before.productId), ne(productSuppliers.id, id)))
        .orderBy(asc(productSuppliers.id))
        .limit(1);
      if (!next) return;
      const [promoted] = await tx
        .update(productSuppliers)
        .set({ isMain: true })
        .where(eq(productSuppliers.id, next.id))
        .returning();
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'product_suppliers',
        entityId: next.id,
        before: next,
        after: promoted,
      });
    });
  }

  /** The link under its product's advisory lock. */
  private async lockLink(tx: Tx, id: number): Promise<LinkRow> {
    const [found] = await tx
      .select({ productId: productSuppliers.productId })
      .from(productSuppliers)
      .where(eq(productSuppliers.id, id));
    if (!found) throw notFound('product supplier', id);
    await advisoryLock(tx, LOCKS.productSuppliers, found.productId);
    const [row] = await tx.select().from(productSuppliers).where(eq(productSuppliers.id, id));
    if (!row) throw notFound('product supplier', id);
    return row;
  }

  private async one(tx: Tx, id: number): Promise<ProductSupplierLink> {
    const [row] = await tx
      .select({
        id: productSuppliers.id,
        productId: productSuppliers.productId,
        isMain: productSuppliers.isMain,
        supplier: {
          id: suppliers.id,
          code: suppliers.code,
          name: suppliers.name,
          status: suppliers.status,
        },
      })
      .from(productSuppliers)
      .innerJoin(suppliers, eq(suppliers.id, productSuppliers.supplierId))
      .where(eq(productSuppliers.id, id));
    if (!row) throw notFound('product supplier', id);
    return row;
  }
}
