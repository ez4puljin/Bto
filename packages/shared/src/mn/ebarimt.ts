/** The e-Barimt receipt a sale gets: a citizen's with a lottery, or a company's with its TIN. */
export const RECEIPT_TYPES = ['B2C', 'B2B'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

/**
 * A receipt's state (architecture §5.9); NONE until a receipt is issued (ADR-0065), which the
 * central modules only record.
 */
export const EBARIMT_STATUSES = [
  'NONE',
  'PENDING',
  'CONFIRMED',
  'INDETERMINATE',
  'ERROR',
  'CANCELLED',
  'UNCONFIRMED_RETURN',
] as const;
export type EbarimtStatus = (typeof EBARIMT_STATUSES)[number];

/**
 * The PosAPI payment codes the systems use (SPEC §6.11 #6); Σ payments = the receipt's total.
 * PosAPI's `BANK_TRANSFER_QPAY` is not used: the owner dropped QPay (2026-10-18, ADR-0080).
 */
export const EBARIMT_PAYMENT_CODES = ['CASH', 'PAYMENT_CARD', 'BANK_TRANSFER'] as const;
export type EbarimtPaymentCode = (typeof EBARIMT_PAYMENT_CODES)[number];
