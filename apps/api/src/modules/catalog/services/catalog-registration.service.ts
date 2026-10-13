import { Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { isExactFactor } from '@tugeel/shared/units';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import type { Actor } from '../../identity';
import { categories, uoms } from '../schema';
import { type ImageFiles, ProductImagesService } from './product-images.service';
import { ProductsService } from './products.service';
import { invalid } from './support';

/** The catalog part of a product registration (ADR-0044 #5). */
export interface CatalogRegistration {
  sku: string;
  name: string;
  categoryId: number;
  baseUomId: number;
  weightKg: Decimal | null;
  baseBarcodes: readonly string[];
  /** Base units in one box: the box unit is always added. */
  boxFactor: Decimal;
  boxBarcodes: readonly string[];
  /** Other units (a block …); never the box. */
  units: readonly { uomId: number; factorToBase: Decimal; barcodes: readonly string[] }[];
  /** At least one; the first becomes the primary photo. */
  images: readonly ImageFiles[];
}

export interface RegisteredProduct {
  id: number;
  sku: string;
  name: string;
}

/**
 * The catalog part of registering a product (ADR-0044 #5), called by the registration flow in
 * inventory: the product with its base unit, box and other units, their barcodes and the photos.
 * It waits for its prices. The e-Barimt fields get defaults — VAT included, the classification
 * code of the category or of its nearest ancestor that has one — and the accountant completes them
 * on the product's e-Barimt card.
 */
@Injectable()
export class CatalogRegistrationService {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ProductImagesService,
  ) {}

  /** Before the transaction: every photo arrived (an HTTP HEAD with the Spaces driver). */
  verifyImages(images: readonly ImageFiles[]): Promise<void> {
    return this.images.verify(images);
  }

  async registerInTx(tx: Tx, actor: Actor, input: CatalogRegistration): Promise<RegisteredProduct> {
    if (input.images.length === 0) throw invalid('images', 'min', 'a product needs a photo');
    const [box] = await tx.select().from(uoms).where(eq(uoms.code, 'BOX'));
    if (!box) throw new Error('the BOX unit of measure is missing (synced at api boot)');
    const base = await this.products.uom(tx, input.baseUomId, 'baseUomId');
    if (base.id === box.id) throw invalid('baseUomId', 'notBox', 'the box is not a base unit');
    for (const [index, unit] of input.units.entries()) {
      if (unit.uomId === box.id) {
        throw invalid(`units.${index}.uomId`, 'notBox', 'the box comes with boxFactor');
      }
    }
    if (!isExactFactor(input.boxFactor, base.fractional)) {
      throw new AppError(
        'UNIT_FACTOR_INEXACT',
        `factor ${input.boxFactor.toString()} is not exact`,
        { path: 'boxFactor' },
      );
    }
    const product = await this.products.createInTx(tx, actor, {
      sku: input.sku,
      name: input.name,
      categoryId: input.categoryId,
      vatType: 'VAT_ABLE',
      classificationCode: await this.defaultClassificationCode(tx, input.categoryId),
      weightKg: input.weightKg,
      baseUomId: base.id,
      baseBarcodes: [...input.baseBarcodes],
      // The other units first, so that their errors keep the request's paths (`units.N`).
      units: [
        ...input.units.map((unit) => ({
          uomId: unit.uomId,
          factorToBase: unit.factorToBase,
          barcodes: [...unit.barcodes],
        })),
        { uomId: box.id, factorToBase: input.boxFactor, barcodes: [...input.boxBarcodes] },
      ],
    });
    await this.images.attachManyInTx(tx, actor, product.id, input.images);
    return { id: product.id, sku: product.sku, name: product.name };
  }

  /** The default classification code of the category or of its nearest ancestor with one. */
  private async defaultClassificationCode(tx: Tx, categoryId: number): Promise<string | null> {
    const rows = await tx
      .select({
        id: categories.id,
        parentId: categories.parentId,
        code: categories.defaultClassificationCode,
      })
      .from(categories);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const seen = new Set<number>();
    let current = byId.get(categoryId);
    while (current && !seen.has(current.id)) {
      if (current.code !== null) return current.code;
      seen.add(current.id);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    return null;
  }
}
