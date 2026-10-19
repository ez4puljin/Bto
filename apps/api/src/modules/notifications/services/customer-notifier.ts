import { Inject, Injectable } from '@nestjs/common';
import {
  type CustomerNotificationKind,
  INVOICE_REMINDER_WINDOW,
} from '@tugeel/shared/notifications';
import { addDays, businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import type { PaymentListener, PaymentRecordedNotice } from '../../finance';
import { InvoiceQueryService } from '../../finance';
import { CustomerAccountsService } from '../../identity';
import type {
  OrderCancelledNotice,
  OrderConfirmedNotice,
  OrderListener,
  SaleNotice,
} from '../../sales';
import { customerNotifications } from '../schema';

type NewNotification = typeof customerNotifications.$inferInsert;

/**
 * Writes a store's notifications for the customer app (ADR-0079 #8): bound to sales'
 * `ORDER_LISTENER` and finance's `PAYMENT_LISTENER`, called by the sale notifier, and run by the
 * nightly reminders. Every write is one `INSERT … ON CONFLICT DO NOTHING` inside the caller's
 * transaction (one row per kind and document), never caught; a store without an app account gets
 * none.
 */
@Injectable()
export class CustomerNotifier implements OrderListener, PaymentListener {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly accounts: CustomerAccountsService,
    private readonly invoices: InvoiceQueryService,
  ) {}

  async onConfirmed(tx: Tx, notice: OrderConfirmedNotice): Promise<void> {
    await this.write(tx, notice.customerId, {
      kind: 'ORDER_CONFIRMED',
      orderId: notice.orderId,
      payload: {
        orderNumber: notice.orderNumber,
        orderTotal: notice.orderTotal,
        backorderedLines: notice.backorderedLines,
        backordered: notice.backordered.map((line) => ({ ...line })),
      },
    });
  }

  async onCancelled(tx: Tx, notice: OrderCancelledNotice): Promise<void> {
    await this.write(tx, notice.customerId, {
      kind: 'ORDER_CANCELLED',
      orderId: notice.orderId,
      payload: { orderNumber: notice.orderNumber, reason: notice.reason },
    });
  }

  /** The sale of any of the store's orders: the invoice number and amount (ADR-0079 #8). */
  async onSold(tx: Tx, notice: SaleNotice): Promise<void> {
    await this.write(tx, notice.customerId, {
      kind: 'ORDER_SOLD',
      orderId: notice.orderId,
      invoiceId: notice.invoiceId,
      payload: {
        orderNumber: notice.orderNumber,
        orderTotal: notice.orderTotal,
        invoiceNumber: notice.invoiceNumber,
        invoiceTotal: notice.invoiceTotal,
      },
    });
  }

  async onPaymentRecorded(tx: Tx, notice: PaymentRecordedNotice): Promise<void> {
    await this.write(tx, notice.customerId, {
      kind: 'PAYMENT_RECORDED',
      paymentId: notice.paymentId,
      payload: {
        paymentNumber: notice.paymentNumber,
        amount: notice.amount,
        paidOn: notice.paidOn,
        method: notice.method,
        invoices: notice.invoices.map((invoice) => ({ ...invoice })),
      },
    });
  }

  /**
   * The nightly reminders (ADR-0079 #8; the job `notifications.invoiceReminders`): an open invoice
   * due within INVOICE_REMINDER_WINDOW.dueSoonDays is «due soon», one whose due date passed up to
   * `overdueDays` ago is «overdue»; each once per invoice, so a missed night is made up.
   */
  async remindInvoices(
    today: string = businessDate(),
  ): Promise<{ dueSoon: number; overdue: number }> {
    const dueSoon = await this.invoices.openDueBetween(
      today,
      addDays(today, INVOICE_REMINDER_WINDOW.dueSoonDays),
    );
    const overdue = await this.invoices.openDueBetween(
      addDays(today, -INVOICE_REMINDER_WINDOW.overdueDays),
      addDays(today, -1),
    );
    const accounts = await this.accounts.accountIdsOf([
      ...new Set([...dueSoon, ...overdue].map((invoice) => invoice.customerId)),
    ]);
    const rows = (kind: CustomerNotificationKind, list: typeof dueSoon): NewNotification[] =>
      list.flatMap((invoice) => {
        const customerUserId = accounts.get(invoice.customerId);
        return customerUserId === undefined
          ? []
          : [
              {
                customerUserId,
                kind,
                invoiceId: invoice.id,
                payload: {
                  invoiceNumber: invoice.number,
                  dueDate: invoice.dueDate,
                  openAmount: invoice.openAmount.toFixed(2),
                },
              },
            ];
      });
    return {
      dueSoon: await this.insert(this.db, rows('INVOICE_DUE_SOON', dueSoon)),
      overdue: await this.insert(this.db, rows('INVOICE_OVERDUE', overdue)),
    };
  }

  private async write(
    tx: Tx,
    customerId: number,
    row: Omit<NewNotification, 'customerUserId'>,
  ): Promise<void> {
    const customerUserId = await this.accounts.accountIdOf(customerId, tx);
    if (customerUserId === null) return;
    await this.insert(tx, [{ ...row, customerUserId }]);
  }

  private async insert(executor: Db | Tx, rows: NewNotification[]): Promise<number> {
    if (rows.length === 0) return 0;
    const written = await executor
      .insert(customerNotifications)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: customerNotifications.id });
    return written.length;
  }
}
