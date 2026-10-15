import { Inject, Injectable } from '@nestjs/common';
import { formatDocNumber } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import type { PriceBasis } from '@tugeel/shared/pricing';
import {
  type Fulfilment,
  isCancellable,
  ORDER_LIMITS,
  type OrderChannel,
  orderHeaderIssues,
  type OrderStatus,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { businessDate, businessYear } from '@tugeel/shared/time';
import { and, asc, desc, eq, ilike, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, type ProductSummary, UnitConversionService } from '../../catalog';
import { type Actor, actorUserId, AuditService, NumberingService } from '../../identity';
import { ProductLocationsService, ReservationService } from '../../inventory';
import { CustomerAddressesService, CustomersService } from '../../partners';
import { PriceQuoteService } from '../../pricing';
import { orderStatusEvents, salesOrderLineParts, salesOrderLines, salesOrders } from '../schema';
import { CreditChecker } from './credit-checker';

type OrderRow = typeof salesOrders.$inferSelect;
type LineRow = typeof salesOrderLines.$inferSelect;

export interface OrderLineInput {
  productUnitId: number;
  /** In the unit. */
  qty: Decimal;
}

export interface OrderInput {
  customerId: number;
  fulfilment: Fulfilment;
  deliveryDate: string;
  addressId: number | null;
  contactName: string | null;
  contactPhone: string | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  lines: readonly OrderLineInput[];
}

export interface OrderPart {
  productUnitId: number;
  uomName: string;
  basis: PriceBasis;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  listPrice: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
  applied: unknown;
}

export interface OrderLine {
  id: number;
  lineNo: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  unitName: string;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  baseUnitName: string;
  warehouseId: number;
  qtyApproved: Decimal;
  qtyBackordered: Decimal;
  subtotal: Decimal | null;
  discountAmount: Decimal | null;
  total: Decimal | null;
  parts: OrderPart[];
}

export interface OrderEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string | null;
  actorId: number | null;
  createdAt: Date;
}

export interface OrderDetail extends Omit<OrderRow, 'createdBy' | 'submittedBy' | 'cancelledBy'> {
  customerCode: string;
  customerName: string;
  lines: OrderLine[];
  events: OrderEvent[];
}

export interface OrderSummary {
  id: number;
  number: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  customerId: number;
  customerCode: string;
  customerName: string;
  fulfilment: Fulfilment;
  deliveryDate: string;
  total: Decimal | null;
  lineCount: number;
  createdAt: Date;
}

export interface OrderQuery {
  status?: OrderStatus;
  customerId?: number;
  /** Part of the order number. */
  q?: string;
  cursor?: string;
  limit?: number;
}

/** What the order screen shows for a product it may add (ADR-0055 #3). */
export interface ProductOrderInfo {
  productId: number;
  homeWarehouseId: number | null;
  /** Active and complete (ADR-0044). */
  sellable: boolean;
  /** Base units available in the home warehouse. */
  available: Decimal;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/**
 * Customer orders entered by the office (architecture §5.6, ADR-0055). A draft holds the header
 * and its lines; the submit confirms it in one transaction: the order row, then the customer row
 * (credit check), then the quote, then the stock rows of every line's home warehouse in key order,
 * the `SO-` number last. A confirmed order is never edited; it is cancelled with a reason, which
 * releases its reservations.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly customers: CustomersService,
    private readonly addresses: CustomerAddressesService,
    private readonly locations: ProductLocationsService,
    private readonly reservations: ReservationService,
    private readonly quotes: PriceQuoteService,
    private readonly credit: CreditChecker,
  ) {}

  async create(actor: Actor, input: OrderInput): Promise<OrderDetail> {
    const id = await inTransaction(this.db, async (tx) => {
      const header = await this.checkedHeader(tx, input);
      const [row] = await tx
        .insert(salesOrders)
        .values({ ...header, channel: 'ADMIN', createdBy: actorUserId(actor) })
        .returning({ id: salesOrders.id });
      if (!row) throw new Error('sales order insert returned no row');
      await this.writeLines(tx, row.id, input.lines);
      await this.event(tx, actor, row.id, null, 'DRAFT', null);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'sales_orders',
        entityId: row.id,
        after: { ...header, lines: input.lines.length },
      });
      return row.id;
    });
    return this.get(id);
  }

  /** Replaces a draft's header and lines. */
  async update(actor: Actor, id: number, input: OrderInput): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== 'DRAFT') throw stateError(order, 'DRAFT');
      if (input.customerId !== order.customerId) {
        throw invalid('customerId', 'fixed', 'the customer of an order does not change');
      }
      const header = await this.checkedHeader(tx, input);
      await tx
        .update(salesOrders)
        .set({ ...header, updatedAt: sql`now()` })
        .where(eq(salesOrders.id, id));
      await tx.delete(salesOrderLines).where(eq(salesOrderLines.orderId, id));
      await this.writeLines(tx, id, input.lines);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'sales_orders',
        entityId: id,
        after: { ...header, lines: input.lines.length },
      });
    });
    return this.get(id);
  }

  /**
   * DRAFT → CONFIRMED in one transaction (ADR-0055 #1): the products checked again, the prices of
   * today frozen per part, the stock reserved per line in its product's home warehouse (the rest
   * backordered), the `SO-` number allocated last.
   */
  async submit(actor: Actor, id: number): Promise<OrderDetail> {
    await inTransaction(this.db, async (tx) => {
      const order = await this.lock(tx, id);
      if (order.status !== 'DRAFT') throw stateError(order, 'DRAFT');
      const today = businessDate();
      for (const issue of orderHeaderIssues(
        {
          fulfilment: order.fulfilment,
          deliveryDate: order.deliveryDate,
          addressId: order.addressId,
          contactPhone: order.contactPhone,
        },
        today,
      )) {
        throw invalid(issue.path, issue.code, `${issue.path}: ${issue.code}`);
      }
      const customer = await this.customers.lockForUpdate(tx, order.customerId);
      if (customer.status !== 'ACTIVE') {
        throw new AppError('CUSTOMER_INACTIVE', `customer ${customer.id} is inactive`, {
          id: customer.id,
        });
      }
      const lines = await tx
        .select()
        .from(salesOrderLines)
        .where(eq(salesOrderLines.orderId, id))
        .orderBy(asc(salesOrderLines.lineNo));
      if (lines.length === 0) throw invalid('lines', 'min', 'an order needs a line');
      const homes = await this.assertOrderable(
        tx,
        lines.map((line) => line.productId),
      );
      const quote = await this.quotes.quote(
        {
          list: 'WHOLESALE',
          date: today,
          lines: lines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
        },
        tx,
      );
      const unpriced = quote.lines.flatMap((quoted, index) =>
        quoted.result.priced ? [] : [index],
      );
      if (unpriced.length > 0) {
        const products = await this.catalog.getMany(
          unpriced.map((index) => lines[index]?.productId ?? 0),
          tx,
        );
        const sku = new Map(products.map((product) => [product.id, product.sku]));
        throw new AppError(
          'PRICE_MISSING',
          'a line has no price today',
          { count: unpriced.length },
          unpriced.map((index) => ({
            path: `lines.${index}`,
            constraint: 'priced',
            message: sku.get(lines[index]?.productId ?? 0) ?? '',
          })),
        );
      }
      const decision = await this.credit.check(tx, customer, quote.total);
      if (decision !== 'OK') {
        throw new AppError(
          decision === 'BLOCKED' ? 'CREDIT_BLOCKED' : 'CREDIT_NEEDS_APPROVAL',
          'the credit check did not pass',
        );
      }

      const parts: (typeof salesOrderLineParts.$inferInsert)[] = [];
      for (const [index, line] of lines.entries()) {
        const quoted = quote.lines[index];
        if (!quoted?.result.priced) continue;
        const result = quoted.result;
        const warehouseId = homes.get(line.productId) ?? line.warehouseId;
        await tx
          .update(salesOrderLines)
          .set({
            warehouseId,
            subtotal: result.subtotal,
            discountAmount: result.discountAmount,
            total: result.total,
          })
          .where(eq(salesOrderLines.id, line.id));
        line.warehouseId = warehouseId;
        result.parts.forEach((part, partIndex) => {
          parts.push({
            lineId: line.id,
            partNo: partIndex + 1,
            productUnitId: part.unitId,
            uomName: part.uomName,
            basis: part.basis,
            qty: part.qty,
            factorSnapshot: part.factorSnapshot,
            qtyBase: part.qtyBase,
            listPrice: part.listPrice,
            unitPrice: part.unitPrice,
            subtotal: part.subtotal,
            discountAmount: part.discountAmount,
            total: part.total,
            applied: part.applied.map((applied) => ({
              programId: applied.programId,
              name: applied.name,
              scope: applied.scope,
              effect: applied.effect,
              threshold: applied.threshold.toFixed(),
              value: applied.value.toFixed(),
              amount: applied.amount?.toFixed(0) ?? null,
            })),
          });
        });
      }
      if (parts.length > 0) await tx.insert(salesOrderLineParts).values(parts);

      const reserved = await this.reservations.reserveInTx(tx, {
        docType: 'SO',
        docId: id,
        lines: lines.map((line) => ({
          lineId: line.id,
          warehouseId: line.warehouseId,
          productId: line.productId,
          qtyBase: line.qtyBase,
        })),
      });
      for (const entry of reserved) {
        await tx
          .update(salesOrderLines)
          .set({ qtyApproved: entry.reserved, qtyBackordered: entry.backordered })
          .where(eq(salesOrderLines.id, entry.lineId));
      }
      const { rows: clock } = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
      const now = clock[0]?.now;
      const year = businessYear(now instanceof Date ? now : new Date(now ?? Date.now()));
      const number = formatDocNumber('SO', year, await this.numbering.next(tx, 'SO', year));
      await tx
        .update(salesOrders)
        .set({
          status: 'CONFIRMED',
          number,
          priceDate: today,
          subtotal: quote.subtotal,
          discountTotal: quote.discountTotal,
          total: quote.total,
          submittedAt: sql`now()`,
          submittedBy: actorUserId(actor),
          confirmedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(salesOrders.id, id));
      await this.event(tx, actor, id, 'DRAFT', 'SUBMITTED', null);
      await this.event(tx, actor, id, 'SUBMITTED', 'CONFIRMED', null);
      await this.audit.record(tx, actor, {
        action: 'CONFIRM',
        entity: 'sales_orders',
        entityId: id,
        after: {
          number,
          total: quote.total.toFixed(0),
          backordered: reserved.filter((entry) => entry.backordered.gt(0)).length,
        },
      });
    });
    return this.get(id);
  }

  /** Cancels a draft or a confirmed order with a reason; a confirmed one releases its stock. */
  async cancel(actor: Actor, id: number, reason: string): Promise<OrderDetail> {
    const why = text(reason);
    if (why === null) throw invalid('reason', 'required', 'a reason');
    if (why.length > ORDER_LIMITS.maxCancelReason) throw invalid('reason', 'maxLength', 'too long');
    await inTransaction(this.db, async (tx) => {
      const order = await this.lock(tx, id);
      if (!isCancellable(order.status)) throw stateError(order, 'CANCELLABLE');
      const released = await this.reservations.releaseInTx(tx, 'SO', id);
      await tx
        .update(salesOrders)
        .set({
          status: 'CANCELLED',
          cancelledAt: sql`now()`,
          cancelledBy: actorUserId(actor),
          cancelReason: why,
          updatedAt: sql`now()`,
        })
        .where(eq(salesOrders.id, id));
      await this.event(tx, actor, id, order.status, 'CANCELLED', why);
      await this.audit.record(tx, actor, {
        action: 'CANCEL',
        entity: 'sales_orders',
        entityId: id,
        before: { status: order.status },
        after: { status: 'CANCELLED', reason: why, released },
      });
    });
    return this.get(id);
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<OrderDetail> {
    const [order] = await executor.select().from(salesOrders).where(eq(salesOrders.id, id));
    if (!order) throw notFound('sales order', id);
    const lines = await executor
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.orderId, id))
      .orderBy(asc(salesOrderLines.lineNo));
    const parts =
      lines.length === 0
        ? []
        : await executor
            .select()
            .from(salesOrderLineParts)
            .where(
              idIn(
                salesOrderLineParts.lineId,
                lines.map((line) => line.id),
              ),
            )
            .orderBy(asc(salesOrderLineParts.lineId), asc(salesOrderLineParts.partNo));
    const products = new Map(
      (
        await this.catalog.getMany(
          lines.map((line) => line.productId),
          executor,
        )
      ).map((product) => [product.id, product]),
    );
    const units = await this.units.describe(
      lines.map((line) => line.productUnitId),
      executor,
    );
    const [customer] = await this.customers.getMany([order.customerId], executor);
    const events = await executor
      .select()
      .from(orderStatusEvents)
      .where(eq(orderStatusEvents.orderId, id))
      .orderBy(asc(orderStatusEvents.id));
    const {
      createdBy: _created,
      submittedBy: _submitted,
      cancelledBy: _cancelled,
      ...rest
    } = order;
    return {
      ...rest,
      customerCode: customer?.code ?? '',
      customerName: customer?.name ?? '',
      lines: lines.map((line) => lineView(line, products, units, parts)),
      events: events.map((event) => ({
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        reason: event.reason,
        actorId: event.actorId,
        createdAt: event.createdAt,
      })),
    };
  }

  async list(query: OrderQuery): Promise<{ data: OrderSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(salesOrders.status, query.status));
    if (query.customerId) filters.push(eq(salesOrders.customerId, query.customerId));
    const q = text(query.q);
    if (q) filters.push(ilike(salesOrders.number, `%${q.replace(/[\\%_]/g, '\\$&')}%`));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(salesOrders.id, after.id));
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        channel: salesOrders.channel,
        customerId: salesOrders.customerId,
        fulfilment: salesOrders.fulfilment,
        deliveryDate: salesOrders.deliveryDate,
        total: salesOrders.total,
        createdAt: salesOrders.createdAt,
        // Spelled out: a single-table select leaves columns unqualified.
        lineCount: sql<string>`(SELECT count(*) FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`,
      })
      .from(salesOrders)
      .where(and(...filters))
      .orderBy(desc(salesOrders.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const customers = new Map(
      (await this.customers.getMany(page.data.map((row) => row.customerId))).map((customer) => [
        customer.id,
        customer,
      ]),
    );
    return {
      data: page.data.map((row) => ({
        ...row,
        customerCode: customers.get(row.customerId)?.code ?? '',
        customerName: customers.get(row.customerId)?.name ?? '',
        lineCount: Number.parseInt(row.lineCount, 10),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** Each product's home warehouse, whether it may be sold and what is available there. */
  async productInfo(productIds: readonly number[]): Promise<ProductOrderInfo[]> {
    const ids = [...new Set(productIds)];
    const products = await this.catalog.getMany(ids);
    const homes = await this.locations.homeOf(ids);
    const available = await this.reservations.availableOf(ids);
    return products.map((product) => {
      const home = homes.get(product.id) ?? null;
      return {
        productId: product.id,
        homeWarehouseId: home,
        sellable: sellable(product),
        available:
          available.get(product.id)?.find((entry) => entry.warehouseId === home)?.available ??
          new Decimal(0),
      };
    });
  }

  // -------------------------------------------------------------------------------------------

  private async lock(tx: Tx, id: number): Promise<OrderRow> {
    const [order] = await tx.select().from(salesOrders).where(eq(salesOrders.id, id)).for('update');
    if (!order) throw notFound('sales order', id);
    return order;
  }

  /** The header as stored: checked, trimmed, the address copied from the customer's. */
  private async checkedHeader(tx: Tx, input: OrderInput) {
    const contactPhone = text(input.contactPhone);
    for (const issue of orderHeaderIssues({
      fulfilment: input.fulfilment,
      deliveryDate: input.deliveryDate,
      addressId: input.addressId,
      contactPhone,
    })) {
      throw invalid(issue.path, issue.code, `${issue.path}: ${issue.code}`);
    }
    await this.customers.assertActive(tx, input.customerId);
    let address: { id: number; text: string | null; lat: Decimal | null; lng: Decimal | null } = {
      id: 0,
      text: null,
      lat: null,
      lng: null,
    };
    if (input.addressId !== null) {
      const found = (await this.addresses.ofCustomer(input.customerId, tx)).find(
        (row) => row.id === input.addressId,
      );
      if (!found)
        throw invalid('addressId', 'customerAddress', "not one of the customer's addresses");
      address = { id: found.id, text: found.address, lat: found.lat, lng: found.lng };
    }
    const contactName = text(input.contactName);
    if (contactName !== null && contactName.length > ORDER_LIMITS.maxContactName) {
      throw invalid('contactName', 'maxLength', 'too long');
    }
    const note = text(input.note);
    if (note !== null && note.length > ORDER_LIMITS.maxNote) {
      throw invalid('note', 'maxLength', 'too long');
    }
    if (input.lines.length > ORDER_LIMITS.maxLines) {
      throw invalid('lines', 'maxLines', `at most ${ORDER_LIMITS.maxLines} lines`);
    }
    return {
      customerId: input.customerId,
      fulfilment: input.fulfilment,
      deliveryDate: input.deliveryDate,
      addressId: input.addressId,
      addressText: input.addressId === null ? null : address.text,
      addressLat: input.addressId === null ? null : address.lat,
      addressLng: input.addressId === null ? null : address.lng,
      contactName,
      contactPhone: contactPhone === null ? null : normalizeMnPhone(contactPhone),
      paymentMethod: input.paymentMethod,
      note,
    };
  }

  /** Lines in base units, each in its product's home warehouse. */
  private async writeLines(
    tx: Tx,
    orderId: number,
    lines: readonly OrderLineInput[],
  ): Promise<void> {
    if (lines.length === 0) return;
    const converted = [];
    for (const [index, line] of lines.entries()) {
      if (!line.qty.gt(0)) throw invalid(`lines.${index}.qty`, 'min', 'a positive quantity');
      converted.push(await this.units.toBase(line.productUnitId, line.qty, tx));
    }
    const homes = await this.assertOrderable(
      tx,
      converted.map((line) => line.productId),
    );
    await tx.insert(salesOrderLines).values(
      converted.map((line, index) => ({
        orderId,
        lineNo: index + 1,
        productId: line.productId,
        productUnitId: line.unitId,
        qty: lines[index]?.qty ?? line.qtyBase,
        factorSnapshot: line.factorSnapshot,
        qtyBase: line.qtyBase,
        warehouseId: homes.get(line.productId) ?? 0,
      })),
    );
  }

  /**
   * Every product active, complete and with a home warehouse (ADR-0055 #3); returns the homes.
   * The first product that fails names its line.
   */
  private async assertOrderable(
    tx: Tx,
    productIds: readonly number[],
  ): Promise<Map<number, number>> {
    const products = new Map(
      (await this.catalog.getMany(productIds, tx)).map((product) => [product.id, product]),
    );
    const homes = await this.locations.homeOf(productIds, tx);
    for (const [index, productId] of productIds.entries()) {
      const product = products.get(productId);
      if (!product) throw notFound('product', productId);
      if (!sellable(product)) {
        throw new AppError(
          'PRODUCT_NOT_SELLABLE',
          `${product.sku} cannot be sold`,
          { sku: product.sku },
          [{ path: `lines.${index}`, constraint: 'sellable', message: product.sku }],
        );
      }
      if (!homes.has(productId)) {
        throw new AppError(
          'PRODUCT_NO_HOME',
          `${product.sku} has no home warehouse`,
          { sku: product.sku },
          [{ path: `lines.${index}`, constraint: 'home', message: product.sku }],
        );
      }
    }
    return homes;
  }

  private async event(
    tx: Tx,
    actor: Actor,
    orderId: number,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    reason: string | null,
  ): Promise<void> {
    await tx.insert(orderStatusEvents).values({
      orderId,
      fromStatus,
      toStatus,
      reason,
      actorId: actorUserId(actor),
      actorLabel: actor.kind === 'SYSTEM' ? actor.label : null,
    });
  }
}

const sellable = (product: ProductSummary): boolean =>
  product.status === 'ACTIVE' && product.saleReadyAt !== null;

function stateError(order: OrderRow, expected: string): AppError {
  return new AppError('ORDER_STATE_INVALID', `the order is ${order.status}`, {
    status: order.status,
    expected,
  });
}

function lineView(
  line: LineRow,
  products: ReadonlyMap<number, ProductSummary>,
  units: ReadonlyMap<number, { uomName: string }>,
  parts: readonly (typeof salesOrderLineParts.$inferSelect)[],
): OrderLine {
  const product = products.get(line.productId);
  return {
    id: line.id,
    lineNo: line.lineNo,
    productId: line.productId,
    productSku: product?.sku ?? '',
    productName: product?.name ?? '',
    productUnitId: line.productUnitId,
    unitName: units.get(line.productUnitId)?.uomName ?? '',
    qty: line.qty,
    factorSnapshot: line.factorSnapshot,
    qtyBase: line.qtyBase,
    baseUnitName: product?.baseUnit.uomName ?? '',
    warehouseId: line.warehouseId,
    qtyApproved: line.qtyApproved,
    qtyBackordered: line.qtyBackordered,
    subtotal: line.subtotal,
    discountAmount: line.discountAmount,
    total: line.total,
    parts: parts
      .filter((part) => part.lineId === line.id)
      .map((part) => ({
        productUnitId: part.productUnitId,
        uomName: part.uomName,
        basis: part.basis,
        qty: part.qty,
        factorSnapshot: part.factorSnapshot,
        qtyBase: part.qtyBase,
        listPrice: part.listPrice,
        unitPrice: part.unitPrice,
        subtotal: part.subtotal,
        discountAmount: part.discountAmount,
        total: part.total,
        applied: part.applied,
      })),
  };
}
