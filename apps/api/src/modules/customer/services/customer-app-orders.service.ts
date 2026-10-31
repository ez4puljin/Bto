import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { type Fulfilment, isCustomerDeliveryDate, type PaymentMethod } from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { InvoiceQueryService } from '../../finance';
import type { CustomerContext } from '../../identity';
import {
  AppSettingsService,
  type CustomerOrderDetail,
  type CustomerOrderFilters,
  type CustomerOrderPage,
  CustomerOrdersService,
  SalesOrdersService,
  SalesPipelinesService,
  SalesRepShopService,
} from '../../sales';
import { CustomerShopService, wordOf } from './customer-shop.service';

/** What the checkout sends (ADR-0079 #5); the store is always the token's own. */
export interface CustomerOrderInput {
  fulfilment: Fulfilment;
  deliveryDate: string;
  addressId: number | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  lines: readonly { productUnitId: number; qty: Decimal }[];
}

/** Why «Дахин захиалах» left a line out (ADR-0079 #6). */
export type ReorderSkip = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'UNIT_CHANGED';

export interface ReorderResult {
  lines: { productId: number; productUnitId: number; qty: Decimal }[];
  skipped: { productId: number; name: string | null; reason: ReorderSkip }[];
}

/**
 * The customer app's orders (ADR-0079 #5, #6): a send lands on the CUSTOMER_APP channel's stage
 * without an action — numbered, unpriced, nothing reserved — and waits for the office; the store
 * reads every order of its own, from every channel, and repeats one into its cart.
 */
@Injectable()
export class CustomerAppOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly orders: SalesOrdersService,
    private readonly pipelines: SalesPipelinesService,
    private readonly history: CustomerOrdersService,
    private readonly invoices: InvoiceQueryService,
    private readonly shop: CustomerShopService,
    private readonly repShop: SalesRepShopService,
    private readonly settings: AppSettingsService,
  ) {}

  /**
   * One transaction: the app channel's stage locked FOR SHARE and checked (409
   * CUSTOMER_APP_CLOSED otherwise), then the office's draft path on the CUSTOMER_APP channel with
   * the account as its author. The sign-in phone is the order's contact (Claude's default).
   */
  async send(ctx: CustomerContext, input: CustomerOrderInput): Promise<CustomerOrderDetail> {
    if (!isCustomerDeliveryDate(input.deliveryDate, businessDate())) {
      throw invalid('deliveryDate', 'customerDay', 'today or within 60 days');
    }
    // The apps' rules (ADR-0127 #1, #4): only the assortment's products, and the order quoted
    // today — as the office will price it — at least the minimum amount; both before the transaction.
    await this.repShop.assertUnitsListed(input.lines.map((line) => line.productUnitId));
    const minimum = (await this.settings.current()).minOrderAmount;
    if (minimum !== null && minimum.gt(0)) {
      const { quote } = await this.shop.quote(input.lines);
      if (quote.orderAmount.lt(minimum)) {
        throw new AppError(
          'ORDER_BELOW_MINIMUM',
          `the order of ${quote.orderAmount.toFixed(0)} is below the minimum ${minimum.toFixed(0)}`,
          { min: minimum.toFixed(0), total: quote.orderAmount.toFixed(0) },
        );
      }
    }
    const id = await inTransaction(this.db, async (tx) => {
      const placement = await this.pipelines.customerAppPlacement(tx);
      return this.orders.createInTx(
        tx,
        { kind: 'CUSTOMER', customerUserId: ctx.customerUserId, ...requestIdOf(ctx) },
        {
          customerId: ctx.customerId,
          pipelineId: placement.pipelineId,
          stageId: placement.stageId,
          fulfilment: input.fulfilment,
          deliveryDate: input.deliveryDate,
          addressId: input.fulfilment === 'DELIVERY' ? input.addressId : null,
          contactName: null,
          contactPhone: ctx.phone,
          paymentMethod: input.paymentMethod,
          note: input.note,
          lines: input.lines,
        },
        { channel: 'CUSTOMER_APP', placement: () => Promise.resolve(placement) },
      );
    });
    return this.history.detail(ctx.customerId, id);
  }

  page(
    ctx: CustomerContext,
    query: { from?: string; to?: string; cursor?: string; limit?: number } & CustomerOrderFilters,
  ): Promise<CustomerOrderPage> {
    return this.history.page(ctx.customerId, query);
  }

  /** The reps who took the store's orders: the order filter's «ХТ» choices. */
  reps(ctx: CustomerContext): Promise<{ id: number; name: string }[]> {
    return this.history.reps(ctx.customerId);
  }

  /** One of the store's orders with its invoice once sold. */
  async detail(
    ctx: CustomerContext,
    id: number,
  ): Promise<{ order: CustomerOrderDetail; invoice: { id: number; number: string } | null }> {
    const order = await this.history.detail(ctx.customerId, id);
    const invoice = await this.invoices.ofOrder(id);
    return {
      order,
      invoice:
        invoice && invoice.status === 'ISSUED' ? { id: invoice.id, number: invoice.number } : null,
    };
  }

  /**
   * An earlier order's lines for the cart at today's prices: products no longer listed, «Дууссан»
   * or whose unit changed are left out with the reason (ADR-0079 #6).
   */
  async reorder(ctx: CustomerContext, id: number): Promise<ReorderResult> {
    const lines = await this.history.reorderLines(ctx.customerId, id);
    const listed = new Map(
      (await this.shop.listed(lines.map((line) => line.productId))).map((product) => [
        product.id,
        product,
      ]),
    );
    const result: ReorderResult = { lines: [], skipped: [] };
    for (const line of lines) {
      const product = listed.get(line.productId);
      if (!product) {
        result.skipped.push({ productId: line.productId, name: null, reason: 'UNAVAILABLE' });
      } else if (wordOf(product) === 'OUT') {
        result.skipped.push({ productId: product.id, name: product.name, reason: 'OUT_OF_STOCK' });
      } else if (!product.units.some((unit) => unit.id === line.productUnitId)) {
        result.skipped.push({ productId: product.id, name: product.name, reason: 'UNIT_CHANGED' });
      } else {
        result.lines.push(line);
      }
    }
    return result;
  }
}

const requestIdOf = (ctx: CustomerContext) => (ctx.requestId ? { requestId: ctx.requestId } : {});
