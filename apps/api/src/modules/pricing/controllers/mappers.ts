import { Decimal } from '@tugeel/shared/money';
import type { PriceProfileValues } from '@tugeel/shared/pricing';
import type {
  PriceProfileDto,
  PriceProfileValuesDto,
  PriceProfileValuesInputDto,
} from '../dto/price-profiles.dto';
import type { DiscountProgramDto, DiscountProgramInputDto, QuoteDto } from '../dto/pricing.dto';
import type { PriceTermsDto, ProductPriceViewDto } from '../dto/product-prices.dto';
import type { DiscountProgram, DiscountProgramInput } from '../services/discount-programs.service';
import type { Quote } from '../services/price-quote.service';
import type { PriceProfile, PriceProfileVersion } from '../services/price-profiles.service';
import type { PriceTerms, ProductPriceView } from '../services/product-prices.service';

export function toValuesInput(body: PriceProfileValuesInputDto): PriceProfileValues {
  return {
    looseMarkupPct: new Decimal(body.looseMarkupPct),
    retailMarkupPct: new Decimal(body.retailMarkupPct),
    retailBulkMinQty:
      body.retailBulkMinQty === undefined || body.retailBulkMinQty === null
        ? null
        : new Decimal(body.retailBulkMinQty),
    retailBulkMarkupPct:
      body.retailBulkMarkupPct === undefined || body.retailBulkMarkupPct === null
        ? null
        : new Decimal(body.retailBulkMarkupPct),
    rounding: body.rounding,
  };
}

export function toValuesDto(values: PriceProfileValues): PriceProfileValuesDto {
  return {
    looseMarkupPct: values.looseMarkupPct.toFixed(2),
    retailMarkupPct: values.retailMarkupPct.toFixed(2),
    retailBulkMinQty: values.retailBulkMinQty?.toString() ?? null,
    retailBulkMarkupPct: values.retailBulkMarkupPct?.toFixed(2) ?? null,
    rounding: values.rounding,
  };
}

function toVersionDto(version: PriceProfileVersion) {
  return {
    id: version.id,
    validFrom: version.validFrom,
    validTo: version.validTo,
    ...toValuesDto(version),
  };
}

export function toPriceProfileDto(profile: PriceProfile): PriceProfileDto {
  return {
    id: profile.id,
    name: profile.name,
    archivedAt: profile.archivedAt?.toISOString() ?? null,
    current: profile.current ? toVersionDto(profile.current) : null,
    scheduled: profile.scheduled.map(toVersionDto),
    history: profile.history.map(toVersionDto),
    productsToday: profile.productsToday,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function toTermsDto(terms: PriceTerms): PriceTermsDto {
  return {
    id: terms.id,
    warehousePrice: terms.warehousePrice.toFixed(0),
    profileId: terms.profileId,
    profileName: terms.profileName,
    wholeUomId: terms.wholeUomId,
    validFrom: terms.validFrom,
    validTo: terms.validTo,
  };
}

export function toProductPriceViewDto(view: ProductPriceView): ProductPriceViewDto {
  return {
    productId: view.productId,
    today: view.today,
    units: view.units.map((unit) => ({ ...unit, factorToBase: unit.factorToBase.toString() })),
    current: view.current ? toTermsDto(view.current) : null,
    profile: view.profile
      ? {
          id: view.profile.id,
          name: view.profile.name,
          archived: view.profile.archived,
          values: view.profile.values ? toValuesDto(view.profile.values) : null,
        }
      : null,
    wholeUnitId: view.wholeUnitId,
    problems: view.problems,
    table: view.table.map((row) => ({
      productUnitId: row.unitId,
      wholesale: row.wholesale.toFixed(0),
      wholesaleBasis: row.wholesaleBasis,
      retail: row.retail.toFixed(0),
      retailBulk: row.retailBulk?.toFixed(0) ?? null,
    })),
    scheduled: view.scheduled.map(toTermsDto),
    history: view.history.map(toTermsDto),
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
        parts: result.priced
          ? result.parts.map((part) => ({
              productUnitId: part.unitId,
              uomName: part.uomName,
              factorSnapshot: part.factorSnapshot.toString(),
              qty: part.qty.toString(),
              qtyBase: part.qtyBase.toString(),
              basis: part.basis,
              listPrice: part.listPrice.toFixed(0),
              unitPrice: part.unitPrice.toFixed(0),
              subtotal: part.subtotal.toFixed(0),
              discountAmount: part.discountAmount.toFixed(0),
              total: part.total.toFixed(0),
              applied: part.applied.map((entry) => ({
                programId: entry.programId,
                name: entry.name,
                scope: entry.scope,
                effect: entry.effect,
                threshold: entry.threshold.toString(),
                value: entry.value.toString(),
                amount: entry.amount?.toFixed(0) ?? null,
              })),
            }))
          : [],
        subtotal: result.priced ? result.subtotal.toFixed(0) : null,
        discountAmount: result.priced ? result.discountAmount.toFixed(0) : null,
        total: result.priced ? result.total.toFixed(0) : null,
      };
    }),
    subtotal: quote.subtotal.toFixed(0),
    discountTotal: quote.discountTotal.toFixed(0),
    total: quote.total.toFixed(0),
  };
}
