import { Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import type { Tx } from '../../../common/db/db.types';
import type { SalePriceReader } from '../../inventory';
import { ProductPricesService } from './product-prices.service';

/**
 * Bound to inventory's SALE_PRICE_READER (ADR-0117 #3): the warehouse price per base unit in force
 * on a date (whole MNT, VAT included, no discount programs), for the «Хүнд тооцох» lines a goods
 * issue prices at its send. Products without terms are left out; inventory refuses them.
 */
@Injectable()
export class IssueSalePricesHook implements SalePriceReader {
  constructor(private readonly prices: ProductPricesService) {}

  async warehousePricesInTx(
    tx: Tx,
    productIds: readonly number[],
    date: string,
  ): Promise<Map<number, Decimal>> {
    const terms = await this.prices.inForce([...new Set(productIds)], date, tx);
    return new Map([...terms].map(([productId, term]) => [productId, term.warehousePrice]));
  }
}
