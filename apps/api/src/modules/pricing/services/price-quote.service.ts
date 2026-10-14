import { Inject, Injectable } from '@nestjs/common';
import { type Decimal } from '@tugeel/shared/money';
import {
  MAX_QUOTE_LINES,
  type PricedPart,
  type PriceList,
  type QuoteLineInput,
  type QuoteProduct,
  type QuoteProgram,
  resolveQuote,
} from '@tugeel/shared/pricing';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import { CatalogService, CategoriesService, UnitConversionService } from '../../catalog';
import { DiscountProgramsService } from './discount-programs.service';
import { PriceProfilesService } from './price-profiles.service';
import { ProductPricesService, quoteUnitsOf } from './product-prices.service';

export interface QuoteRequest {
  list: PriceList;
  /** The Ulaanbaatar business date whose prices, profiles and programs apply. */
  date: string;
  lines: { productUnitId: number; qty: Decimal }[];
}

/** A priced part with its unit's name and factor, as an order line would freeze it. */
export interface QuotedPart extends PricedPart {
  uomName: string;
  factorSnapshot: Decimal;
}

export type QuotedResult =
  | { priced: false; problem: 'PRICE_MISSING' }
  | {
      priced: true;
      parts: QuotedPart[];
      subtotal: Decimal;
      discountAmount: Decimal;
      total: Decimal;
    };

export interface QuotedLine {
  productId: number;
  productUnitId: number;
  qty: Decimal;
  qtyBase: Decimal;
  factorSnapshot: Decimal;
  result: QuotedResult;
}

export interface Quote {
  list: PriceList;
  date: string;
  lines: QuotedLine[];
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
}

/**
 * Prices a cart (ADR-0041 #3, ADR-0048 #4): fetches the price terms, profile versions and programs
 * in force on the date and runs the pure resolver of @tugeel/shared/pricing, which splits wholesale
 * lines into whole packs and loose pieces. Orders call it with their transaction at SUBMIT; the
 * quote endpoint and the calculator call it without one.
 */
@Injectable()
export class PriceQuoteService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly units: UnitConversionService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
    private readonly programs: DiscountProgramsService,
  ) {}

  /**
   * Refuses unknown units (NOT_FOUND), superseded ones (UNIT_SUPERSEDED) and inexact quantities
   * (UNIT_FACTOR_INEXACT); a line of a product without price terms comes back with PRICE_MISSING.
   */
  async quote(request: QuoteRequest, executor: Db | Tx = this.db): Promise<Quote> {
    if (request.lines.length === 0 || request.lines.length > MAX_QUOTE_LINES) {
      throw invalid('lines', 'count', `1 to ${MAX_QUOTE_LINES} lines`);
    }
    const converted = [];
    for (const line of request.lines) {
      const base = await this.units.toBase(line.productUnitId, line.qty, executor);
      converted.push({ ...base, qty: line.qty });
    }
    const productIds = [...new Set(converted.map((line) => line.productId))];
    const summaries = await this.catalog.getMany(productIds, executor);
    const unitsByProduct = await this.units.currentUnits(productIds, executor);
    const programs = await this.programs.inForce(request.list, request.date, executor);
    const terms = await this.prices.inForce(productIds, request.date, executor);
    const versions = await this.profiles.versionsInForce(
      [...terms.values()].map((own) => own.profileId),
      request.date,
      executor,
    );
    const products = new Map<number, QuoteProduct>();
    for (const summary of summaries) {
      const own = terms.get(summary.id);
      const values = own ? versions.get(own.profileId) : undefined;
      products.set(summary.id, {
        categoryId: summary.categoryId,
        units: quoteUnitsOf(unitsByProduct.get(summary.id) ?? []),
        terms:
          own && values
            ? { warehousePrice: own.warehousePrice, wholeUomId: own.wholeUomId, profile: values }
            : null,
      });
    }
    const subtrees = new Map<number, ReadonlySet<number>>();
    const quotePrograms: QuoteProgram[] = [];
    for (const program of programs) {
      let categoryIds: ReadonlySet<number> | null = null;
      if (program.categoryId !== null) {
        categoryIds = subtrees.get(program.categoryId) ?? null;
        if (!categoryIds) {
          categoryIds = new Set(await this.categories.subtreeIds(program.categoryId, executor));
          subtrees.set(program.categoryId, categoryIds);
        }
      }
      quotePrograms.push({ ...program, categoryIds });
    }
    const inputs: QuoteLineInput[] = converted.map((line) => ({
      productId: line.productId,
      unitId: line.unitId,
      qty: line.qty,
      qtyBase: line.qtyBase,
    }));
    const result = resolveQuote(inputs, {
      list: request.list,
      products,
      programs: quotePrograms,
    });
    const unitInfo = new Map(
      [...unitsByProduct.values()].flat().map((unit) => [unit.unitId, unit] as const),
    );
    return {
      list: request.list,
      date: request.date,
      lines: converted.map((line, index): QuotedLine => {
        const priced = result.lines[index];
        return {
          productId: line.productId,
          productUnitId: line.unitId,
          qty: line.qty,
          qtyBase: line.qtyBase,
          factorSnapshot: line.factorSnapshot,
          result: priced?.priced
            ? {
                priced: true,
                parts: priced.parts.map((part) => {
                  const unit = unitInfo.get(part.unitId);
                  return {
                    ...part,
                    uomName: unit?.uomName ?? '',
                    factorSnapshot: unit?.factorToBase ?? line.factorSnapshot,
                  };
                }),
                subtotal: priced.subtotal,
                discountAmount: priced.discountAmount,
                total: priced.total,
              }
            : { priced: false, problem: 'PRICE_MISSING' },
        };
      }),
      subtotal: result.subtotal,
      discountTotal: result.discountTotal,
      total: result.total,
    };
  }
}
