import type { Decimal } from '@tugeel/shared/money';
import type { ProductDeal } from '../../pricing';
import type { SalesRepDealDto, SalesRepProductDto } from '../dto/sales-rep.dto';
import type { RepShopProduct } from '../services/sales-rep-shop.service';

/** Prices in whole MNT, as every rep route serialises them. */
export const repMoney = (value: Decimal | null): string | null => (value ? value.toFixed(0) : null);

/**
 * A rep product on the wire: the shop, the batch and the rep home (customer module) all send this
 * one shape, so the phone draws one card.
 */
export function toRepProductDto(product: RepShopProduct): SalesRepProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    categoryId: product.categoryId,
    thumbUrl: product.thumbUrl,
    images: product.images,
    isNew: product.isNew,
    sellable: product.sellable,
    homeWarehouseId: product.homeWarehouseId,
    available: product.available.toString(),
    basePrice: repMoney(product.basePrice),
    basePriceBefore: repMoney(product.basePriceBefore),
    dealPrice: repMoney(product.dealPrice),
    deal: product.deal === null ? null : toRepDealDto(product.deal),
    units: product.units.map((unit) => ({
      id: unit.id,
      uomName: unit.uomName,
      uomCode: unit.uomCode,
      factorToBase: unit.factorToBase.toString(),
      isBase: unit.isBase,
      isDefaultSales: unit.isDefaultSales,
      barcodes: unit.barcodes,
      wholesale: repMoney(unit.wholesale),
      basis: unit.basis,
    })),
  };
}

/**
 * A program's badge on the wire, for both apps: the customer module's `dealDto` is this one
 * (`CustomerAppDeal` has the same shape), so the rule lives here, where sales can reach it.
 */
export function toRepDealDto(deal: ProductDeal): SalesRepDealDto {
  return {
    kind: deal.kind,
    label: deal.label,
    programId: deal.programId,
    programName: deal.programName,
    scope: deal.scope,
    effect: deal.effect,
    value: deal.value.toString(),
    threshold:
      deal.threshold === null
        ? null
        : 'qty' in deal.threshold
          ? { qty: deal.threshold.qty.toString(), unitName: deal.threshold.unitName, amount: null }
          : { qty: null, unitName: null, amount: deal.threshold.amount.toFixed(0) },
    perUnitName: deal.perUnitName,
    lastDay: deal.lastDay,
  };
}
