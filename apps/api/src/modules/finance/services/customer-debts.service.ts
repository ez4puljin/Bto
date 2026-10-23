import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { CustomerDebtReader, CustomerOverdue } from '../../partners';
import { invoices } from '../schema';

/**
 * partners' CUSTOMER_DEBT_READER (ADR-0101 #7): the overdue receivables the staff screens and the
 * apps show in red, read in one statement for a page of customers from the invoices' open amounts
 * (the mirror of their Finance Core items, as `ArLedgerService.overdueOf` reads one customer).
 */
@Injectable()
export class CustomerDebtsService implements CustomerDebtReader {
  constructor(@Inject(DB) private readonly db: Db) {}

  async overdueOf(customerIds: readonly number[]): Promise<Map<number, CustomerOverdue>> {
    if (customerIds.length === 0) return new Map();
    const today = businessDate();
    const rows = await this.db
      .select({
        customerId: invoices.customerId,
        amount: sql<string>`sum(${invoices.openAmount})`,
        oldest: sql<string>`min(${invoices.dueDate})::text`,
      })
      .from(invoices)
      .where(
        and(
          inArray(invoices.customerId, [...customerIds]),
          eq(invoices.status, 'ISSUED'),
          gt(invoices.openAmount, new Decimal(0)),
          lt(invoices.dueDate, today),
        ),
      )
      .groupBy(invoices.customerId);
    return new Map(
      rows.map((row) => [
        row.customerId,
        { amount: new Decimal(row.amount), oldestDueDate: row.oldest },
      ]),
    );
  }
}
