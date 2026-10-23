import type { CustomerOverdue } from '../partners';
import type { SalesCustomerOverdueDto } from './dto/sales-boards.dto';

/** A customer's overdue receivable on an order, a card or a rep app row (ADR-0101), whole MNT. */
export function overdueDto(overdue: CustomerOverdue | null): SalesCustomerOverdueDto | null {
  return overdue
    ? { amount: overdue.amount.toFixed(0), oldestDueDate: overdue.oldestDueDate }
    : null;
}
