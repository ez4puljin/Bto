import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/db/db.types';
import type { SaleListener, SaleNotice } from '../../sales';
import { userNotifications } from '../schema';

/**
 * Tells a rep their order was sold (ADR-0062 #4): bound to sales' `SALE_LISTENER`, it runs inside
 * the sale's transaction. One statement that cannot conflict (one row per order), never caught: a
 * failed statement aborts the PostgreSQL transaction anyway.
 */
@Injectable()
export class SaleNotifier implements SaleListener {
  async onSale(tx: Tx, notice: SaleNotice): Promise<void> {
    if (notice.channel !== 'SALES_REP' || notice.createdBy === null) return;
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
}
