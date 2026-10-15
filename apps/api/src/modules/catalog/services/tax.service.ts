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

/** The company's rates on a day (ADR-0060 #3): zero for a tax the company does not pay. */
export interface CompanyTaxRates {
  vatPayer: boolean;
  cityTaxPayer: boolean;
  vatRatePct: Decimal;
  cityTaxRatePct: Decimal;
}

export interface TaxProduct {
  vatType: VatType;
  cityTax: boolean | null;
}

/**
 * Tax attributes of a product with the effective-dated rates on an Ulaanbaatar business date
 * (ADR-0010). `rates` is mechanical: whether the company itself pays VAT or city tax is applied by
 * `companyRates` + `ratesFor`, which invoices use (ADR-0060 #3).
 */
@Injectable()
export class TaxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The company's position on a day: an unset payer flag means the tax is not paid, and a rate is
   * read only for a tax the company pays (so an unset rate matters only then).
   */
  async companyRates(
    onDate: string = businessDate(),
    executor: Db | Tx = this.db,
  ): Promise<CompanyTaxRates> {
    const vatPayer = (await this.settings.find('company.vat_payer', onDate, executor)) === true;
    const cityTaxPayer =
      (await this.settings.find('company.city_tax_payer', onDate, executor)) === true;
    return {
      vatPayer,
      cityTaxPayer,
      vatRatePct: vatPayer
        ? new Decimal(await this.settings.get('tax.vat_rate_pct', onDate, executor))
        : new Decimal(0),
      cityTaxRatePct: cityTaxPayer
        ? new Decimal(await this.settings.get('tax.city_tax_rate_pct', onDate, executor))
        : new Decimal(0),
    };
  }

  /**
   * A product's rates under the company's position: VAT for VAT_ABLE products of a VAT payer; city
   * tax for products carrying it when the company pays it — then a product whose city-tax decision
   * is still open is refused (TAX_ATTRIBUTES_MISSING), otherwise that attribute is left alone.
   */
  ratesFor(
    product: TaxProduct & { id?: number },
    company: CompanyTaxRates,
  ): { vatRatePct: Decimal; cityTaxRatePct: Decimal } {
    const vatRatePct =
      company.vatPayer && product.vatType === 'VAT_ABLE' ? company.vatRatePct : new Decimal(0);
    if (!company.cityTaxPayer) return { vatRatePct, cityTaxRatePct: new Decimal(0) };
    if (product.cityTax === null) {
      throw new AppError('TAX_ATTRIBUTES_MISSING', 'the product has no city-tax decision', {
        id: product.id ?? null,
        attribute: 'cityTax',
      });
    }
    return {
      vatRatePct,
      cityTaxRatePct: product.cityTax ? company.cityTaxRatePct : new Decimal(0),
    };
  }

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
