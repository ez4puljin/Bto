import { Decimal } from '@tugeel/shared/money';
import type {
  DiscountProgramDto,
  DiscountProgramInputDto,
  PricePeriodDto,
  ProductPricesDto,
  QuoteDto,
  UnitPriceViewDto,
} from '../dto/pricing.dto';
import type { DiscountProgram, DiscountProgramInput } from '../services/discount-programs.service';
import type { Quote } from '../services/price-quote.service';
import type { PricePeriod, ProductPrices, UnitPriceView } from '../services/unit-prices.service';

function toPeriodDto(period: PricePeriod): PricePeriodDto {
  return {
    id: period.id,
    price: period.price.toFixed(0),
    validFrom: period.validFrom,
    validTo: period.validTo,
  };
}

function toUnitPriceDto(view: UnitPriceView): UnitPriceViewDto {
  return {
    productUnitId: view.productUnitId,
    uomName: view.uomName,
    factorToBase: view.factorToBase.toString(),
    isBase: view.isBase,
    current: view.current
      ? {
          price: view.current.price.toFixed(0),
          source: view.current.source,
          period: view.current.period ? toPeriodDto(view.current.period) : null,
        }
      : null,
    scheduled: view.scheduled.map(toPeriodDto),
    history: view.history.map(toPeriodDto),
  };
}

export function toProductPricesDto(prices: ProductPrices): ProductPricesDto {
  return {
    productId: prices.productId,
    today: prices.today,
    wholesale: prices.lists.WHOLESALE.map(toUnitPriceDto),
    retail: prices.lists.RETAIL.map(toUnitPriceDto),
  };
}

export function toProgramInput(body: DiscountProgramInputDto): DiscountProgramInput {
  return {
    name: body.name,
    list: body.list,
    scope: body.scope,
    measure: body.measure,
    effect: body.effect,
    productId: body.productId ?? null,
    productUnitId: body.productUnitId ?? null,
    thresholdUnitId: body.thresholdUnitId ?? null,
    categoryId: body.categoryId ?? null,
    countUomId: body.countUomId ?? null,
    validFrom: body.validFrom,
    validTo: body.validTo ?? null,
    steps: body.steps.map((step) => ({
      threshold: new Decimal(step.threshold),
      value: new Decimal(step.value),
    })),
  };
}

export function toProgramDto(program: DiscountProgram): DiscountProgramDto {
  return {
    ...program,
    productUnit: program.productUnit
      ? { ...program.productUnit, factorToBase: program.productUnit.factorToBase.toString() }
      : null,
    thresholdUnit: program.thresholdUnit
      ? { ...program.thresholdUnit, factorToBase: program.thresholdUnit.factorToBase.toString() }
      : null,
    steps: program.steps.map((step) => ({
      threshold: step.threshold.toString(),
      value: step.value.toString(),
    })),
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
  };
}

export function toQuoteDto(quote: Quote): QuoteDto {
  return {
    list: quote.list,
    date: quote.date,
    lines: quote.lines.map((line) => {
      const result = line.result;
      return {
        productId: line.productId,
        productUnitId: line.productUnitId,
        qty: line.qty.toString(),
        qtyBase: line.qtyBase.toString(),
        priced: result.priced,
        problem: result.priced ? null : result.problem,
        listPrice: result.priced ? result.listPrice.toFixed(0) : null,
        priceSource: result.priced ? result.priceSource : null,
        unitPrice: result.priced ? result.unitPrice.toFixed(0) : null,
        subtotal: result.priced ? result.subtotal.toFixed(0) : null,
        discountAmount: result.priced ? result.discountAmount.toFixed(0) : null,
        total: result.priced ? result.total.toFixed(0) : null,
        applied: result.priced
          ? result.applied.map((entry) => ({
              programId: entry.programId,
              name: entry.name,
              scope: entry.scope,
              effect: entry.effect,
              threshold: entry.threshold.toString(),
              value: entry.value.toString(),
              amount: entry.amount?.toFixed(0) ?? null,
            }))
          : [],
      };
    }),
    subtotal: quote.subtotal.toFixed(0),
    discountTotal: quote.discountTotal.toFixed(0),
    total: quote.total.toFixed(0),
  };
}
