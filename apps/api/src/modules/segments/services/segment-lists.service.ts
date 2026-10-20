import { Inject, Injectable } from '@nestjs/common';
import { MAX_SELECTED_PRODUCTS } from '@tugeel/shared/catalog';
import { nameKey } from '@tugeel/shared/text';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { ProductQueryService } from '../../catalog';
import { actorUserId, type AuthContext, AuditService } from '../../identity';
import { segmentProducts, segments } from '../schema';
import { auditView, checkedInput, type Segment, toSegment } from './segments.service';

/** What a change of a list segment's members did, and its size afterwards. */
export interface MembersChange {
  changed: number;
  unchanged: number;
  count: number;
}

/** Ascending ids without repeats: the order products are locked in (architecture §5.3). */
const ascending = (ids: readonly number[]) => [...new Set(ids)].sort((a, b) => a - b);

/**
 * Hand-picked product segments (ADR-0052): `kind` LIST, no definition, the members exactly the
 * products put in (`segment_products`). Admins (`segments.manage`) create one from ticked products
 * and add or remove members; the segment row is locked for every change, members are written by
 * one statement over an id array in ascending id order (the product foreign key takes
 * `FOR KEY SHARE` in the order every product writer locks), at most MAX_SELECTED_PRODUCTS of them.
 * One audit row per action names the ids that changed.
 */
@Injectable()
export class SegmentListsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly products: ProductQueryService,
  ) {}

  async create(
    ctx: AuthContext,
    input: { name: string; description?: string | null; productIds: readonly number[] },
  ): Promise<Segment> {
    const values = checkedInput(input);
    const ids = await this.known(input.productIds);
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(segments)
        .values({
          entity: 'PRODUCT',
          kind: 'LIST',
          name: values.name,
          nameKey: nameKey(values.name),
          description: values.description,
          definition: null,
          createdBy: actorUserId(ctx),
          updatedBy: actorUserId(ctx),
        })
        .returning();
      if (!row) throw new Error('segment insert returned no row');
      await this.insert(tx, row.id, ids);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'segments',
        entityId: row.id,
        after: { ...auditView(row), productIds: ids },
      });
      return toSegment(row, []);
    });
  }

  /** Adds products to a list segment; those already in are reported, never added twice. */
  async add(ctx: AuthContext, id: number, productIds: readonly number[]): Promise<MembersChange> {
    const ids = await this.known(productIds);
    return inTransaction(this.db, async (tx) => {
      await this.lockList(tx, id);
      const added = await this.insert(tx, id, ids);
      const count = await this.size(tx, id);
      if (count > MAX_SELECTED_PRODUCTS) {
        throw new AppError(
          'SEGMENT_TOO_LARGE',
          `segment ${id} would hold ${count} products, at most ${MAX_SELECTED_PRODUCTS}`,
          { count, limit: MAX_SELECTED_PRODUCTS },
        );
      }
      if (added.length > 0) await this.changed(tx, ctx, id, 'ADD_PRODUCTS', added, count);
      return { changed: added.length, unchanged: ids.length - added.length, count };
    });
  }

  /** Takes products out of a list segment; those not in it are reported as unchanged. */
  async remove(
    ctx: AuthContext,
    id: number,
    productIds: readonly number[],
  ): Promise<MembersChange> {
    const ids = ascending(productIds);
    return inTransaction(this.db, async (tx) => {
      await this.lockList(tx, id);
      const removed = (
        await tx.execute<{ id: string }>(sql`
          DELETE FROM ${segmentProducts}
           WHERE ${segmentProducts.segmentId} = ${id}
             AND ${segmentProducts.productId} = ANY(${sql.param(ids)}::bigint[])
          RETURNING ${segmentProducts.productId}::text AS id`)
      ).rows.map((row) => Number.parseInt(row.id, 10));
      const count = await this.size(tx, id);
      if (removed.length > 0) {
        await this.changed(tx, ctx, id, 'REMOVE_PRODUCTS', ascending(removed), count);
      }
      return { changed: removed.length, unchanged: ids.length - removed.length, count };
    });
  }

  /** The products asked for, ascending without repeats; an unknown one refuses the request. */
  private async known(productIds: readonly number[]): Promise<number[]> {
    const ids = ascending(productIds);
    const found = new Set(await this.products.orderedOf(ids));
    const missing = ids.find((productId) => !found.has(productId));
    if (missing !== undefined) {
      throw invalid('productIds', 'exists', `product ${missing} not found`);
    }
    return ids;
  }

  /** A live list segment, locked for the change; 404 unknown or archived, 422 a RULES one. */
  private async lockList(tx: Tx, id: number): Promise<void> {
    const [row] = await tx.select().from(segments).where(eq(segments.id, id)).for('update');
    if (!row || row.archivedAt) throw notFound('segment', id);
    if (row.kind !== 'LIST') {
      throw invalid('id', 'kind', `segment ${id} keeps conditions, not a list of products`);
    }
  }

  /** Inserts members in ascending id order; returns the ids that were not members yet. */
  private async insert(tx: Tx, segmentId: number, ids: readonly number[]): Promise<number[]> {
    if (ids.length === 0) return [];
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO ${segmentProducts} (segment_id, product_id)
      SELECT ${segmentId}, u.id FROM unnest(${sql.param([...ids])}::bigint[]) AS u(id) ORDER BY u.id
      ON CONFLICT DO NOTHING
      RETURNING product_id::text AS id`);
    return rows.map((row) => Number.parseInt(row.id, 10));
  }

  private async size(tx: Tx, segmentId: number): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(segmentProducts)
      .where(eq(segmentProducts.segmentId, segmentId));
    return row?.count ?? 0;
  }

  /** The segment changed: who and when on its row, and one audit row with the ids. */
  private async changed(
    tx: Tx,
    ctx: AuthContext,
    id: number,
    action: 'ADD_PRODUCTS' | 'REMOVE_PRODUCTS',
    productIds: readonly number[],
    count: number,
  ): Promise<void> {
    await tx
      .update(segments)
      .set({ updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
      .where(eq(segments.id, id));
    await this.audit.record(tx, ctx, {
      action,
      entity: 'segments',
      entityId: id,
      after: { productIds, count },
    });
  }
}
