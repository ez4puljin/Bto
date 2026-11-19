import { Injectable } from '@nestjs/common';
import { decodeCursor, encodeCursor, invalidCursor } from '../../../common/pagination/page';
import { type AuthContext, IdempotencyKeysService } from '../../identity';
import {
  CustomerAddressesService,
  CustomerContactsService,
  CustomersService,
  ProductSuppliersService,
} from '../../partners';
import { overdueDto } from '../overdue';
import {
  type RepCustomerDetail,
  type RepShopProduct,
  SalesRepShopService,
} from './sales-rep-shop.service';

/**
 * The offline walks' pages (ADR-0225 #2): larger than the screens' lists, still bounded. Measured on
 * the development database (12,818 products, 1,404 customers): a page of 500 products about 240 ms
 * and 320 KiB of JSON, of 1,000 customers about 75 ms and 150 KiB.
 */
export const OFFLINE_PRODUCT_LIMIT = { default: 500, max: 500 } as const;
export const OFFLINE_CUSTOMER_LIMIT = { default: 1_000, max: 1_000 } as const;

/** The path the rep's order is created on, as the interceptor stores it (without the query). */
const REP_ORDER_PATH = /\/sales-rep\/orders$/;

/** A shop product as the phone keeps it: the list's row and its main supplier (the filter). */
export interface RepOfflineProduct extends RepShopProduct {
  mainSupplierId: number | null;
}

/** An active customer as the phone keeps it: the detail with the list row's address and hold. */
export interface RepOfflineCustomer extends RepCustomerDetail {
  /** The default address's text, as the list row has it. */
  address: string | null;
  /** The customer's manual credit hold (partners): the server refuses its new orders. */
  creditHold: boolean;
}

/** One key the server holds for the caller (ADR-0225 #5). */
export interface RepKnownKey {
  key: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  createdAt: Date;
  /** The order `POST /sales-rep/orders` created with this key; null for any other answer. */
  orderId: number | null;
}

/** The id after which a walk continues; 0 for the first page. */
function afterIdOf(cursor: string | undefined): number {
  const after = decodeCursor(cursor);
  if (after === undefined) return 0;
  if (typeof after.id !== 'number' || !Number.isSafeInteger(after.id) || after.id < 0) {
    throw invalidCursor();
  }
  return after.id;
}

const cursorOf = (lastId: number | null): string | null =>
  lastId === null ? null : encodeCursor({ id: lastId });

/**
 * What the staff app keeps on its disk to write an order without the server (ADR-0225 #2), and the
 * question it asks after an outage (#5). The walks are keyset by id with no search and no count, so
 * a phone walks them to the end a few times a day at the cost of the screens' own lists.
 */
@Injectable()
export class SalesRepOfflineService {
  constructor(
    private readonly shop: SalesRepShopService,
    private readonly productSuppliers: ProductSuppliersService,
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
    private readonly contacts: CustomerContactsService,
    private readonly keys: IdempotencyKeysService,
  ) {}

  /**
   * One page of every product `/sales-rep/products` shows this rep, by id: the same rows (prices,
   * stock, the badge from one deal book) and each one's main supplier.
   */
  async products(
    ctx: AuthContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: RepOfflineProduct[]; nextCursor: string | null }> {
    const afterId = afterIdOf(query.cursor);
    const scope = await this.shop.staffScope(ctx);
    const page = await this.shop.walkPage(
      scope,
      afterId,
      query.limit ?? OFFLINE_PRODUCT_LIMIT.default,
    );
    const rows = await this.shop.withDeals(page.data, await this.shop.dealBook());
    const suppliers = await this.productSuppliers.mainSupplierOf(rows.map((row) => row.id));
    return {
      data: rows.map((row) => ({ ...row, mainSupplierId: suppliers.get(row.id) ?? null })),
      nextCursor: cursorOf(page.lastId),
    };
  }

  /**
   * One page of every ACTIVE customer the rep may see (`visibleTo`), by id, each with its live
   * addresses (the default first), contacts, overdue receivable and credit hold: four batch reads
   * for the page.
   */
  async customerPage(
    ctx: AuthContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: RepOfflineCustomer[]; nextCursor: string | null }> {
    const afterId = afterIdOf(query.cursor);
    const limit = query.limit ?? OFFLINE_CUSTOMER_LIMIT.default;
    const ids = (
      await this.customers.idsWhere(ctx, { field: 'status', op: 'IN', values: ['ACTIVE'] })
    )
      .filter((id) => id > afterId)
      .sort((a, b) => a - b);
    const pageIds = ids.slice(0, limit);
    const lastId = ids.length > limit ? (pageIds[pageIds.length - 1] ?? null) : null;
    if (pageIds.length === 0) return { data: [], nextCursor: cursorOf(lastId) };
    const summaries = await this.customers.getMany(pageIds);
    const addresses = await this.addresses.ofCustomers(pageIds);
    const contacts = await this.contacts.ofCustomers(pageIds);
    const overdue = await this.customers.overdueOf(pageIds);
    const addressesOf = group(addresses, (address) => address.customerId);
    const contactsOf = group(contacts, (contact) => contact.customerId);
    const data = summaries
      // One that closed between the two reads is left out.
      .filter((customer) => customer.status === 'ACTIVE')
      .sort((a, b) => a.id - b.id)
      .map((customer) => ({
        id: customer.id,
        code: customer.code,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        creditHold: customer.creditHold,
        addresses: (addressesOf.get(customer.id) ?? [])
          .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.id - b.id)
          .map((address) => ({
            id: address.id,
            label: address.label,
            address: address.address,
            isDefault: address.isDefault,
          })),
        contacts: (contactsOf.get(customer.id) ?? [])
          .sort((a, b) => a.id - b.id)
          .map((contact) => ({ name: contact.name, phone: contact.phone })),
        overdue: overdueDto(overdue.get(customer.id) ?? null),
      }));
    return { data, nextCursor: cursorOf(lastId) };
  }

  /**
   * The caller's keys among `keys` that the server holds, with the order a completed rep order
   * created (ADR-0225 #5); keys the server does not hold are left out.
   */
  async knownOrders(ctx: AuthContext, keys: readonly string[]): Promise<RepKnownKey[]> {
    const spelled = new Map(keys.map((key) => [key.toLowerCase(), key]));
    const rows = await this.keys.knownToStaff(ctx.userId, keys);
    return rows
      .map((row) => ({
        key: spelled.get(row.key) ?? row.key,
        status: row.status,
        createdAt: row.createdAt,
        orderId:
          row.status === 'COMPLETED' &&
          row.method === 'POST' &&
          REP_ORDER_PATH.test(row.path) &&
          row.responseStatus === 201
            ? row.resultId
            : null,
      }))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.key.localeCompare(b.key));
  }
}

function group<T>(rows: readonly T[], keyOf: (row: T) => number): Map<number, T[]> {
  const result = new Map<number, T[]>();
  for (const row of rows) {
    const list = result.get(keyOf(row));
    if (list) list.push(row);
    else result.set(keyOf(row), [row]);
  }
  return result;
}
