import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import { AuditQueryService, type AuditRow, UserNamesService } from '../../identity';
import { productUnits, products } from '../schema';

/**
 * What changed on one product and who changed it (owner 2026-11-06): the audit rows of the product,
 * its units, their barcodes, its pictures, prices, locations and suppliers, newest first. Every
 * change already writes its row in its own transaction; this only reads them, by entity name alone,
 * so no module is asked. A retired unit still counts, and a deleted barcode is found by the unit its
 * row names.
 */
@Injectable()
export class ProductHistoryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditQueryService,
    private readonly names: UserNamesService,
  ) {}

  async list(
    productId: number,
    page: { cursor?: string; limit?: number },
  ): Promise<{ data: (AuditRow & { actorName: string | null })[]; nextCursor: string | null }> {
    const [product] = await this.db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, productId));
    if (!product) throw notFound('product', productId);
    const units = await this.db
      .select({ id: productUnits.id })
      .from(productUnits)
      .where(eq(productUnits.productId, productId));
    const result = await this.audit.entriesOf({
      targets: [
        { entity: 'products', ids: [productId] },
        // These two write the product's id as their entity id.
        { entity: 'product_prices', ids: [productId] },
        { entity: 'product_locations', ids: [productId] },
      ],
      naming: [
        // One writer of locations uses the location row's id instead, and names the product inside.
        { entity: 'product_locations', field: 'productId', values: [productId] },
        { entity: 'product_suppliers', field: 'productId', values: [productId] },
        { entity: 'product_units', field: 'productId', values: [productId] },
        { entity: 'product_images', field: 'productId', values: [productId] },
        {
          entity: 'product_barcodes',
          field: 'productUnitId',
          values: units.map((unit) => unit.id),
        },
      ],
      ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      limit: page.limit ?? 20,
    });
    // A location row whose own id happens to equal this product's id belongs to another product.
    const rows = result.data.filter((row) => {
      if (row.entity !== 'product_locations') return true;
      const named = (row.after ?? row.before) as { productId?: unknown } | null;
      return (
        named?.productId === undefined ||
        named.productId === productId ||
        named.productId === String(productId)
      );
    });
    const staff = rows.flatMap((row) =>
      row.actorKind === 'STAFF' && row.actorId !== null ? [row.actorId] : [],
    );
    const names = await this.names.namesOf(staff);
    return {
      data: rows.map((row) => ({
        ...row,
        actorName: row.actorId === null ? null : (names.get(row.actorId) ?? null),
      })),
      nextCursor: result.nextCursor,
    };
  }
}
