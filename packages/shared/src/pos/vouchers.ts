import { Decimal, type DecimalInput } from '../money';

/*
 * The till's discount coupons and partner vouchers (ADR-0110): batches the admin creates and
 * prints, each code used once at the supermarket's till.
 */

/**
 * COUPON: a percentage or tugriks off the basket after the discount programs. PARTNER: a voucher a
 * partner organisation gives its people; it pays at the till for up to its face value and the
 * partner is billed the full face value (owner 2026-10-27).
 */
export const VOUCHER_KINDS = ['COUPON', 'PARTNER'] as const;
export type VoucherKind = (typeof VOUCHER_KINDS)[number];

/** A coupon's effect; a partner voucher is always AMOUNT, its face value. */
export const VOUCHER_EFFECTS = ['PERCENT', 'AMOUNT'] as const;
export type VoucherEffect = (typeof VOUCHER_EFFECTS)[number];

export const VOUCHER_BATCH_STATUSES = ['ACTIVE', 'STOPPED'] as const;
export type VoucherBatchStatus = (typeof VOUCHER_BATCH_STATUSES)[number];

export const VOUCHER_STATUSES = ['ISSUED', 'REDEEMED'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/**
 * Why a till cannot take a code: not one of ours, used already, its batch not yet or no longer
 * valid, or stopped by the admin.
 */
export const VOUCHER_REFUSALS = ['UNKNOWN', 'USED', 'NOT_YET', 'EXPIRED', 'STOPPED'] as const;
export type VoucherRefusal = (typeof VOUCHER_REFUSALS)[number];

/**
 * What the centre found wrong with a code a till already took (ADR-0110 #5): it keeps the sale and
 * lists the use for «Шалгасан».
 */
export const VOUCHER_ISSUES = ['UNKNOWN', 'USED', 'NOT_YET', 'EXPIRED', 'STOPPED'] as const;
export type VoucherIssue = (typeof VOUCHER_ISSUES)[number];

export const VOUCHER_LIMITS = {
  maxBatchQty: 1000,
  maxPerSale: 20,
  maxName: 120,
  /** A partner voucher's face value or a coupon's tugriks, whole MNT. */
  maxAmount: 10_000_000,
} as const;

/** The digit after `99` that tells a coupon from a partner voucher. */
const KIND_DIGIT: Record<VoucherKind, string> = { COUPON: '1', PARTNER: '2' };
const RANDOM_DIGITS = 12;

/**
 * A code: `99`, the kind's digit, 12 random digits and a Luhn check digit — 16 digits, so no GTIN
 * (8, 12, 13 or 14 digits) and no scale label can be one, and a scanner types it the same on a
 * Latin or a Cyrillic keyboard.
 */
export const VOUCHER_CODE_PATTERN = /^99[12][0-9]{13}$/;

export function luhnDigit(digits: string): string {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = digits.charCodeAt(digits.length - 1 - index) - 48;
    if (index % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return String((10 - (sum % 10)) % 10);
}

/** A code of `kind` from 12 random digits (the api draws them with `crypto.randomInt`). */
export function voucherCodeOf(kind: VoucherKind, randomDigits: string): string {
  if (!new RegExp(`^[0-9]{${RANDOM_DIGITS}}$`).test(randomDigits)) {
    throw new Error(`a voucher code takes ${RANDOM_DIGITS} random digits`);
  }
  const body = `99${KIND_DIGIT[kind]}${randomDigits}`;
  return body + luhnDigit(body);
}

export const VOUCHER_RANDOM_DIGITS = RANDOM_DIGITS;

/**
 * A scanned or typed code (spaces and dashes ignored) and its kind, or null when it is not a
 * voucher code or its check digit is wrong.
 */
export function parseVoucherCode(text: string): { code: string; kind: VoucherKind } | null {
  const code = text.replace(/[\s-]/g, '');
  if (!VOUCHER_CODE_PATTERN.test(code)) return null;
  if (luhnDigit(code.slice(0, -1)) !== code.slice(-1)) return null;
  return { code, kind: code[2] === '1' ? 'COUPON' : 'PARTNER' };
}

/** `9912345678901234` → `9912 3456 7890 1234`, as the card prints it. */
export function formatVoucherCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

/** Whether a batch's dates hold on an Ulaanbaatar day (`YYYY-MM-DD` strings compare as dates). */
export function voucherDateRefusal(
  day: string,
  validFrom: string,
  validTo: string,
): 'NOT_YET' | 'EXPIRED' | null {
  if (day < validFrom) return 'NOT_YET';
  if (day > validTo) return 'EXPIRED';
  return null;
}

/**
 * What each partner voucher pays, in the order scanned: its face value, or what is left of the
 * total when that is less (the rest of a voucher is never given back, ADR-0110 #3).
 */
export function voucherPayments(
  total: DecimalInput,
  faces: readonly DecimalInput[],
): { amounts: Decimal[]; paid: Decimal; due: Decimal } {
  let left = Decimal.max(new Decimal(total), 0);
  const amounts = faces.map((face) => {
    const amount = Decimal.min(new Decimal(face), left);
    left = left.minus(amount);
    return amount;
  });
  const paid = amounts.reduce((sum, amount) => sum.plus(amount), new Decimal(0));
  return { amounts, paid, due: left };
}

/**
 * What a return of a sale paid partly by vouchers may give back (owner 2026-10-27, ADR-0110 #4):
 * only what was paid in cash or by card, less what earlier returns gave back.
 */
export function voucherSaleRefundable(input: {
  cashAndCardPaid: DecimalInput;
  refunded: DecimalInput;
}): Decimal {
  return Decimal.max(new Decimal(input.cashAndCardPaid).minus(input.refunded), 0);
}
