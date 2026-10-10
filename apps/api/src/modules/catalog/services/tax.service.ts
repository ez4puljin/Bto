import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { SettingsService } from '../../identity';
import { products, type VatType } from '../schema';
import { notFound } from './support';

export interface ProductTaxRates {
  vatType: VatType;
  /** Percent, e.g. 10 (0 unless VAT_ABLE). */
  vatRatePct: Decimal;
  cityTax: boolean;
  /** Percent, e.g. 2 (0 unless the product carries city tax). */
  cityTaxRatePct: Decimal;
}

/**
 * Tax attributes of a product with the effective-dated rates on an Ulaanbaatar business date
 * (ADR-0010). Mechanical on purpose: whether the company itself pays VAT or city tax is applied by
 * pricing and e-Barimt once the accountant answers SPEC §11 #3a.
 */
@Injectable()
export class TaxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async rates(
    productId: number,
    onDate: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<ProductTaxRates> {
    const [product] = await executor
      .select({ vatType: products.vatType, cityTax: products.cityTax })
      .from(products)
      .where(eq(products.id, productId));
    if (!product) throw notFound('product', productId);
    if (product.cityTax === null) {
      throw new AppError(
        'TAX_ATTRIBUTES_MISSING',
        `product ${productId} has no city-tax decision`,
        {
          id: productId,
          attribute: 'cityTax',
        },
      );
    }
    const vatRatePct =
      product.vatType === 'VAT_ABLE'
        ? new Decimal(await this.settings.get('tax.vat_rate_pct', onDate, executor))
        : new Decimal(0);
    const cityTaxRatePct = product.cityTax
      ? new Decimal(await this.settings.get('tax.city_tax_rate_pct', onDate, executor))
      : new Decimal(0);
    return { vatType: product.vatType, vatRatePct, cityTax: product.cityTax, cityTaxRatePct };
  }
}
