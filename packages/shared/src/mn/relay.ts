import type { Decimal } from '../money';
import {
  buildPosapiReceipt,
  type EbarimtPaymentCode,
  type EbarimtTaxType,
  type PosapiReceiptRequest,
  type ReceiptType,
} from './ebarimt';

/**
 * The wholesale e-Barimt relay (ADR-0185): the centre keeps a receipt request per source document
 * and the store edge, which alone can reach the store PosAPI, pulls one operation at a time,
 * issues it and reports the outcome. These are the shapes the two exchange and the states the
 * centre keeps. The lottery and the QR data travel only in a result call and are never stored.
 */

/** A wholesale receipt's state at the centre (architecture §5.9). */
export const WHOLESALE_RECEIPT_STATUSES = [
  'PENDING',
  'SENDING',
  'CONFIRMED',
  'ERROR',
  'INDETERMINATE',
  'CANCELLED',
] as const;
export type WholesaleReceiptStatus = (typeof WHOLESALE_RECEIPT_STATUSES)[number];

/** The cancellation of a receipt whose invoice was voided; null on the row = none asked. */
export const WHOLESALE_CANCEL_STATUSES = [
  'PENDING',
  'SENDING',
  'DONE',
  'ERROR',
  'INDETERMINATE',
] as const;
export type WholesaleCancelStatus = (typeof WHOLESALE_CANCEL_STATUSES)[number];

/**
 * Why a receipt is ERROR without PosAPI having been asked: the buyer's data (`TIN_PENDING`) or a
 * line the receipt cannot be built from; `POSAPI_REFUSED` is PosAPI's own answer and `EDGE_BUILD`
 * a fact only the store knows (its district or default classification code).
 */
export const WHOLESALE_ERROR_CODES = [
  'TIN_PENDING',
  'NO_LINES',
  'TAX_PRODUCT_CODE_MISSING',
  'CLASSIFICATION_CODE_INVALID',
  'CUSTOMER_TIN_INVALID',
  'PAYMENTS_MISMATCH',
  'POSAPI_REFUSED',
  'EDGE_BUILD',
] as const;
export type WholesaleErrorCode = (typeof WHOLESALE_ERROR_CODES)[number];

/** A claimed operation with no result for this long may or may not have reached PosAPI. */
export const RELAY_STALE_MS = 10 * 60_000;

/** A receipt line as the centre stores it and the edge builds from; money as decimal strings. */
export interface RelayReceiptLine {
  name: string;
  barCode: string | null;
  barCodeType: 'GS1' | 'ISBN' | 'UNDEFINED';
  /** Null: the store's default classification code is used, as for a till's receipt. */
  classificationCode: string | null;
  taxType: EbarimtTaxType;
  taxProductCode: string | null;
  measureUnit: string;
  qty: string;
  /** VAT and city tax included, after the line's discount. */
  total: string;
  vat: string;
  cityTax: string;
}

export interface RelayPayment {
  code: EbarimtPaymentCode;
  amount: string;
}

/** What the centre hands the edge to issue: the business request, no merchant facts. */
export interface RelayIssueOperation {
  op: 'ISSUE';
  receiptId: number;
  attempt: number;
  docNumber: string;
  type: ReceiptType;
  customerTin: string | null;
  consumerNo: string | null;
  lines: RelayReceiptLine[];
  payments: RelayPayment[];
  total: string;
}

/** A voided invoice's receipt to cancel: `DELETE /rest/receipt` with the verbatim date. */
export interface RelayCancelOperation {
  op: 'CANCEL';
  receiptId: number;
  attempt: number;
  docNumber: string;
  ddtd: string;
  posapiDate: string;
}

export type RelayOperation = RelayIssueOperation | RelayCancelOperation;

export interface RelayClaimResponse {
  operation: RelayOperation | null;
}

/**
 * How an operation ended at the store: ISSUED / CANCELLED; REFUSED by PosAPI (or not buildable at
 * the store); NOT_SENT — PosAPI was never reached, safe to try again; INDETERMINATE — the call may
 * have reached PosAPI and went unanswered, never sent again until a person has looked.
 */
export const RELAY_OUTCOMES = [
  'ISSUED',
  'CANCELLED',
  'REFUSED',
  'NOT_SENT',
  'INDETERMINATE',
] as const;
export type RelayOutcome = (typeof RELAY_OUTCOMES)[number];

/** The edge's report of one operation, repeated until the centre acknowledges it. */
export interface RelayResultWire {
  receiptId: number;
  attempt: number;
  op: 'ISSUE' | 'CANCEL';
  outcome: RelayOutcome;
  ddtd: string | null;
  /** PosAPI's `date`, verbatim. */
  posapiDate: string | null;
  merchantTin: string | null;
  merchantName: string | null;
  /** A REFUSED outcome: PosAPI's own refusal, or a request the store could not build. */
  errorCode: 'POSAPI_REFUSED' | 'EDGE_BUILD' | null;
  message: string | null;
  /** Only while the edge still holds them; the centre keeps them in memory for one print. */
  lottery: string | null;
  qrData: string | null;
}

export interface RelayResultResponse {
  acknowledged: true;
  /** False when the centre already knew, or the report was of an older attempt. */
  applied: boolean;
}

/** A buyer as the receipt rules see them. */
export interface WholesaleBuyer {
  kind: 'COMPANY' | 'INDIVIDUAL';
  tin: string | null;
  consumerNo: string | null;
}

/**
 * The receipt a buyer gets (architecture §5.9, SPEC §6.10): a company a B2B receipt with its TIN,
 * and none yet while the TIN is missing (`tinPending`); an individual with a TIN a B2B receipt,
 * else a B2C receipt with the consumer number when it is known.
 */
export function wholesaleReceiptType(buyer: WholesaleBuyer): {
  type: ReceiptType;
  customerTin: string | null;
  consumerNo: string | null;
  tinPending: boolean;
} {
  const tin = buyer.tin?.trim() || null;
  if (buyer.kind === 'COMPANY') {
    return { type: 'B2B', customerTin: tin, consumerNo: null, tinPending: tin === null };
  }
  if (tin) return { type: 'B2B', customerTin: tin, consumerNo: null, tinPending: false };
  const consumerNo = /^[0-9]{8}$/.test(buyer.consumerNo ?? '') ? buyer.consumerNo : null;
  return { type: 'B2C', customerTin: null, consumerNo, tinPending: false };
}

/** The PosAPI payment code of a wholesale order's payment method; a credit sale has none yet. */
export function wholesalePaymentCode(
  method: 'CASH' | 'BANK_TRANSFER' | 'CREDIT',
): EbarimtPaymentCode | null {
  if (method === 'CASH') return 'CASH';
  if (method === 'BANK_TRANSFER') return 'BANK_TRANSFER';
  return null;
}

/** Placeholder merchant facts for the centre's check: the store's edge fills the real ones. */
const CHECK_FACTS = {
  merchantTin: '00000000000',
  districtCode: '0000',
  classificationCode: '0000000',
} as const;

export interface RelayReceiptRequest {
  type: ReceiptType;
  customerTin: string | null;
  consumerNo: string | null;
  lines: readonly RelayReceiptLine[];
  payments: readonly RelayPayment[];
}

/** What the store adds to a relayed request: PosAPI's merchant and the store's own codes. */
export interface RelayStoreFacts {
  merchantTin: string;
  districtCode: string;
  branchNo: string | null;
  posNo: string | null;
  /** Used for a line without a classification code of its own. */
  defaultClassificationCode: string | null;
}

/**
 * The PosAPI request of a relayed receipt with the store's facts; throws `EbarimtBuildError` when
 * it cannot be built. A line without a classification code takes the store's default.
 */
export function buildRelayReceipt(
  request: RelayReceiptRequest,
  facts: RelayStoreFacts,
): PosapiReceiptRequest {
  return buildPosapiReceipt({
    type: request.type,
    merchantTin: facts.merchantTin,
    districtCode: facts.districtCode,
    branchNo: facts.branchNo,
    posNo: facts.posNo,
    customerTin: request.customerTin,
    consumerNo: request.consumerNo,
    inactiveId: null,
    lines: request.lines.map((line) => ({
      ...line,
      classificationCode: line.classificationCode ?? facts.defaultClassificationCode ?? '',
    })),
    payments: request.payments,
  });
}

/**
 * The centre's check at prepare (ADR-0185 #2): the request built with placeholder merchant facts,
 * so a line or a buyer PosAPI would refuse is caught before any edge asks for it. Throws
 * `EbarimtBuildError`. A missing classification code passes: the store's default fills it.
 */
export function checkRelayReceipt(request: RelayReceiptRequest): { total: Decimal } {
  const built = buildRelayReceipt(request, {
    merchantTin: CHECK_FACTS.merchantTin,
    districtCode: CHECK_FACTS.districtCode,
    branchNo: null,
    posNo: null,
    defaultClassificationCode: CHECK_FACTS.classificationCode,
  });
  return { total: built.totalAmount };
}
