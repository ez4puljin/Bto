import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { isValidEnteredQty, toBase } from '@tugeel/shared/units';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { productUnits, uoms } from '../schema';
import { notFound } from './support';

/** What a document line stores (ADR-0008 #2): the unit, its factor at that moment and the base quantity. */
export interface ConvertedQty {
  productId: number;
  unitId: number;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
}

/** A unit as document lines show it: its name and factor, current or superseded. */
export interface UnitInfo {
  unitId: number;
  productId: number;
  uomName: string;
  factorToBase: Decimal;
  isBase: boolean;
  current: boolean;
}

/** Entered quantities to base units for document lines (inventory, sales, procurement). */
@Injectable()
export class UnitConversionService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Refuses superseded or retired units (UNIT_SUPERSEDED) and quantities that are not exact in base
   * units or not whole pieces (UNIT_FACTOR_INEXACT).
   */
  async toBase(
    unitId: number,
    enteredQty: Decimal,
    executor: Db | Tx = this.db,
  ): Promise<ConvertedQty> {
    const [unit] = await executor
      .select({
        productId: productUnits.productId,
        factorToBase: productUnits.factorToBase,
        supersededAt: productUnits.supersededAt,
        baseFractional: sql<boolean>`(SELECT u.fractional FROM product_units b JOIN uoms u ON u.id = b.uom_id
          WHERE b.product_id = product_units.product_id AND b.is_base)`,
      })
      .from(productUnits)
      .where(eq(productUnits.id, unitId));
    if (!unit) throw notFound('product unit', unitId);
    if (unit.supersededAt) {
      throw new AppError('UNIT_SUPERSEDED', `unit ${unitId} is no longer current`, { id: unitId });
    }
    if (!isValidEnteredQty(enteredQty, unit.factorToBase, unit.baseFractional)) {
      throw new AppError(
        'UNIT_FACTOR_INEXACT',
        `${enteredQty.toString()} of unit ${unitId} is not exact`,
        {
          id: unitId,
        },
      );
    }
    return {
      productId: unit.productId,
      unitId,
      factorSnapshot: unit.factorToBase,
      qtyBase: toBase(enteredQty, unit.factorToBase),
    };
  }

  /** Names and factors of units by id, superseded ones included (lines keep their unit). */
  async describe(
    unitIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, UnitInfo>> {
    if (unitIds.length === 0) return new Map();
    const rows = await executor
      .select({
        unitId: productUnits.id,
        productId: productUnits.productId,
        uomName: uoms.name,
        factorToBase: productUnits.factorToBase,
        isBase: productUnits.isBase,
        supersededAt: productUnits.supersededAt,
      })
      .from(productUnits)
      .innerJoin(uoms, eq(uoms.id, productUnits.uomId))
      .where(inArray(productUnits.id, [...unitIds]));
    return new Map(
      rows.map(({ supersededAt, ...row }) => [
        row.unitId,
        { ...row, current: supersededAt === null },
      ]),
    );
  }

  /** The base unit of each product (counts and corrections are entered in base units). */
  async baseUnits(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, UnitInfo>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({ unitId: productUnits.id })
      .from(productUnits)
      .where(and(inArray(productUnits.productId, [...productIds]), eq(productUnits.isBase, true)));
    const units = await this.describe(
      rows.map((row) => row.unitId),
      executor,
    );
    return new Map([...units.values()].map((unit) => [unit.productId, unit]));
  }
}
