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
    retailMarkupAmount: new Decimal(body.retailMarkupAmount ?? 0),
    retailBulkDiscountPct:
      body.retailBulkDiscountPct === undefined || body.retailBulkDiscountPct === null
        ? null
        : new Decimal(body.retailBulkDiscountPct),
    retailRounding: body.retailRounding ?? null,
    retailBulkRounding: body.retailBulkRounding ?? null,
  };
}

export function toValuesDto(values: PriceProfileValues): PriceProfileValuesDto {
  return {
    looseMarkupPct: values.looseMarkupPct.toFixed(2),
    retailMarkupPct: values.retailMarkupPct.toFixed(2),
    retailBulkMinQty: values.retailBulkMinQty?.toString() ?? null,
    retailBulkMarkupPct: values.retailBulkMarkupPct?.toFixed(2) ?? null,
    rounding: values.rounding,
    retailMarkupAmount: (values.retailMarkupAmount ?? new Decimal(0)).toFixed(0),
    retailBulkDiscountPct: values.retailBulkDiscountPct?.toFixed(2) ?? null,
    retailRounding: values.retailRounding ?? null,
    retailBulkRounding: values.retailBulkRounding ?? null,
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
    status: profile.status,
    current: profile.current ? toVersionDto(profile.current) : null,
    scheduled: profile.scheduled.map(toVersionDto),
    history: profile.history.map(toVersionDto),
    productsToday: profile.productsToday,
    createdByName: profile.createdByName,
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
    state: body.state ?? 'ACTIVE',
    priority: body.priority ?? false,
    scope: body.scope,
    measure: body.measure,
    effect: body.effect,
    productId: body.productId ?? null,
    productUnitId: body.productUnitId ?? null,
    thresholdUnitId: body.thresholdUnitId ?? null,
    categoryId: body.categoryId ?? null,
    countUomId: body.countUomId ?? null,
    targetKind: body.targetKind ?? null,
    targetIds: body.targetIds ?? [],
    excludeTargetIds: body.excludeTargetIds ?? [],
    excludeProductIds: body.excludeProductIds ?? [],
    adjustKind: body.adjustKind ?? 'NONE',
    adjustFactor: body.adjustFactor ?? 1,
    pipelineIds: body.pipelineIds ?? [],
    tillIds: body.tillIds ?? [],
    validFrom: body.validFrom,
    validTo: body.validTo ?? null,
    steps: body.steps.map((step) => ({
      threshold: new Decimal(step.threshold),
      value: new Decimal(step.value),
      ...(step.rule ? { rule: step.rule } : {}),
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
      ...(step.rule ? { rule: step.rule } : {}),
    })),
    createdAt: program.createdAt.toISOString(),
    updatedAt: program.updatedAt.toISOString(),
  };
}

export function toQuoteDto(quote: Quote): QuoteDto {
  const totalPlaces =
    quote.list === 'RETAIL' && quote.lines.some((line) => line.expiryBarcode) ? 2 : 0;
  return {
    list: quote.list,
    date: quote.date,
    lines: quote.lines.map((line) => {
      const result = line.result;
      const unitPlaces = line.expiryBarcode ? 2 : 0;
      const linePlaces = line.expiryBarcode && quote.list === 'RETAIL' ? 2 : 0;
      return {
        ...(line.expiryBarcode ? { expiryBarcode: line.expiryBarcode } : {}),
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
              listPrice: part.listPrice.toFixed(unitPlaces),
              unitPrice: part.unitPrice.toFixed(unitPlaces),
              subtotal: part.subtotal.toFixed(linePlaces),
              discountAmount: part.discountAmount.toFixed(linePlaces),
              total: part.total.toFixed(linePlaces),
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
        subtotal: result.priced ? result.subtotal.toFixed(linePlaces) : null,
        discountAmount: result.priced ? result.discountAmount.toFixed(linePlaces) : null,
        total: result.priced ? result.total.toFixed(linePlaces) : null,
        bonus: line.bonus
          ? {
              n: line.bonus.n.toFixed(),
              m: line.bonus.m.toFixed(),
              freeQty: line.bonus.freeQty.toFixed(),
              paidQty: line.bonus.paidQty.toFixed(),
              freeQtyBase: line.bonus.freeQtyBase.toFixed(),
              freeAmount: line.bonus.freeAmount.toFixed(0),
            }
          : null,
      };
    }),
    subtotal: quote.subtotal.toFixed(totalPlaces),
    discountTotal: quote.discountTotal.toFixed(totalPlaces),
    total: quote.total.toFixed(totalPlaces),
  };
}
