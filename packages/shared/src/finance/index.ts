import { Decimal, type DecimalInput, toMoney, toWholeMnt } from '../money';
import {
  formatOrderNumber,
  type OrderNumberIssue,
  orderNumberPatternIssues,
  orderNumberPrefix,
  renderOrderNumber,
} from '../sales';

/**
 * Finance (ADR-0060): the rules invoices, payments, credit notes and the journal share between the
 * api and the web. Messages live in mn.json under `finance`.
 */

/** The documents finance numbers (ADR-0060 #8); each has its own pattern and counter. */
export const FINANCE_DOC_KINDS = ['INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'JOURNAL'] as const;
export type FinanceDocKind = (typeof FINANCE_DOC_KINDS)[number];

export interface NumberFormat {
  pattern: string;
  digits: number;
}

/** The owner's defaults (2026-10-16): a letter, the day and a counter starting again each day. */
export const FINANCE_NUMBER_DEFAULTS: Readonly<Record<FinanceDocKind, NumberFormat>> = {
  INVOICE: { pattern: 'Н-{year}{month}{day}-', digits: 4 },
  PAYMENT: { pattern: 'Т-{year}{month}{day}-', digits: 4 },
  CREDIT_NOTE: { pattern: 'К-{year}{month}{day}-', digits: 4 },
  JOURNAL: { pattern: 'Ж-{year}{month}{day}-', digits: 4 },
};

/** `number_sequences.scope_key` per document; the rendered prefix is the period. */
export const FINANCE_NUMBER_SCOPES: Readonly<Record<FinanceDocKind, string>> = {
  INVOICE: 'INV_NO',
  PAYMENT: 'PAY_NO',
  CREDIT_NOTE: 'CN_NO',
  JOURNAL: 'JE_NO',
};

/** The order-number rules apply to every finance pattern (ADR-0057 #3). */
export const financeNumberIssues = (pattern: string, digits: number): OrderNumberIssue[] =>
  orderNumberPatternIssues(pattern, digits);
export { formatOrderNumber as formatFinanceNumber, orderNumberPrefix as financeNumberPrefix };
export const renderFinanceNumber = renderOrderNumber;

export const INVOICE_STATUSES = ['ISSUED', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** How far an issued invoice is paid, read from its open amount. */
export const SETTLEMENTS = ['OPEN', 'PARTIAL', 'PAID'] as const;
export type Settlement = (typeof SETTLEMENTS)[number];

export function settlementOf(total: DecimalInput, openAmount: DecimalInput): Settlement {
  const open = new Decimal(openAmount);
  if (open.lte(0)) return 'PAID';
  return open.lt(total) ? 'PARTIAL' : 'OPEN';
}

export const PAYMENT_DIRECTIONS = ['IN', 'OUT'] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/**
 * A voucher of the cash or bank book (ADR-0060 #5): money from a customer or back to one, or any
 * other income or expense against a journal account.
 */
export const PAYMENT_KINDS = [
  'CUSTOMER_PAYMENT',
  'CUSTOMER_REFUND',
  'OTHER_IN',
  'OTHER_OUT',
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_KIND_DIRECTION: Readonly<Record<PaymentKind, PaymentDirection>> = {
  CUSTOMER_PAYMENT: 'IN',
  CUSTOMER_REFUND: 'OUT',
  OTHER_IN: 'IN',
  OTHER_OUT: 'OUT',
};

export const PAYMENT_STATUSES = ['POSTED', 'VOID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const MONEY_ACCOUNT_KINDS = ['CASH', 'BANK'] as const;
export type MoneyAccountKind = (typeof MONEY_ACCOUNT_KINDS)[number];

export const GL_ACCOUNT_KINDS = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type GlAccountKind = (typeof GL_ACCOUNT_KINDS)[number];

/** Which account an automatic entry hits (ADR-0060 #7); at most one account holds a role. */
export const GL_ROLES = [
  'AR',
  'SALES',
  'SALES_DISCOUNT',
  'SALES_RETURN',
  'VAT_PAYABLE',
  'CITY_TAX_PAYABLE',
  'CUSTOMER_ADVANCE',
  'CASH',
  'BANK',
  'OTHER_INCOME',
  'OTHER_EXPENSE',
  // The supermarket POS (ADR-0064): the tills' cash until it is handed over, card money until the
  // bank settles it, the store's sales, and what a count missed or found.
  'POS_CASH',
  'CARD_CLEARING',
  'POS_SALES',
  'CASH_VARIANCE',
] as const;
export type GlRole = (typeof GL_ROLES)[number];

export const JOURNAL_SOURCES = [
  'AUTO_INVOICE',
  'AUTO_PAYMENT',
  'AUTO_CREDIT_NOTE',
  'AUTO_VOID',
  'MANUAL',
  'OPENING',
  'AUTO_POS_SHIFT',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

/** The documents a journal entry may come from: the numbered finance documents and a POS shift. */
export const JOURNAL_SOURCE_DOC_TYPES = [...FINANCE_DOC_KINDS, 'POS_SHIFT'] as const;
export type JournalSourceDocType = (typeof JOURNAL_SOURCE_DOC_TYPES)[number];

export const AR_ENTRY_KINDS = [
  'INVOICE',
  'PAYMENT',
  'CREDIT_NOTE',
  'REFUND',
  'ADJUSTMENT',
  'OPENING',
  'VOID',
] as const;
export type ArEntryKind = (typeof AR_ENTRY_KINDS)[number];

export const ALLOCATION_SOURCES = ['PAYMENT', 'CREDIT_NOTE'] as const;
export type AllocationSource = (typeof ALLOCATION_SOURCES)[number];

export const FINANCE_LIMITS = {
  maxDescription: 300,
  maxReason: 500,
  maxReference: 60,
  maxCode: 16,
  maxName: 120,
  maxJournalLines: 100,
  maxAllocations: 100,
  maxCreditNoteLines: 200,
} as const;

/** Days past due an open invoice is: not due yet, 1–30, 31–60, 61–90, over 90 (ADR-0060 #4). */
export const AGING_BUCKETS = ['NOT_DUE', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Whole days from `from` to `to`, both `YYYY-MM-DD`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const at = (iso: string) =>
    Date.UTC(
      Number.parseInt(iso.slice(0, 4), 10),
      Number.parseInt(iso.slice(5, 7), 10) - 1,
      Number.parseInt(iso.slice(8, 10), 10),
    );
  return Math.round((at(to) - at(from)) / 86_400_000);
}

export function agingBucketOf(dueDate: string, today: string): AgingBucket {
  const late = daysBetween(dueDate, today);
  if (late <= 0) return 'NOT_DUE';
  if (late <= 30) return 'D1_30';
  if (late <= 60) return 'D31_60';
  if (late <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export interface TaxSplit {
  /** Two decimals (ADR-0010). */
  vat: Decimal;
  cityTax: Decimal;
  /** What is left of the tax-inclusive amount. */
  net: Decimal;
}

/**
 * The taxes inside a tax-inclusive amount (ADR-0010 #4): `vat = round2(total × r / (100 + r + c))`
 * and the same for the city tax, both rates in percent; never recomputed from a header.
 */
export function taxSplit(
  total: DecimalInput,
  vatRatePct: DecimalInput,
  cityTaxRatePct: DecimalInput,
): TaxSplit {
  const amount = new Decimal(total);
  const vatRate = new Decimal(vatRatePct);
  const cityRate = new Decimal(cityTaxRatePct);
  const divisor = new Decimal(100).plus(vatRate).plus(cityRate);
  const vat = vatRate.isZero() ? new Decimal(0) : toMoney(amount.times(vatRate).div(divisor));
  const cityTax = cityRate.isZero() ? new Decimal(0) : toMoney(amount.times(cityRate).div(divisor));
  return { vat, cityTax, net: amount.minus(vat).minus(cityTax) };
}

/** A part of an order line as it was frozen at the submit (ADR-0048 #4). */
export interface FrozenPart {
  productUnitId: number;
  uomName: string;
  basis: string;
  /** In the unit. */
  qty: DecimalInput;
  factorSnapshot: DecimalInput;
  qtyBase: DecimalInput;
  listPrice: DecimalInput;
  unitPrice: DecimalInput;
  discountAmount: DecimalInput;
}

/** A line of an invoice: a part of the delivered quantity at the frozen prices. */
export interface InvoicePart {
  productUnitId: number;
  uomName: string;
  basis: string;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  listPrice: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
}

/**
 * The invoice lines of a delivered quantity (ADR-0060 #3): the frozen parts are filled in order,
 * packs first; a remainder no loose part covers is priced per base unit from the smallest pack
 * (its unit price over its factor, whole MNT); every part's discount follows its quantity.
 */
export function invoicePartsFor(
  deliveredBase: DecimalInput,
  parts: readonly FrozenPart[],
  base: { productUnitId: number; uomName: string },
): InvoicePart[] {
  const sorted = [...parts]
    .map((part, index) => ({ part, index, factor: new Decimal(part.factorSnapshot) }))
    .filter((entry) => entry.factor.gt(0))
    .sort((a, b) => b.factor.comparedTo(a.factor) || a.index - b.index);
  let remaining = new Decimal(deliveredBase);
  const result: InvoicePart[] = [];
  for (const { part, factor } of sorted) {
    if (remaining.lte(0)) break;
    const capacity = new Decimal(part.qty);
    const fits = factor.eq(1) ? remaining : remaining.div(factor).floor();
    const units = Decimal.min(fits, capacity);
    if (units.lte(0)) continue;
    const unitPrice = new Decimal(part.unitPrice);
    const subtotal = toWholeMnt(unitPrice.times(units));
    const frozenDiscount = new Decimal(part.discountAmount);
    const discountAmount = units.eq(capacity)
      ? frozenDiscount
      : toWholeMnt(frozenDiscount.times(units).div(capacity));
    result.push({
      productUnitId: part.productUnitId,
      uomName: part.uomName,
      basis: part.basis,
      qty: units,
      factorSnapshot: factor,
      qtyBase: units.times(factor),
      listPrice: new Decimal(part.listPrice),
      unitPrice,
      subtotal,
      discountAmount,
      total: subtotal.minus(discountAmount),
    });
    remaining = remaining.minus(units.times(factor));
  }
  const reference = sorted.at(-1);
  if (remaining.gt(0) && reference) {
    const { part, factor } = reference;
    const unitPrice = toWholeMnt(new Decimal(part.unitPrice).div(factor));
    const subtotal = toWholeMnt(unitPrice.times(remaining));
    const qtyBase = new Decimal(part.qtyBase);
    const discountAmount = qtyBase.gt(0)
      ? toWholeMnt(new Decimal(part.discountAmount).times(remaining).div(qtyBase))
      : new Decimal(0);
    result.push({
      productUnitId: base.productUnitId,
      uomName: base.uomName,
      basis: part.basis,
      qty: remaining,
      factorSnapshot: new Decimal(1),
      qtyBase: remaining,
      listPrice: toWholeMnt(new Decimal(part.listPrice).div(factor)),
      unitPrice,
      subtotal,
      discountAmount,
      total: subtotal.minus(discountAmount),
    });
  }
  return result;
}

export interface OpenInvoice {
  id: number;
  dueDate: string;
  openAmount: DecimalInput;
}

export interface Allocation {
  invoiceId: number;
  amount: Decimal;
}

/** Oldest due first (ADR-0060 #5); what is left over is not allocated. */
export function allocateFifo(amount: DecimalInput, invoices: readonly OpenInvoice[]): Allocation[] {
  let remaining = new Decimal(amount);
  const result: Allocation[] = [];
  const sorted = [...invoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
  for (const invoice of sorted) {
    if (remaining.lte(0)) break;
    const open = new Decimal(invoice.openAmount);
    if (open.lte(0)) continue;
    const taken = Decimal.min(open, remaining);
    result.push({ invoiceId: invoice.id, amount: taken });
    remaining = remaining.minus(taken);
  }
  return result;
}

/** The default chart of accounts the migration seeds (ADR-0060 #7), in Erkhet's numbering style. */
export const DEFAULT_GL_ACCOUNTS: readonly {
  code: string;
  kind: GlAccountKind;
  role: GlRole | null;
}[] = [
  { code: '100101', kind: 'ASSET', role: 'CASH' },
  { code: '110101', kind: 'ASSET', role: 'BANK' },
  { code: '120101', kind: 'ASSET', role: 'AR' },
  { code: '311004', kind: 'LIABILITY', role: 'VAT_PAYABLE' },
  { code: '311005', kind: 'LIABILITY', role: 'CITY_TAX_PAYABLE' },
  { code: '320201', kind: 'LIABILITY', role: 'CUSTOMER_ADVANCE' },
  { code: '510101', kind: 'INCOME', role: 'SALES' },
  { code: '511020', kind: 'INCOME', role: 'OTHER_INCOME' },
  { code: '520101', kind: 'INCOME', role: 'SALES_RETURN' },
  { code: '520201', kind: 'INCOME', role: 'SALES_DISCOUNT' },
  { code: '730101', kind: 'EXPENSE', role: 'OTHER_EXPENSE' },
  // The supermarket POS (ADR-0064 #2).
  { code: '100102', kind: 'ASSET', role: 'POS_CASH' },
  { code: '120301', kind: 'ASSET', role: 'CARD_CLEARING' },
  { code: '510102', kind: 'INCOME', role: 'POS_SALES' },
  { code: '740101', kind: 'EXPENSE', role: 'CASH_VARIANCE' },
];
