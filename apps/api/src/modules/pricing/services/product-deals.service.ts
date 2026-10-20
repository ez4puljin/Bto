import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  type DealFacts,
  type DealKind,
  type DealProgram,
  dealLabel,
  dealOf,
  dealPercent,
  type DiscountScope,
  type DiscountStep,
  type PriceList,
  type QuoteProgram,
} from '@tugeel/shared/pricing';
import {
  CategoriesService,
  ProductFiltersService,
  UnitConversionService,
  UomsService,
} from '../../catalog';
import { type DiscountProgram, DiscountProgramsService } from './discount-programs.service';
import { type PackPrice, PriceQuoteService } from './price-quote.service';
import { ProductPricesService } from './product-prices.service';

/** A product's badge (ADR-0092 #3): the program behind it and its first step in words. */
export interface ProductDeal extends DealFacts {
  programId: number;
  programName: string;
  scope: DiscountScope;
  /** «10+ ш −5%», «−10% · 10/31», … (`dealLabel`). */
  label: string;
  /** How much the first step takes off in percent (the «Хямдрал ихээр» order); null unknown. */
  percent: Decimal | null;
}

/** An ORDER program in force: the cart's hint («500,000₮ хүрвэл 3%»), never a section. */
export interface OrderDealProgram {
  id: number;
  name: string;
  effect: DiscountProgram['effect'];
  steps: readonly DiscountStep[];
}

const ONE = new Decimal(1);

/**
 * The WHOLESALE discount programs in force on one business date and the products each marks
 * (ADR-0092 #3, ADR-0093): a PRODUCT program its product, a CATEGORY program every product of its
 * subtree; ORDER programs apart. Read once per request; a product in a promotion and a discount
 * counts as a promotion only.
 */
export class DealBook {
  constructor(
    readonly date: string,
    private readonly programs: ReadonlyMap<number, DiscountProgram>,
    private readonly marks: ReadonlyMap<number, readonly number[]>,
    private readonly subtrees: ReadonlyMap<number, ReadonlySet<number>>,
    readonly orderPrograms: readonly OrderDealProgram[],
  ) {}

  /** Products marked by a program with an end date. */
  promotions(): Set<number> {
    return this.productsWhere((program) => program.validTo !== null);
  }

  /** Products marked only by programs without an end date. */
  discounts(): Set<number> {
    const promotions = this.promotions();
    return new Set([...this.productsWhere(() => true)].filter((id) => !promotions.has(id)));
  }

  /** Products marked by any program: «Хямдралтай» (promotions and discounts together). */
  deals(): Set<number> {
    return this.productsWhere(() => true);
  }

  /** The programs marking a product, by id. */
  programsOf(productId: number): DiscountProgram[] {
    return (this.marks.get(productId) ?? []).flatMap((id) => {
      const program = this.programs.get(id);
      return program ? [program] : [];
    });
  }

  /** The program as the pure quote takes it (a category's subtree attached). */
  quoteProgram(program: DiscountProgram): QuoteProgram {
    return {
      id: program.id,
      name: program.name,
      scope: program.scope,
      measure: program.measure,
      effect: program.effect,
      productId: program.product?.id ?? null,
      productUnitId: program.productUnit?.id ?? null,
      categoryIds:
        program.categoryId === null ? null : (this.subtrees.get(program.categoryId) ?? null),
      countUomId: program.countUomId,
      steps: program.steps,
    };
  }

  private productsWhere(keep: (program: DiscountProgram) => boolean): Set<number> {
    const result = new Set<number>();
    for (const [productId, ids] of this.marks) {
      if (
        ids.some((id) => {
          const program = this.programs.get(id);
          return program !== undefined && keep(program);
        })
      ) {
        result.add(productId);
      }
    }
    return result;
  }
}

/**
 * «Bto300»'s view of the discount programs (ADR-0092 #3, ADR-0093): which products they mark, the
 * badge of each product, how big its discount is (the «Хямдрал ихээр» order) and the price of one
 * pack after its unconditional programs (the struck-through price). Prices stay the quote's: the
 * badge only describes the program.
 */
@Injectable()
export class ProductDealsService {
  constructor(
    private readonly programs: DiscountProgramsService,
    private readonly quotes: PriceQuoteService,
    private readonly prices: ProductPricesService,
    private readonly productFilters: ProductFiltersService,
    private readonly categories: CategoriesService,
    private readonly units: UnitConversionService,
    private readonly uoms: UomsService,
  ) {}

  /** The programs of `list` in force on `date` and the products they mark. */
  async book(list: PriceList, date: string): Promise<DealBook> {
    const views = (await this.programs.inForceViews(list, date)).filter(
      (program) => program.steps.length > 0,
    );
    const programs = new Map(views.map((program) => [program.id, program]));
    const marks = new Map<number, number[]>();
    const mark = (productId: number, programId: number) => {
      const own = marks.get(productId);
      if (own) own.push(programId);
      else marks.set(productId, [programId]);
    };
    const subtrees = new Map<number, ReadonlySet<number>>();
    for (const program of views) {
      if (program.scope === 'PRODUCT' && program.product) mark(program.product.id, program.id);
      if (program.scope === 'CATEGORY' && program.categoryId !== null) {
        if (!subtrees.has(program.categoryId)) {
          subtrees.set(
            program.categoryId,
            new Set(await this.categories.subtreeIds(program.categoryId)),
          );
        }
        const productIds = await this.productFilters.idsWhere({
          field: 'category',
          op: 'IN',
          ids: [program.categoryId],
        });
        for (const productId of productIds) mark(productId, program.id);
      }
    }
    const orderPrograms = views
      .filter((program) => program.scope === 'ORDER')
      .map((program) => ({
        id: program.id,
        name: program.name,
        effect: program.effect,
        steps: program.steps,
      }));
    return new DealBook(date, programs, marks, subtrees, orderPrograms);
  }

  /**
   * Each marked product's badge and the size of its discount: the program shown is a promotion
   * before a discount, a product's own before a category's, then the bigger discount, then the
   * older program.
   */
  async dealsOf(book: DealBook, productIds: readonly number[]): Promise<Map<number, ProductDeal>> {
    const result = new Map<number, ProductDeal>();
    const marked = [...new Set(productIds)].filter((id) => book.programsOf(id).length > 0);
    if (marked.length === 0) return result;
    const facts = await this.factsOf(book, marked);
    for (const productId of marked) {
      const ranked = book
        .programsOf(productId)
        .map((program) => ({ program, ...this.rankOf(program, facts, productId) }))
        .sort(
          (a, b) =>
            kindRank(a.kind) - kindRank(b.kind) ||
            scopeRank(a.program.scope) - scopeRank(b.program.scope) ||
            comparePercent(a.percent, b.percent) ||
            a.program.id - b.program.id,
        );
      const best = ranked[0];
      const deal = best ? dealOf(best.facts) : null;
      if (!best || !deal) continue;
      result.set(productId, {
        ...deal,
        programId: best.program.id,
        programName: best.program.name,
        scope: best.program.scope,
        label: dealLabel(deal),
        percent: best.percent,
      });
    }
    return result;
  }

  /**
   * One pack's price per base unit after the product's unconditional programs (ADR-0092 #7: a
   * first step that always applies — a PRODUCT program from at most one base unit, a CATEGORY
   * percentage from zero), with the price without them; only products that have such a program.
   */
  async packPrices(book: DealBook, productIds: readonly number[]): Promise<Map<number, PackPrice>> {
    const items = [...new Set(productIds)].flatMap((productId) => {
      const programs = book
        .programsOf(productId)
        .filter(isUnconditional)
        .map((program) => book.quoteProgram(program));
      return programs.length ? [{ productId, programs }] : [];
    });
    return this.quotes.packPrices(book.date, items);
  }

  /** The units and prices the badges of these products need, read once. */
  private async factsOf(book: DealBook, productIds: readonly number[]) {
    const units = await this.units.currentUnits(productIds);
    const terms = await this.prices.inForce(productIds, book.date);
    const countUomIds = new Set<number>();
    for (const productId of productIds) {
      for (const program of book.programsOf(productId)) {
        if (program.countUomId !== null) countUomIds.add(program.countUomId);
      }
    }
    const countNames = new Map<number, string>();
    for (const uomId of countUomIds) countNames.set(uomId, (await this.uoms.get(uomId)).name);
    return { units, terms, countNames };
  }

  private rankOf(
    program: DiscountProgram,
    facts: Awaited<ReturnType<ProductDealsService['factsOf']>>,
    productId: number,
  ): { kind: DealKind; percent: Decimal | null; facts: DealProgram } {
    const own = facts.units.get(productId) ?? [];
    const base = own.find((unit) => unit.isBase);
    const programUnit = program.productUnit
      ? {
          name: program.productUnit.uomName,
          factor: program.productUnit.factorToBase,
          isBase:
            base?.unitId === program.productUnit.id || program.productUnit.factorToBase.eq(ONE),
        }
      : null;
    const dealProgram: DealProgram = {
      scope: program.scope,
      measure: program.measure,
      effect: program.effect,
      validTo: program.validTo,
      steps: program.steps,
      baseUnitName: base?.uomName ?? null,
      thresholdUnit: program.thresholdUnit
        ? { name: program.thresholdUnit.uomName, factor: program.thresholdUnit.factorToBase }
        : null,
      countUnitName:
        program.countUomId === null ? null : (facts.countNames.get(program.countUomId) ?? null),
      programUnit,
    };
    return {
      kind: program.validTo === null ? 'DISCOUNT' : 'PROMOTION',
      percent: dealPercent(dealProgram, facts.terms.get(productId)?.warehousePrice ?? null),
      facts: dealProgram,
    };
  }
}

/** A first step that always applies (ADR-0092 #7), on prices a pack can show. */
function isUnconditional(program: DiscountProgram): boolean {
  const first = program.steps[0];
  if (!first) return false;
  if (program.scope === 'PRODUCT') return first.threshold.lte(ONE);
  // A category's tugriks off its total cannot be shown per pack; ORDER programs never are.
  return program.scope === 'CATEGORY' && program.effect === 'PERCENT' && first.threshold.isZero();
}

const kindRank = (kind: DealKind) => (kind === 'PROMOTION' ? 0 : 1);
const scopeRank = (scope: DiscountScope) => (scope === 'PRODUCT' ? 0 : 1);

/** Bigger first; an unknown size last. */
function comparePercent(a: Decimal | null, b: Decimal | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return b.comparedTo(a);
}
