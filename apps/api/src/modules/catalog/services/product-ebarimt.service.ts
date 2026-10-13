import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import type { Actor } from '../../identity';
import { products, productUnits, type VatType } from '../schema';
import { type ProductDetail, type ProductPatch, ProductsService } from './products.service';
import { invalid, notFound } from './support';
import { UnitsService } from './units.service';

export interface ProductEbarimtInput {
  vatType?: VatType;
  cityTax?: boolean | null;
  classificationCode?: string | null;
  taxProductCode?: string | null;
  /** e-Barimt measure units of the product's current units; null = the unit of measure default. */
  units?: readonly { unitId: number; measureUnit: string | null }[];
}

/**
 * A product's e-Barimt data, set by the accountant apart from registration (ADR-0044 #6): VAT
 * type, city tax, БҮНА and tax product codes, and the measure unit of each current unit, in one
 * transaction (the readiness report's gaps, SPEC §5.2).
 */
@Injectable()
export class ProductEbarimtService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly products: ProductsService,
    private readonly units: UnitsService,
  ) {}

  update(actor: Actor, productId: number, input: ProductEbarimtInput): Promise<ProductDetail> {
    return inTransaction(this.db, async (tx) => {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .for('update');
      if (!product) throw notFound('product', productId);
      const patch: ProductPatch = {
        ...(input.vatType === undefined ? {} : { vatType: input.vatType }),
        ...(input.cityTax === undefined ? {} : { cityTax: input.cityTax }),
        ...(input.classificationCode === undefined
          ? {}
          : { classificationCode: input.classificationCode }),
        ...(input.taxProductCode === undefined ? {} : { taxProductCode: input.taxProductCode }),
      };
      if (Object.keys(patch).length > 0)
        await this.products.updateInTx(tx, actor, productId, patch);
      const seen = new Set<number>();
      for (const [index, unit] of (input.units ?? []).entries()) {
        const [row] = await tx
          .select({ productId: productUnits.productId })
          .from(productUnits)
          .where(eq(productUnits.id, unit.unitId));
        if (!row || row.productId !== productId || seen.has(unit.unitId)) {
          throw invalid(`units.${index}.unitId`, 'exists', `unit ${unit.unitId} of the product`);
        }
        seen.add(unit.unitId);
        await this.units.updateInTx(tx, actor, unit.unitId, { measureUnit: unit.measureUnit });
      }
      return this.products.get(productId, tx);
    });
  }
}
