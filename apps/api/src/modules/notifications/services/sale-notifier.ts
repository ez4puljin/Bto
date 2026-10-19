import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/db/db.types';
import type { SaleListener, SaleNotice } from '../../sales';
import { userNotifications } from '../schema';
import { CustomerNotifier } from './customer-notifier';

/**
 * Tells a rep their order was sold (ADR-0062 #4) and the store, when it has a customer app
 * account, that its order was sold (ADR-0079 #8): bound to sales' `SALE_LISTENER`, it runs inside
 * the sale's transaction. Statements that cannot conflict (one row per order and kind), never
 * caught: a failed statement aborts the PostgreSQL transaction anyway.
 */
@Injectable()
export class SaleNotifier implements SaleListener {
  constructor(private readonly customers: CustomerNotifier) {}

  async onSale(tx: Tx, notice: SaleNotice): Promise<void> {
    if (notice.channel === 'SALES_REP' && notice.createdBy !== null) {
      await tx
        .insert(userNotifications)
        .values({
          userId: notice.createdBy,
          kind: 'ORDER_SOLD',
          orderId: notice.orderId,
          payload: {
            orderNumber: notice.orderNumber,
            customerId: notice.customerId,
            orderTotal: notice.orderTotal,
            invoiceNumber: notice.invoiceNumber,
          },
        })
        .onConflictDoNothing();
    }
    await this.customers.onSold(tx, notice);
  }
}
