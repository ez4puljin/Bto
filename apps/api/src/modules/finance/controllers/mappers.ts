import type { Decimal } from '@tugeel/shared/money';
import type {
  AccountLedgerLineDto,
  CreditNoteDetailDto,
  CreditNoteDto,
  CustomerBalanceDto,
  GlAccountDto,
  InvoiceDetailDto,
  InvoiceDto,
  JournalEntryDetailDto,
  JournalEntryDto,
  LedgerEntryDto,
  MoneyAccountDto,
  PaymentDetailDto,
  PaymentDto,
} from '../dto/finance.dto';
import type { CustomerBalanceRow, LedgerEntry } from '../services/ar-ledger.service';
import type { CreditNoteDetail, CreditNoteSummary } from '../services/credit-notes.service';
import type { GlAccountBalance } from '../services/gl-accounts.service';
import type { InvoiceDetail, InvoiceSummary } from '../services/invoice-query.service';
import type {
  AccountLedgerLine,
  JournalEntryDetail,
  JournalEntrySummary,
} from '../services/journal.service';
import type { MoneyAccount } from '../services/money-accounts.service';
import type { PaymentDetail, PaymentSummary } from '../services/payments.service';

/** Money with its two decimals, quantities as entered, instants in ISO 8601. */
export const money = (value: Decimal): string => value.toFixed(2);
export const moneyOrNull = (value: Decimal | null): string | null =>
  value === null ? null : value.toFixed(2);
export const qty = (value: Decimal): string => value.toFixed();
export const iso = (value: Date): string => value.toISOString();
export const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

export const invoiceDto = (invoice: InvoiceSummary): InvoiceDto => ({
  ...invoice,
  subtotal: money(invoice.subtotal),
  discountTotal: money(invoice.discountTotal),
  total: money(invoice.total),
  vatTotal: money(invoice.vatTotal),
  cityTaxTotal: money(invoice.cityTaxTotal),
  openAmount: money(invoice.openAmount),
  createdAt: iso(invoice.createdAt),
});

export const invoiceDetailDto = (invoice: InvoiceDetail): InvoiceDetailDto => ({
  ...invoiceDto(invoice),
  note: invoice.note,
  journalEntryId: invoice.journalEntryId,
  journalNumber: invoice.journalNumber,
  voidedAt: isoOrNull(invoice.voidedAt),
  voidedByName: invoice.voidedByName,
  voidReason: invoice.voidReason,
  voidJournalEntryId: invoice.voidJournalEntryId,
  lines: invoice.lines.map((line) => ({
    ...line,
    qty: qty(line.qty),
    factorSnapshot: qty(line.factorSnapshot),
    qtyBase: qty(line.qtyBase),
    listPrice: money(line.listPrice),
    unitPrice: money(line.unitPrice),
    subtotal: money(line.subtotal),
    discountAmount: money(line.discountAmount),
    total: money(line.total),
    vatRatePct: line.vatRatePct.toFixed(2),
    cityTaxRatePct: line.cityTaxRatePct.toFixed(2),
    vatAmount: money(line.vatAmount),
    cityTaxAmount: money(line.cityTaxAmount),
    returnedBase: qty(line.returnedBase),
  })),
  allocations: invoice.allocations.map((allocation) => ({
    ...allocation,
    amount: money(allocation.amount),
    createdAt: iso(allocation.createdAt),
    voidedAt: isoOrNull(allocation.voidedAt),
  })),
  creditNotes: invoice.creditNotes.map((note) => ({ ...note, total: money(note.total) })),
});

export const creditNoteDto = (note: CreditNoteSummary): CreditNoteDto => ({
  ...note,
  subtotal: money(note.subtotal),
  discountTotal: money(note.discountTotal),
  total: money(note.total),
  vatTotal: money(note.vatTotal),
  cityTaxTotal: money(note.cityTaxTotal),
  allocatedAmount: money(note.allocatedAmount),
  createdAt: iso(note.createdAt),
});

export const creditNoteDetailDto = (note: CreditNoteDetail): CreditNoteDetailDto => ({
  ...creditNoteDto(note),
  lines: note.lines.map((line) => ({
    ...line,
    qty: qty(line.qty),
    factorSnapshot: qty(line.factorSnapshot),
    qtyBase: qty(line.qtyBase),
    unitPrice: money(line.unitPrice),
    subtotal: money(line.subtotal),
    discountAmount: money(line.discountAmount),
    total: money(line.total),
    vatAmount: money(line.vatAmount),
    cityTaxAmount: money(line.cityTaxAmount),
  })),
});

export const paymentDto = (payment: PaymentSummary): PaymentDto => ({
  ...payment,
  amount: money(payment.amount),
  allocatedAmount: money(payment.allocatedAmount),
  createdAt: iso(payment.createdAt),
});

export const paymentDetailDto = (payment: PaymentDetail): PaymentDetailDto => ({
  ...paymentDto(payment),
  journalEntryId: payment.journalEntryId,
  journalNumber: payment.journalNumber,
  voidedAt: isoOrNull(payment.voidedAt),
  voidedByName: payment.voidedByName,
  voidReason: payment.voidReason,
  voidJournalEntryId: payment.voidJournalEntryId,
  allocations: payment.allocations.map((allocation) => ({
    ...allocation,
    amount: money(allocation.amount),
    voidedAt: isoOrNull(allocation.voidedAt),
  })),
});

export const glAccountDto = (account: GlAccountBalance): GlAccountDto => ({
  ...account,
  debit: money(account.debit),
  credit: money(account.credit),
  balance: money(account.balance),
  createdAt: iso(account.createdAt),
  updatedAt: iso(account.updatedAt),
});

export const moneyAccountDto = (account: MoneyAccount): MoneyAccountDto => ({
  ...account,
  balance: money(account.balance),
  createdAt: iso(account.createdAt),
  updatedAt: iso(account.updatedAt),
});

export const journalEntryDto = (entry: JournalEntrySummary): JournalEntryDto => ({
  ...entry,
  amount: money(entry.amount),
  createdAt: iso(entry.createdAt),
});

export const journalEntryDetailDto = (entry: JournalEntryDetail): JournalEntryDetailDto => ({
  ...journalEntryDto(entry),
  lines: entry.lines.map((line) => ({
    ...line,
    debit: money(line.debit),
    credit: money(line.credit),
  })),
});

export const accountLedgerLineDto = (line: AccountLedgerLine): AccountLedgerLineDto => ({
  ...line,
  debit: money(line.debit),
  credit: money(line.credit),
  balanceAfter: money(line.balanceAfter),
});

export const customerBalanceDto = (row: CustomerBalanceRow): CustomerBalanceDto => ({
  customerId: row.customerId,
  code: row.code,
  name: row.name,
  status: row.status,
  creditLimit: moneyOrNull(row.creditLimit),
  creditHold: row.creditHold,
  balance: money(row.balance),
  openInvoices: row.openInvoices,
  overdueAmount: money(row.overdueAmount),
  oldestDueDate: row.oldestDueDate,
  aging: {
    NOT_DUE: money(row.aging.NOT_DUE),
    D1_30: money(row.aging.D1_30),
    D31_60: money(row.aging.D31_60),
    D61_90: money(row.aging.D61_90),
    D90_PLUS: money(row.aging.D90_PLUS),
  },
  updatedAt: isoOrNull(row.updatedAt),
});

export const ledgerEntryDto = (entry: LedgerEntry): LedgerEntryDto => ({
  ...entry,
  debit: money(entry.debit),
  credit: money(entry.credit),
  balanceAfter: money(entry.balanceAfter),
  createdAt: iso(entry.createdAt),
});
