import { Injectable } from '@nestjs/common';
import { and, asc, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { type Actor, AuditService } from '../../identity';
import { products } from '../schema';
import type { ProductStatus } from './products.service';

/** A product row locked for the completion check (ADR-0044 #3). */
export interface SaleReadyCandidate {
  id: number;
  sku: string;
  name: string;
  status: ProductStatus;
  saleReadyAt: Date | null;
}

/**
 * A product's way to orders (ADR-0044): it is registered waiting for its prices, and the price
 * clerk completes it. Pricing checks the prices and calls these methods inside its transaction;
 * catalog alone writes the column.
 */
@Injectable()
export class ProductLifecycleService {
  constructor(private readonly audit: AuditService) {}

  /** The products in id order, locked FOR UPDATE; missing ids are left out. */
  async lockForSaleReadyInTx(tx: Tx, ids: readonly number[]): Promise<SaleReadyCandidate[]> {
    if (ids.length === 0) return [];
    return tx
      .select({
        id: products.id,
        sku: products.sku,
        name: products.name,
        status: products.status,
        saleReadyAt: products.saleReadyAt,
      })
      .from(products)
      .where(inArray(products.id, [...ids]))
      .orderBy(asc(products.id))
      .for('update');
  }

  /**
   * Marks waiting products complete, now; products already complete are left as they are. One
   * COMPLETE audit row each, with what the caller checked (`checked`, e.g. the prices).
   */
  async markSaleReadyInTx(
    tx: Tx,
    actor: Actor,
    ids: readonly number[],
    checked: ReadonlyMap<number, Record<string, unknown>> = new Map(),
  ): Promise<number[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .update(products)
      .set({ saleReadyAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(inArray(products.id, [...ids]), isNull(products.saleReadyAt)))
      .returning({ id: products.id, saleReadyAt: products.saleReadyAt });
    await this.audit.recordMany(
      tx,
      actor,
      rows.map((row) => ({
        action: 'COMPLETE',
        entity: 'products',
        entityId: row.id,
        before: { saleReadyAt: null },
        after: { saleReadyAt: row.saleReadyAt, ...checked.get(row.id) },
      })),
    );
    return rows.map((row) => row.id).sort((a, b) => a - b);
  }
}
