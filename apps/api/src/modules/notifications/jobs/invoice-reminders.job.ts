import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { CustomerNotifier } from '../services/customer-notifier';

/**
 * notifications.invoiceReminders, every morning at 09:00 Ulaanbaatar time (ADR-0079 #8, Claude's
 * default of 2026-10-19): «due soon» and «overdue» for the open invoices of stores with a customer
 * app account, once per invoice. A night the worker was down is made up by the windows.
 */
@Injectable()
export class InvoiceRemindersJob implements JobHandler<'notifications.invoiceReminders'> {
  readonly name = 'notifications.invoiceReminders' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '0 9 * * *';

  constructor(private readonly notifier: CustomerNotifier) {}

  handle() {
    return this.notifier.remindInvoices();
  }
}
