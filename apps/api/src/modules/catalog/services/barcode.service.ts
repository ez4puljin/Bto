import { Inject, Injectable } from '@nestjs/common';
import { classifyBarcode, internalEan13, lookupCandidates } from '@tugeel/shared/gtin';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { internalBarcodeSeq, productBarcodes, products, productUnits } from '../schema';
import { notFound } from './support';

export type Barcode = typeof productBarcodes.$inferSelect;

const INTERNAL_BARCODE_SEQUENCE = internalBarcodeSeq.seqName;

export interface ResolvedBarcode {
  barcode: Barcode;
  productId: number;
  unitId: number;
}

/** Barcodes of units (ADR-0029): one lookup key across all products, a type and a primary per unit. */
@Injectable()
export class BarcodeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * Adds a typed or scanned code to a current unit inside the caller's transaction. The first
   * barcode of a unit becomes its primary one.
   */
  async addInTx(tx: Tx, actor: Actor, unitId: number, input: string): Promise<Barcode> {
    const classified = classifyBarcode(input);
    if (!classified.ok) {
      throw new AppError('BARCODE_INVALID', `barcode rejected: ${classified.problem}`, {
        problem: classified.problem,
      });
    }
    await this.currentUnit(tx, unitId);
    await this.assertFree(tx, classified.value.lookupKey);
    const [row] = await tx
      .insert(productBarcodes)
      .values({
        productUnitId: unitId,
        code: classified.value.code,
        gtin14: classified.value.gtin14,
        lookupKey: classified.value.lookupKey,
        barcodeType: classified.value.barcodeType,
        isPrimary: !(await this.hasPrimary(tx, unitId)),
      })
      .returning();
    if (!row) throw new Error('barcode insert returned no row');
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'product_barcodes',
      entityId: row.id,
      after: row,
    });
    return row;
  }

  add(actor: Actor, unitId: number, input: string): Promise<Barcode> {
    return inTransaction(this.db, (tx) => this.addInTx(tx, actor, unitId, input));
  }

  /** Issues an internal EAN-13 ("20" + sequence + check digit) for a unit without one. */
  generateInternal(actor: Actor, unitId: number): Promise<Barcode> {
    return inTransaction(this.db, async (tx) => {
      await this.currentUnit(tx, unitId);
      const [existing] = await tx
        .select()
        .from(productBarcodes)
        .where(
          and(eq(productBarcodes.productUnitId, unitId), eq(productBarcodes.isInternal, true)),
        );
      if (existing) {
        throw new AppError('CONFLICT', `unit ${unitId} already has an internal barcode`, {
          reason: 'INTERNAL_BARCODE_EXISTS',
        });
      }
      // A manually registered code may already use a number: skip such numbers.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const next = await tx.execute<{ value: string }>(
          sql`SELECT nextval(${INTERNAL_BARCODE_SEQUENCE}::regclass)::text AS value`,
        );
        const code = internalEan13(Number.parseInt(next.rows[0]?.value ?? '', 10));
        const classified = classifyBarcode(code);
        if (!classified.ok) throw new Error(`internal barcode ${code} does not validate`);
        const [taken] = await tx
          .select({ id: productBarcodes.id })
          .from(productBarcodes)
          .where(eq(productBarcodes.lookupKey, classified.value.lookupKey));
        if (taken) continue;
        const [row] = await tx
          .insert(productBarcodes)
          .values({
            productUnitId: unitId,
            code,
            gtin14: classified.value.gtin14,
            lookupKey: classified.value.lookupKey,
            barcodeType: 'UNDEFINED',
            isInternal: true,
            isPrimary: !(await this.hasPrimary(tx, unitId)),
          })
          .returning();
        if (!row) throw new Error('barcode insert returned no row');
        await this.audit.record(tx, actor, {
          action: 'CREATE',
          entity: 'product_barcodes',
          entityId: row.id,
          after: row,
        });
        return row;
      }
      throw new Error('no free internal barcode number after 5 attempts');
    });
  }

  /** Makes a barcode the one e-Barimt lines carry for its unit (old primary cleared first). */
  setPrimary(actor: Actor, barcodeId: number): Promise<Barcode> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(tx, barcodeId);
      await tx
        .update(productBarcodes)
        .set({ isPrimary: false })
        .where(
          and(
            eq(productBarcodes.productUnitId, before.productUnitId),
            eq(productBarcodes.isPrimary, true),
          ),
        );
      const [row] = await tx
        .update(productBarcodes)
        .set({ isPrimary: true })
        .where(eq(productBarcodes.id, barcodeId))
        .returning();
      if (!row) throw notFound('barcode', barcodeId);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'product_barcodes',
        entityId: barcodeId,
        before,
        after: row,
      });
      return row;
    });
  }

  /** Deletes a barcode; when it was primary, the oldest remaining one takes over. */
  remove(actor: Actor, barcodeId: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(tx, barcodeId);
      await tx.delete(productBarcodes).where(eq(productBarcodes.id, barcodeId));
      if (before.isPrimary) await this.promoteOldest(tx, before.productUnitId);
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'product_barcodes',
        entityId: barcodeId,
        before,
      });
    });
  }

  /** Deletes every barcode of a unit inside the caller's transaction (retiring the unit). */
  async removeAllOfUnit(tx: Tx, actor: Actor, unitId: number): Promise<void> {
    const removed = await tx
      .delete(productBarcodes)
      .where(eq(productBarcodes.productUnitId, unitId))
      .returning();
    for (const before of removed) {
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'product_barcodes',
        entityId: before.id,
        before,
      });
    }
  }

  /** Barcodes of the given units, oldest first. */
  async ofUnits(unitIds: readonly number[], executor: Db | Tx = this.db): Promise<Barcode[]> {
    if (unitIds.length === 0) return [];
    return executor
      .select()
      .from(productBarcodes)
      .where(inArray(productBarcodes.productUnitId, [...unitIds]))
      .orderBy(asc(productBarcodes.id));
  }

  /**
   * The current units a scanned code belongs to (ADR-0029 #2): empty when unknown, more than one
   * only for an 8-digit code registered both as EAN-8 and as UPC-E.
   */
  async lookup(code: string, executor: Db | Tx = this.db): Promise<ResolvedBarcode[]> {
    const keys = lookupCandidates(code);
    if (keys.length === 0) return [];
    const rows = await executor
      .select({
        barcode: productBarcodes,
        productId: productUnits.productId,
        unitId: productUnits.id,
      })
      .from(productBarcodes)
      .innerJoin(productUnits, eq(productUnits.id, productBarcodes.productUnitId))
      .where(and(inArray(productBarcodes.lookupKey, keys), isNull(productUnits.supersededAt)));
    return rows;
  }

  private async get(tx: Tx, barcodeId: number): Promise<Barcode> {
    const [row] = await tx
      .select()
      .from(productBarcodes)
      .where(eq(productBarcodes.id, barcodeId))
      .for('update');
    if (!row) throw notFound('barcode', barcodeId);
    return row;
  }

  private async currentUnit(tx: Tx, unitId: number): Promise<void> {
    const [unit] = await tx
      .select({ supersededAt: productUnits.supersededAt })
      .from(productUnits)
      .where(eq(productUnits.id, unitId));
    if (!unit) throw notFound('product unit', unitId);
    if (unit.supersededAt) {
      throw new AppError('UNIT_SUPERSEDED', `unit ${unitId} is no longer current`, { id: unitId });
    }
  }

  private async hasPrimary(tx: Tx, unitId: number): Promise<boolean> {
    const [row] = await tx
      .select({ id: productBarcodes.id })
      .from(productBarcodes)
      .where(and(eq(productBarcodes.productUnitId, unitId), eq(productBarcodes.isPrimary, true)));
    return row !== undefined;
  }

  /** BARCODE_TAKEN with the owning product, so the admin sees where the code already is. */
  private async assertFree(tx: Tx, lookupKey: string): Promise<void> {
    const [owner] = await tx
      .select({ sku: products.sku, name: products.name })
      .from(productBarcodes)
      .innerJoin(productUnits, eq(productUnits.id, productBarcodes.productUnitId))
      .innerJoin(products, eq(products.id, productUnits.productId))
      .where(eq(productBarcodes.lookupKey, lookupKey));
    if (owner) {
      throw new AppError('BARCODE_TAKEN', `barcode ${lookupKey} belongs to ${owner.sku}`, owner);
    }
  }

  private async promoteOldest(tx: Tx, unitId: number): Promise<void> {
    const [oldest] = await tx
      .select({ id: productBarcodes.id })
      .from(productBarcodes)
      .where(eq(productBarcodes.productUnitId, unitId))
      .orderBy(asc(productBarcodes.id))
      .limit(1);
    if (oldest) {
      await tx
        .update(productBarcodes)
        .set({ isPrimary: true })
        .where(eq(productBarcodes.id, oldest.id));
    }
  }
}
