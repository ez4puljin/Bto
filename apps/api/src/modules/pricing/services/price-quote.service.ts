import { Inject, Injectable } from '@nestjs/common';
import { type Decimal } from '@tugeel/shared/money';
import {
  MAX_QUOTE_LINES,
  type PriceList,
  type QuoteLineInput,
  type QuoteLineResult,
  type QuoteProduct,
  type QuoteProgram,
  resolveQuote,
} from '@tugeel/shared/pricing';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { invalid } from '../../../common/errors/app-error';
import { CatalogService, CategoriesService, UnitConversionService } from '../../catalog';
import { DiscountProgramsService } from './discount-programs.service';
import { UnitPricesService } from './unit-prices.service';

export interface QuoteRequest {
  list: PriceList;
  /** The Ulaanbaatar business date whose prices and programs apply. */
  date: string;
  lines: { productUnitId: number; qty: Decimal }[];
}

export interface QuotedLine {
  productId: number;
  productUnitId: number;
  qty: Decimal;
  qtyBase: Decimal;
  factorSnapshot: Decimal;
  result: QuoteLineResult;
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
 * Prices a cart (ADR-0041 #3): fetches the prices and programs in force on the date and runs the
 * pure resolver of @tugeel/shared/pricing. Orders call it with their transaction at SUBMIT
 * (delivery 2); the quote endpoint and the calculator call it without one.
 */
@Injectable()
export class PriceQuoteService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly catalog: CatalogService,
    private readonly categories: CategoriesService,
    private readonly units: UnitConversionService,
    private readonly prices: UnitPricesService,
    private readonly programs: DiscountProgramsService,
  ) {}

  /**
   * Refuses unknown units (NOT_FOUND), superseded ones (UNIT_SUPERSEDED) and inexact quantities
   * (UNIT_FACTOR_INEXACT); a line without a price comes back with PRICE_MISSING.
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
    const [summaries, unitsByProduct, programs] = await Promise.all([
      this.catalog.getMany(productIds, executor),
      this.units.currentUnits(productIds, executor),
      this.programs.inForce(request.list, request.date, executor),
    ]);
    const products = new Map<number, QuoteProduct>();
    for (const summary of summaries) {
      products.set(summary.id, {
        categoryId: summary.categoryId,
        units: (unitsByProduct.get(summary.id) ?? []).map((unit) => ({
          unitId: unit.unitId,
          uomId: unit.uomId,
          factor: unit.factorToBase,
          isBase: unit.isBase,
        })),
      });
    }
    const prices = await this.prices.inForce(
      request.list,
      [...unitsByProduct.values()].flat().map((unit) => unit.unitId),
      request.date,
      executor,
    );
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
    const result = resolveQuote(inputs, { products, prices, programs: quotePrograms });
    return {
      list: request.list,
      date: request.date,
      lines: converted.map((line, index) => ({
        productId: line.productId,
        productUnitId: line.unitId,
        qty: line.qty,
        qtyBase: line.qtyBase,
        factorSnapshot: line.factorSnapshot,
        result: result.lines[index] ?? { priced: false, problem: 'PRICE_MISSING' },
      })),
      subtotal: result.subtotal,
      discountTotal: result.discountTotal,
      total: result.total,
    };
  }
}
