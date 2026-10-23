import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { CatalogService } from '../../catalog';
import type { Actor } from '../../identity';
import type { ReceiptSalePrice, ReceiptSalePrices } from '../../inventory';
import { ProductPricesService } from './product-prices.service';

/**
 * Bound to inventory's RECEIPT_SALE_PRICES and run inside a goods receipt's posting (ADR-0099 #5):
 * each line's new warehouse price comes into force from the posting's business date, keeping the
 * profile and the whole pack of the terms in force that day. Products in id order, the lock order
 * of `ProductPricesService` (the product's advisory lock, then its profile).
 */
@Injectable()
export class ReceiptSalePricesHook implements ReceiptSalePrices {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prices: ProductPricesService,
  ) {}

  async applyInTx(
    tx: Tx,
    actor: Actor,
    validFrom: string,
    prices: readonly ReceiptSalePrice[],
  ): Promise<void> {
    const sorted = [...prices].sort((a, b) => a.productId - b.productId);
    const terms = await this.prices.inForce(
      sorted.map((price) => price.productId),
      validFrom,
      tx,
    );
    for (const price of sorted) {
      const current = terms.get(price.productId);
      if (!current) {
        const [product] = await this.catalog.getMany([price.productId], tx);
        throw new AppError(
          'SALE_PRICE_NO_TERMS',
          `product ${price.productId} has no price terms in force`,
          { productId: price.productId, product: product?.name ?? '' },
        );
      }
      await this.prices.setInTx(tx, actor, {
        productId: price.productId,
        validFrom,
        warehousePrice: price.warehousePrice,
        profileId: current.profileId,
        wholeUomId: current.wholeUomId,
      });
    }
  }
}
