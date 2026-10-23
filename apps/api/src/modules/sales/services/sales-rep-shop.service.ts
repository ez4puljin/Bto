import { Injectable } from '@nestjs/common';
import { NEW_PRODUCT_DAYS } from '@tugeel/shared/catalog';
import { Decimal } from '@tugeel/shared/money';
import { REP_PRICE_SORT_MAX, type RepProductSort } from '@tugeel/shared/sales';
import type { SegmentCondition, SegmentDefinition } from '@tugeel/shared/segments';
import { businessDate, isIsoDate } from '@tugeel/shared/time';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  invalidCursor,
  toPage,
} from '../../../common/pagination/page';
import {
  type ProductImageUrls,
  type ProductIndexRow,
  type ProductListItem,
  type ProductListQuery,
  ProductFiltersService,
  ProductQueryService,
} from '../../catalog';
import type { AuthContext } from '../../identity';
import { ProductLocationsService, StockQueryService } from '../../inventory';
import { CustomersService, ProductSuppliersService } from '../../partners';
import { ProductPricesService } from '../../pricing';
import { overdueDto } from '../overdue';
import { SalesOrdersService } from './sales-orders.service';

/** A product as the rep's shop shows it: units with their wholesale price, and the stock. */
export interface RepProduct {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  thumbUrl: string | null;
  /** Ready pictures, the primary first (the product page's pager). */
  images: ProductImageUrls[];
  /** Became sale-ready within the last NEW_PRODUCT_DAYS days: «Шинэ» (ADR-0068). */
  isNew: boolean;
  /** Active, complete and with a home warehouse: an order accepts it. */
  sellable: boolean;
  homeWarehouseId: number | null;
  /** Base units free in the home warehouse (on hand, sellable, less what is reserved). */
  available: Decimal;
  /** The home warehouse's minimum level (ADR-0039); null when none is set. */
  minLevel: Decimal | null;
  /** Base units of one whole pack, the unit the warehouse price is set in; null without one. */
  packBase: Decimal | null;
  /** One base unit in whole packs (the warehouse price), whole MNT; null without terms today. */
  basePrice: Decimal | null;
  /** The base price on the day asked for (a price-drop notice); null when not asked or none. */
  basePriceBefore: Decimal | null;
  units: {
    id: number;
    uomName: string;
    uomCode: string | null;
    factorToBase: Decimal;
    isBase: boolean;
    isDefaultSales: boolean;
    barcodes: string[];
    /** One unit at the WHOLESALE list, as a quote splits it; null without terms today. */
    wholesale: Decimal | null;
    basis: 'WAREHOUSE' | 'LOOSE' | 'MIXED' | null;
  }[];
}

/** The shop's filters and order (ADR-0068). */
export interface RepProductQuery {
  q?: string;
  /** Each with its subcategories. */
  categoryIds?: readonly number[];
  /** The products' home warehouse. */
  warehouseId?: number;
  /** Main suppliers. */
  supplierIds?: readonly number[];
  /** Only products with stock free in their home warehouse. */
  inStock?: boolean;
  /** Only these products (the customer app's favourites, ADR-0079 #4). */
  onlyIds?: readonly number[];
  /** Only products with a home warehouse (the customer app's shop, ADR-0079 #4). */
  withHome?: boolean;
  sort?: RepProductSort;
  cursor?: string;
  limit?: number;
}

export interface RepSupplier {
  id: number;
  name: string;
  productCount: number;
}

export interface RepCustomer {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  /** The default address. */
  address: string | null;
  /** The overdue receivable, whole MNT (ADR-0101: a red reminder, never a block). */
  overdue: { amount: string; oldestDueDate: string | null } | null;
}

export interface RepCustomerDetail {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  /** Active addresses, the default first. */
  addresses: { id: number; label: string | null; address: string | null; isDefault: boolean }[];
  contacts: { name: string | null; phone: string | null }[];
  /** The overdue receivable, whole MNT (ADR-0101: a red reminder, never a block). */
  overdue: { amount: string; oldestDueDate: string | null } | null;
}

const DAY_MS = 86_400_000;

/** Products with a home warehouse (the customer app's shop, ADR-0079 #4). */
const HOME_ANY: SegmentCondition = { field: 'homeWarehouse', op: 'ANY' };

/** The base units of the pack the warehouse price is set in; null for loose goods. */
function packBaseOf(row: ProductListItem, wholeUomId: number | null): Decimal | null {
  if (wholeUomId === null) return null;
  const unit = row.units.find((own) => own.uomId === wholeUomId);
  return unit && !unit.isBase ? unit.factorToBase : null;
}

/**
 * The category, home warehouse and main supplier filters as one product-list condition tree
 * (ADR-0049 #4): the owning modules answer them through the segments resolver. None set: no tree
 * (an empty one is refused).
 */
function shopWhere(query: RepProductQuery): SegmentDefinition | undefined {
  const conditions: SegmentCondition[] = [];
  if (query.categoryIds?.length) {
    conditions.push({ field: 'category', op: 'IN', ids: [...query.categoryIds] });
  }
  if (query.warehouseId !== undefined) {
    conditions.push({ field: 'homeWarehouse', op: 'IN', ids: [query.warehouseId] });
  }
  if (query.supplierIds?.length) {
    conditions.push({ field: 'supplier', op: 'MAIN_IN', ids: [...query.supplierIds] });
  }
  if (query.withHome) conditions.push(HOME_ANY);
  return conditions.length === 0
    ? undefined
    : { match: 'ALL', groups: [{ match: 'ALL', conditions }] };
}

/** A price sort's cursor: the sort, the last row's price (none when unpriced) and id, the day. */
function priceCursorOf(
  cursor: string | undefined,
  sort: RepProductSort,
): { price: string | null; id: number; date: string } | null {
  const after = decodeCursor(cursor);
  if (!after) return null;
  const price = after.p;
  if (
    after.s !== sort ||
    typeof after.id !== 'number' ||
    typeof after.d !== 'string' ||
    !isIsoDate(after.d) ||
    (price !== undefined && (typeof price !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(price)))
  ) {
    throw invalidCursor();
  }
  return { price: price ?? null, id: after.id, date: after.d };
}

/**
 * What the rep's shop and customer picker read (ADR-0061 #5, #7; ADR-0068): active, sale-ready
 * products with each unit's wholesale price and the home warehouse's stock, filtered and sorted as
 * the app asks; the suppliers to filter by; active customers with what an order needs, through
 * `CustomersService.visibleTo` (the hook reserved for rep zones). Prices come from pricing: the app
 * never computes one.
 */
@Injectable()
export class SalesRepShopService {
  constructor(
    private readonly products: ProductQueryService,
    private readonly productFilters: ProductFiltersService,
    private readonly orders: SalesOrdersService,
    private readonly prices: ProductPricesService,
    private readonly stock: StockQueryService,
    private readonly customers: CustomersService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly locations: ProductLocationsService,
  ) {}

  /**
   * One page of the shop. NEW pages through catalog's keyset; a price sort orders every product
   * the filters keep by its base price (refused above REP_PRICE_SORT_MAX, never cut short) and
   * keeps the first page's day, so a page after midnight continues the same order.
   */
  async productPage(
    query: RepProductQuery,
  ): Promise<{ data: RepProduct[]; nextCursor: string | null; total: number | null }> {
    const today = businessDate();
    const where = shopWhere(query);
    const inStock = query.inStock ? await this.stock.productIdsAvailableAtHome() : undefined;
    const onlyIds =
      query.onlyIds && inStock
        ? query.onlyIds.filter((id) => new Set(inStock).has(id))
        : (query.onlyIds ?? inStock);
    const base: ProductListQuery = {
      ...(query.q ? { q: query.q } : {}),
      status: 'ACTIVE',
      saleReady: true,
      ...(where ? { where } : {}),
      ...(onlyIds ? { onlyIds } : {}),
    };
    const sort = query.sort ?? 'NEW';
    if (sort === 'NEW') {
      const page = await this.products.query({
        ...base,
        sort: 'NEW',
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      return {
        data: await this.enrich(page.data, today),
        nextCursor: page.nextCursor,
        total: page.total,
      };
    }
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = priceCursorOf(query.cursor, sort);
    const { ids, total } = await this.products.orderedIds(base, REP_PRICE_SORT_MAX);
    if (total > REP_PRICE_SORT_MAX) {
      throw new AppError(
        'SELECTION_TOO_LARGE',
        `${total} products match, a price sort orders at most ${REP_PRICE_SORT_MAX}`,
        { count: total, limit: REP_PRICE_SORT_MAX },
      );
    }
    const date = after?.date ?? today;
    const rows = await this.prices.orderedByBasePrice(ids, {
      direction: sort === 'PRICE_ASC' ? 'ASC' : 'DESC',
      after: after ? { price: after.price, id: after.id } : null,
      limit: limit + 1,
      date,
    });
    const page = toPage(rows, limit, (row) => ({
      s: sort,
      ...(row.price === null ? {} : { p: row.price }),
      id: row.productId,
      d: date,
    }));
    const items = await this.products.listItemsOf(page.data.map((row) => row.productId));
    return {
      data: await this.enrich(items, today),
      nextCursor: page.nextCursor,
      total: query.cursor === undefined ? total : null,
    };
  }

  /**
   * Products by id (a cart refreshed, a scanned barcode, a notice), only those the shop would
   * list; with `priceBefore`, also each base price on that day (a price-drop notice's old price).
   */
  async productsOf(ids: readonly number[], priceBefore?: string): Promise<RepProduct[]> {
    if (priceBefore !== undefined && !isIsoDate(priceBefore)) {
      throw invalid('priceBefore', 'isDate', 'priceBefore must be a date');
    }
    const rows = await this.products.listItemsOf(ids);
    return this.enrich(
      rows.filter((row) => row.status === 'ACTIVE' && row.saleReadyAt !== null),
      businessDate(),
      priceBefore,
    );
  }

  /**
   * «Bto300»'s shop index (ADR-0093): every product the customer app lists — active, sale-ready,
   * with a home warehouse — in the NEW order, with its category and sale-ready moment.
   */
  index(): Promise<ProductIndexRow[]> {
    return this.products.index(
      {
        status: 'ACTIVE',
        saleReady: true,
        sort: 'NEW',
        where: { match: 'ALL', groups: [{ match: 'ALL', conditions: [HOME_ANY] }] },
      },
      REP_PRICE_SORT_MAX,
    );
  }

  /** The main suppliers of the shop's products, with how many each has, the most first. */
  async suppliers(): Promise<RepSupplier[]> {
    const counts = await this.productSuppliers.mainSupplierCounts(await this.shopIds());
    return counts.map((row) => ({
      id: row.supplierId,
      name: row.name,
      productCount: row.productCount,
    }));
  }

  /**
   * The primary picture's thumbnail of every product the shop lists: the phone downloads each one
   * once and keeps it (ADR-0068). The URLs never change; a new picture has a new URL.
   */
  async thumbs(): Promise<string[]> {
    return [...(await this.products.primaryThumbsOf(await this.shopIds())).values()];
  }

  async customerPage(
    ctx: AuthContext,
    query: { q?: string; cursor?: string; limit?: number },
  ): Promise<{ data: RepCustomer[]; nextCursor: string | null }> {
    const page = await this.customers.list(ctx, { ...query, status: 'ACTIVE' });
    const overdue = await this.customers.overdueOf(page.data.map((customer) => customer.id));
    return {
      data: page.data.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        overdue: overdueDto(overdue.get(customer.id) ?? null),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async customer(id: number): Promise<RepCustomerDetail> {
    const customer = await this.customers.get(id);
    if (customer.status !== 'ACTIVE') throw notFound('customer', id);
    return {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      addresses: customer.addresses
        .filter((address) => address.archivedAt === null)
        .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.id - b.id)
        .map((address) => ({
          id: address.id,
          label: address.label,
          address: address.address,
          isDefault: address.isDefault,
        })),
      contacts: customer.contacts.map((contact) => ({ name: contact.name, phone: contact.phone })),
      overdue: overdueDto((await this.customers.overdueOf([id])).get(id) ?? null),
    };
  }

  /** Every product the shop can list: active and sale-ready (the ACTIVE stage). */
  private shopIds() {
    return this.productFilters.idsWhere({ field: 'stage', op: 'IN', values: ['ACTIVE'] });
  }

  private async enrich(
    rows: readonly ProductListItem[],
    today: string,
    priceBefore?: string,
  ): Promise<RepProduct[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const info = new Map((await this.orders.productInfo(ids)).map((own) => [own.productId, own]));
    const prices = await this.prices.shopPricesOf(ids, today);
    const before =
      priceBefore === undefined ? null : await this.prices.shopPricesOf(ids, priceBefore);
    const images = await this.products.imagesOf(ids);
    const flags = await this.products.unitFlagsOf(ids);
    const terms = await this.prices.inForce(ids, today);
    const minLevels = new Map(
      (await this.locations.ofProductIds(ids))
        .filter((location) => location.isHome)
        .map((location) => [location.productId, location.minQty]),
    );
    const newSince = Date.now() - NEW_PRODUCT_DAYS * DAY_MS;
    return rows.map((row) => {
      const own = info.get(row.id);
      const priced = prices.get(row.id);
      const table = new Map((priced?.units ?? []).map((unit) => [unit.unitId, unit]));
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        categoryId: row.categoryId,
        thumbUrl: row.thumbUrl,
        images: images.get(row.id) ?? [],
        isNew: row.saleReadyAt !== null && row.saleReadyAt.getTime() >= newSince,
        sellable: own?.sellable === true && own.homeWarehouseId !== null,
        homeWarehouseId: own?.homeWarehouseId ?? null,
        available: own?.available ?? new Decimal(0),
        minLevel: minLevels.get(row.id) ?? null,
        packBase: packBaseOf(row, terms.get(row.id)?.wholeUomId ?? null),
        basePrice: priced?.basePrice ?? null,
        basePriceBefore: before?.get(row.id)?.basePrice ?? null,
        units: row.units.map((unit) => {
          const unitPrices = table.get(unit.id);
          const flag = flags.get(unit.id);
          return {
            id: unit.id,
            uomName: unit.uomName,
            uomCode: flag?.uomCode ?? null,
            factorToBase: unit.factorToBase,
            isBase: unit.isBase,
            isDefaultSales: flag?.isDefaultSales ?? false,
            barcodes: unit.barcodes,
            wholesale: unitPrices?.wholesale ?? null,
            basis: unitPrices?.wholesaleBasis ?? null,
          };
        }),
      };
    });
  }
}
