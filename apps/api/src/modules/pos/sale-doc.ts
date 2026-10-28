import type { Decimal } from '@tugeel/shared/money';
import type {
  EbarimtStatus,
  PosEventKind,
  ReceiptType,
  SaleKind,
  SyncResult,
  TenderKind,
  VoidReason,
} from '@tugeel/shared/pos';
import type { PriceBasis } from '@tugeel/shared/pricing';
import type { ProblemParams } from '../../common/errors/app-error';

/**
 * The documents a till produces, as the edge replays them and as the test till builds them
 * (ADR-0063 #4). Money and quantities are `Decimal`; the controllers parse the strings.
 */

export interface SaleDocLine {
  lineNo: number;
  productId: number;
  productUnitId: number;
  qty: Decimal;
  factorSnapshot: Decimal;
  basis: PriceBasis;
  listPrice: Decimal;
  unitPrice: Decimal;
  discountAmount: Decimal;
  subtotal: Decimal;
  total: Decimal;
  vatRatePct: Decimal;
  vatAmount: Decimal;
  applied: unknown[];
  /** On a RETURN: the line number of the sold line this one takes back. */
  refundsLineNo: number | null;
  damaged: boolean;
}

export interface SaleDocTender {
  kind: TenderKind;
  /** ADR-0111: the admin's payment type and its name as the till had it; null from older edges. */
  paymentTypeId: number | null;
  paymentTypeName: string | null;
  amount: Decimal;
  tendered: Decimal | null;
  terminalId: string | null;
  rrn: string | null;
  maskedPan: string | null;
}

/** What the edge knows of the e-Barimt receipt; never the lottery or the QR (ADR-0065). */
export interface EbarimtFacts {
  status: EbarimtStatus;
  ddtd: string | null;
  posapiDate: string | null;
  billIdSuffix: string | null;
  inactiveId: string | null;
}

export interface SaleDoc {
  clientId: string;
  kind: SaleKind;
  tillCode: string;
  shiftClientId: string;
  cashierUserId: number;
  approvedByUserId: number | null;
  number: string;
  soldAt: Date;
  receiptType: ReceiptType;
  customerTin: string | null;
  customerName: string | null;
  consumerNo: string | null;
  /** On a RETURN: the sale it takes goods back from. */
  refundsSaleClientId: string | null;
  /** The registered customer a CREDIT tender charges (ADR-0109); null without credit. */
  customerId: number | null;
  lines: SaleDocLine[];
  tenders: SaleDocTender[];
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
  note: string | null;
  snapshotVersion: string | null;
  ebarimt: EbarimtFacts | null;
}

export interface ShiftOpenDoc {
  clientId: string;
  tillCode: string;
  cashierUserId: number;
  number: string;
  openedAt: Date;
  openingFloat: Decimal;
}

export interface ShiftCloseDoc {
  clientId: string;
  closedAt: Date;
  countedCash: Decimal;
  floatKept: Decimal;
  note: string | null;
}

export interface ReceiptStatusDoc {
  saleClientId: string;
  ebarimt: EbarimtFacts;
}

export interface TillBoundDoc {
  tillCode: string;
  deviceTokenHash: string;
  userAgent: string | null;
  boundByUserId: number | null;
  boundAt: Date;
}

export interface VoidDocLine {
  productId: number;
  productUnitId: number;
  qty: Decimal;
  unitPrice: Decimal;
  total: Decimal;
}

/** Goods taken off a till's cart before payment, approved by a supervisor (ADR-0104). */
export interface VoidDoc {
  clientId: string;
  tillCode: string;
  shiftClientId: string | null;
  cashierUserId: number;
  approvedByUserId: number | null;
  voidedAt: Date;
  reason: VoidReason;
  lines: VoidDocLine[];
  total: Decimal;
}

/** A till's banknote count for its day summary (ADR-0111): kept, never posted. */
export interface DayCountDoc {
  clientId: string;
  tillCode: string;
  day: string;
  cashierUserId: number;
  counts: { note: number; count: number }[];
  total: Decimal;
  countedAt: Date;
}

export type SyncEvent =
  | { kind: 'SALE' | 'RETURN'; clientId: string; payload: SaleDoc }
  | { kind: 'VOID'; clientId: string; payload: VoidDoc }
  | { kind: 'SHIFT_OPENED'; clientId: string; payload: ShiftOpenDoc }
  | { kind: 'SHIFT_CLOSED'; clientId: string; payload: ShiftCloseDoc }
  | { kind: 'RECEIPT_STATUS'; clientId: string; payload: ReceiptStatusDoc }
  | { kind: 'TILL_BOUND'; clientId: string; payload: TillBoundDoc }
  | { kind: 'DAY_COUNT'; clientId: string; payload: DayCountDoc };

export interface SyncOutcome {
  clientId: string;
  kind: PosEventKind;
  status: SyncResult;
  id: number | null;
  number: string | null;
  code: string | null;
  params: ProblemParams | null;
}

/** What an accept returns: the row, and whether this call created it. */
export interface Accepted {
  id: number;
  number: string;
  created: boolean;
}
