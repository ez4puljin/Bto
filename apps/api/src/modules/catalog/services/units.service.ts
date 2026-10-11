import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { Decimal } from '@tugeel/shared/money';
import { isExactFactor } from '@tugeel/shared/units';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { UNIT_SUPERSEDED_HOOK, type UnitSupersededHook } from '../hooks';
import { products, productBarcodes, productUnits, uoms } from '../schema';
import { BarcodeService } from './barcode.service';
import type { NewUnitInput, ProductUnit } from './products.service';
import { invalid, notFound } from './support';

export interface UnitPatch {
  isDefaultSales?: boolean;
  isDefaultPurchase?: boolean;
  measureUnit?: string | null;
}

type DefaultFlag = 'isDefaultSales' | 'isDefaultPurchase';

/**
 * Units of a product (ADR-0008): add, flags, retire, and the single supersede path that changes a
 * factor. Every change locks the product row first, so concurrent edits of one product serialise.
 */
@Injectable()
export class UnitsService implements OnModuleInit {
  private hook: UnitSupersededHook | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly barcodes: BarcodeService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit(): void {
    try {
      this.hook = this.moduleRef.get<UnitSupersededHook>(UNIT_SUPERSEDED_HOOK, { strict: false });
    } catch {
      this.hook = null;
    }
  }

  add(actor: Actor, productId: number, input: NewUnitInput): Promise<ProductUnit> {
    return inTransaction(this.db, (tx) => this.addInTx(tx, actor, productId, input));
  }

  /** A new unit (and its barcodes) of a product in the caller's transaction. */
  async addInTx(
    tx: Tx,
    actor: Actor,
    productId: number,
    input: NewUnitInput,
  ): Promise<ProductUnit> {
    const baseFractional = await this.lockProduct(tx, productId);
    const [uom] = await tx.select({ id: uoms.id }).from(uoms).where(eq(uoms.id, input.uomId));
    if (!uom) throw invalid('uomId', 'exists', `unit of measure ${input.uomId} not found`);
    this.assertExact(input.factorToBase, baseFractional);
    for (const flag of ['isDefaultSales', 'isDefaultPurchase'] as const) {
      if (input[flag]) await this.clearDefault(tx, productId, flag);
    }
    const [row] = await tx
      .insert(productUnits)
      .values({
        productId,
        uomId: input.uomId,
        factorToBase: input.factorToBase,
        isDefaultSales: input.isDefaultSales ?? false,
        isDefaultPurchase: input.isDefaultPurchase ?? false,
        measureUnit: input.measureUnit ?? null,
      })
      .returning();
    if (!row) throw new Error('unit insert returned no row');
    for (const code of input.barcodes ?? []) await this.barcodes.addInTx(tx, actor, row.id, code);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'product_units',
      entityId: row.id,
      after: row,
    });
    return row;
  }

  /** Default flags (moved in two steps, the partial unique indexes allow one per product) and measure unit. */
  update(actor: Actor, unitId: number, patch: UnitPatch): Promise<ProductUnit> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.currentUnit(tx, unitId);
      for (const flag of ['isDefaultSales', 'isDefaultPurchase'] as const) {
        if (patch[flag] === true && !before[flag])
          await this.clearDefault(tx, before.productId, flag);
      }
      const [row] = await tx
        .update(productUnits)
        .set({
          ...(patch.isDefaultSales === undefined ? {} : { isDefaultSales: patch.isDefaultSales }),
          ...(patch.isDefaultPurchase === undefined
            ? {}
            : { isDefaultPurchase: patch.isDefaultPurchase }),
          ...(patch.measureUnit === undefined ? {} : { measureUnit: patch.measureUnit }),
          updatedAt: sql`now()`,
        })
        .where(eq(productUnits.id, unitId))
        .returning();
      if (!row) throw notFound('product unit', unitId);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'product_units',
        entityId: unitId,
        before,
        after: row,
      });
      return row;
    });
  }

  /** Stops using a unit: no successor, its barcodes are removed, documents keep their snapshot. */
  retire(actor: Actor, unitId: number): Promise<ProductUnit> {
    return inTransaction(this.db, (tx) => this.retireInTx(tx, actor, unitId));
  }

  /** Retires a unit in the caller's transaction (an import revert takes back a unit it added). */
  async retireInTx(tx: Tx, actor: Actor, unitId: number): Promise<ProductUnit> {
    const before = await this.currentUnit(tx, unitId);
    if (before.isBase)
      throw new AppError('UNIT_BASE_LOCKED', `unit ${unitId} is the base unit`, { id: unitId });
    const [row] = await tx
      .update(productUnits)
      .set({
        supersededAt: sql`now()`,
        isDefaultSales: false,
        isDefaultPurchase: false,
        updatedAt: sql`now()`,
      })
      .where(eq(productUnits.id, unitId))
      .returning();
    if (!row) throw notFound('product unit', unitId);
    await this.barcodes.removeAllOfUnit(tx, actor, unitId);
    await this.audit.record(tx, actor, {
      action: 'RETIRE',
      entity: 'product_units',
      entityId: unitId,
      before,
      after: row,
    });
    return row;
  }

  supersede(actor: Actor, unitId: number, factorToBase: Decimal): Promise<ProductUnit> {
    return inTransaction(this.db, (tx) => this.supersedeInTx(tx, actor, unitId, factorToBase));
  }

  /**
   * The one way a factor changes (ADR-0008 #4), inside the caller's transaction: the old row is
   * stamped superseded and loses its default flags, a new row with the new factor takes the flags and
   * every barcode, and the hook (pricing, delivery 2) re-issues price rules in the same transaction.
   */
  async supersedeInTx(
    tx: Tx,
    actor: Actor,
    unitId: number,
    factorToBase: Decimal,
  ): Promise<ProductUnit> {
    const old = await this.currentUnit(tx, unitId);
    if (old.isBase)
      throw new AppError('UNIT_BASE_LOCKED', `unit ${unitId} is the base unit`, { id: unitId });
    const baseFractional = await this.baseFractional(tx, old.productId);
    this.assertExact(factorToBase, baseFractional);
    if (factorToBase.eq(old.factorToBase)) {
      throw invalid('factorToBase', 'changed', 'the new factor equals the current one');
    }
    await tx
      .update(productUnits)
      .set({
        supersededAt: sql`now()`,
        isDefaultSales: false,
        isDefaultPurchase: false,
        updatedAt: sql`now()`,
      })
      .where(eq(productUnits.id, old.id));
    const [next] = await tx
      .insert(productUnits)
      .values({
        productId: old.productId,
        uomId: old.uomId,
        factorToBase,
        isDefaultSales: old.isDefaultSales,
        isDefaultPurchase: old.isDefaultPurchase,
        measureUnit: old.measureUnit,
      })
      .returning();
    if (!next) throw new Error('unit insert returned no row');
    await tx.update(productUnits).set({ supersededBy: next.id }).where(eq(productUnits.id, old.id));
    await tx
      .update(productBarcodes)
      .set({ productUnitId: next.id })
      .where(eq(productBarcodes.productUnitId, old.id));
    if (this.hook) await this.hook.onUnitSuperseded(tx, { oldUnitId: old.id, newUnitId: next.id });
    await this.audit.record(tx, actor, {
      action: 'SUPERSEDE',
      entity: 'product_units',
      entityId: old.id,
      before: old,
      after: next,
    });
    return next;
  }

  /** Locks the unit's product and returns the unit when it is still current. */
  private async currentUnit(tx: Tx, unitId: number): Promise<ProductUnit> {
    const [unit] = await tx.select().from(productUnits).where(eq(productUnits.id, unitId));
    if (!unit) throw notFound('product unit', unitId);
    await this.lockProduct(tx, unit.productId);
    const [current] = await tx.select().from(productUnits).where(eq(productUnits.id, unitId));
    if (!current) throw notFound('product unit', unitId);
    if (current.supersededAt) {
      throw new AppError('UNIT_SUPERSEDED', `unit ${unitId} is no longer current`, { id: unitId });
    }
    return current;
  }

  /** Row lock on the product (serialises unit changes); returns whether its base unit is fractional. */
  private async lockProduct(tx: Tx, productId: number): Promise<boolean> {
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId))
      .for('update');
    if (!product) throw notFound('product', productId);
    return this.baseFractional(tx, productId);
  }

  private async baseFractional(tx: Tx, productId: number): Promise<boolean> {
    const [base] = await tx
      .select({ fractional: uoms.fractional })
      .from(productUnits)
      .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
      .where(and(eq(productUnits.productId, productId), eq(productUnits.isBase, true)));
    if (!base) throw new Error(`product ${productId} has no base unit`);
    return base.fractional;
  }

  private assertExact(factor: Decimal, baseFractional: boolean): void {
    if (!isExactFactor(factor, baseFractional)) {
      throw new AppError('UNIT_FACTOR_INEXACT', `factor ${factor.toString()} is not exact`, {
        path: 'factorToBase',
      });
    }
  }

  private async clearDefault(tx: Tx, productId: number, flag: DefaultFlag): Promise<void> {
    const sales = flag === 'isDefaultSales';
    await tx
      .update(productUnits)
      .set(
        sales
          ? { isDefaultSales: false, updatedAt: sql`now()` }
          : { isDefaultPurchase: false, updatedAt: sql`now()` },
      )
      .where(
        and(
          eq(productUnits.productId, productId),
          eq(sales ? productUnits.isDefaultSales : productUnits.isDefaultPurchase, true),
        ),
      );
  }
}
