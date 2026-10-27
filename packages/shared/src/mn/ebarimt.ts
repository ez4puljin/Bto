import { Decimal, type DecimalInput, isDecimal, toMoney } from '../money';

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

/**
 * PosAPI 3.0's tax types, one sub-receipt each; the catalog's `vat_type` values are the same
 * words. VAT_FREE and VAT_ZERO items name their `taxProductCode`.
 */
export const EBARIMT_TAX_TYPES = ['VAT_ABLE', 'VAT_FREE', 'VAT_ZERO', 'NO_VAT'] as const;
export type EbarimtTaxType = (typeof EBARIMT_TAX_TYPES)[number];

export const POSAPI_RECEIPT_TYPES = { B2C: 'B2C_RECEIPT', B2B: 'B2B_RECEIPT' } as const;
export type PosapiReceiptType = (typeof POSAPI_RECEIPT_TYPES)[ReceiptType];

/** What PosAPI answers to `POST /rest/receipt`: `SUCCESS` with the ДДТД, or `ERROR` / `PAYMENT`. */
export const POSAPI_RESULT_STATUSES = ['SUCCESS', 'ERROR', 'PAYMENT'] as const;
export type PosapiResultStatus = (typeof POSAPI_RESULT_STATUSES)[number];

/** A ДДТД: PosAPI's receipt id (33 digits in 3.0), kept as text; a typed one is checked by shape. */
export const DDTD_PATTERN = /^[0-9]{20,40}$/;
/** PosAPI's `date`, kept verbatim (`yyyy-MM-dd HH:mm:ss`, Ulaanbaatar time; architecture M12). */
export const POSAPI_DATE_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** A district (сум, дүүрэг) code and a product classification code as PosAPI takes them. */
export const DISTRICT_CODE_PATTERN = /^[0-9]{4}$/;
export const CLASSIFICATION_CODE_PATTERN = /^[0-9]{7}$/;
export const TAX_PRODUCT_CODE_PATTERN = /^[0-9]{3}$/;

/** One sold line as the receipt shows it: tax-inclusive money after the line's discount. */
export interface EbarimtLineInput {
  name: string;
  barCode: string | null;
  barCodeType: 'GS1' | 'ISBN' | 'UNDEFINED';
  classificationCode: string;
  taxType: EbarimtTaxType;
  taxProductCode: string | null;
  measureUnit: string;
  qty: DecimalInput;
  /** What the line comes to, VAT and city tax included, after its discount. */
  total: DecimalInput;
  vat: DecimalInput;
  cityTax: DecimalInput;
}

export interface EbarimtReceiptInput {
  type: ReceiptType;
  merchantTin: string;
  districtCode: string;
  /** The merchant's branch number at PosAPI (digits, e.g. "01"); PosAPI refuses a receipt without it. */
  branchNo: string | null;
  /** The PosAPI's own number (`posNo` of `/rest/info`). */
  posNo: string | null;
  /** B2B: the buyer's TIN; B2C: null. */
  customerTin: string | null;
  /** B2C: a citizen's 8-digit e-Barimt number when known. */
  consumerNo: string | null;
  /** The ДДТД this receipt replaces (a correction or a partial return). */
  inactiveId: string | null;
  lines: readonly EbarimtLineInput[];
  payments: readonly { code: EbarimtPaymentCode; amount: DecimalInput }[];
}

export interface PosapiItem {
  name: string;
  /** Empty when the unit has no barcode (PosAPI refuses null). */
  barCode: string;
  barCodeType: 'GS1' | 'ISBN' | 'UNDEFINED';
  classificationCode: string;
  taxProductCode: string | null;
  measureUnit: string;
  qty: Decimal;
  unitPrice: Decimal;
  totalVAT: Decimal;
  totalCityTax: Decimal;
  totalAmount: Decimal;
}

export interface PosapiSubReceipt {
  totalAmount: Decimal;
  taxType: EbarimtTaxType;
  merchantTin: string;
  customerTin: string | null;
  totalVAT: Decimal;
  totalCityTax: Decimal;
  items: PosapiItem[];
}

/** The body of `POST /rest/receipt` (PosAPI 3.0); money as `Decimal`, written by `posapiJson`. */
export interface PosapiReceiptRequest {
  totalAmount: Decimal;
  totalVAT: Decimal;
  totalCityTax: Decimal;
  districtCode: string;
  merchantTin: string;
  branchNo?: string;
  posNo?: string;
  customerTin: string | null;
  consumerNo: string | null;
  type: PosapiReceiptType;
  inactiveId: string | null;
  reportMonth: null;
  invoiceId: null;
  receipts: PosapiSubReceipt[];
  payments: { code: EbarimtPaymentCode; status: 'PAID'; paidAmount: Decimal }[];
}

export const EBARIMT_BUILD_ERRORS = [
  'NO_LINES',
  'TAX_PRODUCT_CODE_MISSING',
  'CLASSIFICATION_CODE_INVALID',
  'DISTRICT_CODE_INVALID',
  'CUSTOMER_TIN_INVALID',
  'PAYMENTS_MISMATCH',
] as const;
export type EbarimtBuildErrorCode = (typeof EBARIMT_BUILD_ERRORS)[number];

/** Why a receipt cannot be built; the caller records it and never sends the receipt. */
export class EbarimtBuildError extends Error {
  readonly code: EbarimtBuildErrorCode;

  constructor(code: EbarimtBuildErrorCode, message: string) {
    super(message);
    this.name = 'EbarimtBuildError';
    this.code = code;
  }
}

const B2B_TIN = /^[0-9]{11,14}$/;

/**
 * The PosAPI 3.0 receipt of a sale (architecture §5.9, ADR-0065): one sub-receipt per tax type in
 * the order of `EBARIMT_TAX_TYPES`, items tax-inclusive, the header the sum of the sub-receipts and
 * the payments the same sum. No `billIdSuffix`: PosAPI numbers the receipt itself.
 */
export function buildPosapiReceipt(input: EbarimtReceiptInput): PosapiReceiptRequest {
  if (input.lines.length === 0) throw new EbarimtBuildError('NO_LINES', 'a receipt needs lines');
  if (!DISTRICT_CODE_PATTERN.test(input.districtCode)) {
    throw new EbarimtBuildError('DISTRICT_CODE_INVALID', 'the district code is 4 digits');
  }
  const customerTin = input.type === 'B2B' ? input.customerTin : null;
  if (input.type === 'B2B' && !B2B_TIN.test(customerTin ?? '')) {
    throw new EbarimtBuildError('CUSTOMER_TIN_INVALID', 'a B2B receipt needs the buyer’s TIN');
  }
  const receipts: PosapiSubReceipt[] = [];
  for (const taxType of EBARIMT_TAX_TYPES) {
    const lines = input.lines.filter((line) => line.taxType === taxType);
    if (lines.length === 0) continue;
    const items = lines.map((line): PosapiItem => {
      if (!CLASSIFICATION_CODE_PATTERN.test(line.classificationCode)) {
        throw new EbarimtBuildError(
          'CLASSIFICATION_CODE_INVALID',
          `«${line.name}» has no 7-digit classification code`,
        );
      }
      const exempt = taxType === 'VAT_FREE' || taxType === 'VAT_ZERO';
      if (exempt && !TAX_PRODUCT_CODE_PATTERN.test(line.taxProductCode ?? '')) {
        throw new EbarimtBuildError(
          'TAX_PRODUCT_CODE_MISSING',
          `«${line.name}» is ${taxType} without a tax product code`,
        );
      }
      const qty = new Decimal(line.qty);
      const total = toMoney(line.total);
      return {
        name: line.name,
        barCode: line.barCode ?? '',
        barCodeType: line.barCode ? line.barCodeType : 'UNDEFINED',
        classificationCode: line.classificationCode,
        taxProductCode: exempt ? line.taxProductCode : null,
        measureUnit: line.measureUnit || 'ш',
        qty,
        unitPrice: toMoney(total.div(qty)),
        totalVAT: toMoney(line.vat),
        totalCityTax: toMoney(line.cityTax),
        totalAmount: total,
      };
    });
    receipts.push({
      totalAmount: sum(items.map((item) => item.totalAmount)),
      taxType,
      merchantTin: input.merchantTin,
      customerTin,
      totalVAT: sum(items.map((item) => item.totalVAT)),
      totalCityTax: sum(items.map((item) => item.totalCityTax)),
      items,
    });
  }
  const totalAmount = sum(receipts.map((receipt) => receipt.totalAmount));
  const payments = input.payments
    .map((payment) => ({
      code: payment.code,
      status: 'PAID' as const,
      paidAmount: toMoney(payment.amount),
    }))
    .filter((payment) => payment.paidAmount.gt(0));
  if (!sum(payments.map((payment) => payment.paidAmount)).eq(totalAmount)) {
    throw new EbarimtBuildError('PAYMENTS_MISMATCH', 'the payments must make the receipt’s total');
  }
  return {
    totalAmount,
    totalVAT: sum(receipts.map((receipt) => receipt.totalVAT)),
    totalCityTax: sum(receipts.map((receipt) => receipt.totalCityTax)),
    districtCode: input.districtCode,
    merchantTin: input.merchantTin,
    ...(input.branchNo ? { branchNo: input.branchNo } : {}),
    ...(input.posNo ? { posNo: input.posNo } : {}),
    customerTin,
    consumerNo: input.type === 'B2C' ? input.consumerNo : null,
    type: POSAPI_RECEIPT_TYPES[input.type],
    inactiveId: input.inactiveId,
    reportMonth: null,
    invoiceId: null,
    receipts,
    payments,
  };
}

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

const DECIMAL_MARK = '\u0000dec:';
const DECIMAL_LITERAL = /"\\u0000dec:(-?[0-9]+(?:\.[0-9]+)?)"/g;

/**
 * JSON for PosAPI: every `Decimal` as a plain number literal with its own digits, so money never
 * passes through a float on the way out. (`toJSON` runs before a replacer, so the holder is read.)
 */
export function posapiJson(value: unknown): string {
  return JSON.stringify(
    value,
    function (this: Record<string, unknown>, key: string, item: unknown) {
      const raw = this[key];
      return isDecimal(raw) ? `${DECIMAL_MARK}${raw.toFixed()}` : item;
    },
  ).replace(DECIMAL_LITERAL, '$1');
}
