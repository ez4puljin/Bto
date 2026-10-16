import { Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { notFound } from '../../../common/errors/app-error';
import { type ProductListItem, ProductQueryService } from '../../catalog';
import type { AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { ProductPricesService } from '../../pricing';
import { SalesOrdersService } from './sales-orders.service';

/** A product as the rep's shop shows it: units with their wholesale price, and the stock. */
export interface RepProduct {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  thumbUrl: string | null;
  /** Active, complete and with a home warehouse: an order accepts it. */
  sellable: boolean;
  /** Base units free in the home warehouse (on hand, sellable, less what is reserved). */
  available: Decimal;
  units: {
    id: number;
    uomName: string;
    factorToBase: Decimal;
    isBase: boolean;
    barcodes: string[];
    /** One unit at the WHOLESALE list, as a quote splits it; null without terms today. */
    wholesale: Decimal | null;
    basis: 'WAREHOUSE' | 'LOOSE' | 'MIXED' | null;
  }[];
}

export interface RepCustomer {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  /** The default address. */
  address: string | null;
}

export interface RepCustomerDetail {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  /** Active addresses, the default first. */
  addresses: { id: number; label: string | null; address: string | null; isDefault: boolean }[];
  contacts: { name: string | null; phone: string | null }[];
}

/**
 * What the rep's shop and customer picker read (ADR-0061 #5, #7): active, sale-ready products with
 * each unit's wholesale price and the home warehouse's stock; active customers with what an order
 * needs, through `CustomersService.visibleTo` (the hook reserved for rep zones). Prices come from
 * pricing: the app never computes one.
 */
@Injectable()
export class SalesRepShopService {
  constructor(
    private readonly products: ProductQueryService,
    private readonly orders: SalesOrdersService,
    private readonly prices: ProductPricesService,
    private readonly customers: CustomersService,
  ) {}

  async productPage(query: {
    q?: string;
    categoryId?: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: RepProduct[]; nextCursor: string | null }> {
    const page = await this.products.query({ ...query, status: 'ACTIVE', saleReady: true });
    return { data: await this.enrich(page.data), nextCursor: page.nextCursor };
  }

  /** Products by id (a cart refreshed, a scanned barcode), only those the shop would list. */
  async productsOf(ids: readonly number[]): Promise<RepProduct[]> {
    const rows = await this.products.listItemsOf(ids);
    return this.enrich(rows.filter((row) => row.status === 'ACTIVE' && row.saleReadyAt !== null));
  }

  async customerPage(
    ctx: AuthContext,
    query: { q?: string; cursor?: string; limit?: number },
  ): Promise<{ data: RepCustomer[]; nextCursor: string | null }> {
    const page = await this.customers.list(ctx, { ...query, status: 'ACTIVE' });
    return {
      data: page.data.map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
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
    };
  }

  private async enrich(rows: readonly ProductListItem[]): Promise<RepProduct[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const info = new Map((await this.orders.productInfo(ids)).map((own) => [own.productId, own]));
    const tables = await this.prices.tablesOf(ids);
    return rows.map((row) => {
      const own = info.get(row.id);
      const table = new Map((tables.get(row.id) ?? []).map((prices) => [prices.unitId, prices]));
      return {
        id: row.id,
        sku: row.sku,
        name: row.name,
        categoryId: row.categoryId,
        thumbUrl: row.thumbUrl,
        sellable: own?.sellable === true && own.homeWarehouseId !== null,
        available: own?.available ?? new Decimal(0),
        units: row.units.map((unit) => {
          const prices = table.get(unit.id);
          return {
            id: unit.id,
            uomName: unit.uomName,
            factorToBase: unit.factorToBase,
            isBase: unit.isBase,
            barcodes: unit.barcodes,
            wholesale: prices?.wholesale ?? null,
            basis: prices?.wholesaleBasis ?? null,
          };
        }),
      };
    });
  }
}
