/** A document number: a pattern with `{year}`, `{month}`, `{day}` and a zero-padded counter. */
export interface NumberFormat {
  pattern: string;
  digits: number;
}

/**
 * The owner's defaults (2026-10-16): a letter, the day and a counter starting again each day —
 * Н invoice, Т payment voucher, К credit note, Ж journal entry.
 */
export const NUMBER_DEFAULTS = {
  INVOICE: { pattern: 'Н-{year}{month}{day}-', digits: 4 },
  PAYMENT: { pattern: 'Т-{year}{month}{day}-', digits: 4 },
  CREDIT_NOTE: { pattern: 'К-{year}{month}{day}-', digits: 4 },
  JOURNAL: { pattern: 'Ж-{year}{month}{day}-', digits: 4 },
} as const satisfies Readonly<Record<string, NumberFormat>>;
