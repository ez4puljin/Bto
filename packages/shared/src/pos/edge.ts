import { Decimal } from '../money';
import {
  type DiscountEffect,
  type DiscountMeasure,
  type DiscountScope,
  type PriceBasis,
  type PriceRounding,
  type QuoteLineInput,
  type QuoteProduct,
  type QuoteProgram,
  type QuoteResult,
} from '../pricing';
import type { EbarimtTaxType } from '../mn';
import type {
  EbarimtStatus,
  PosEventKind,
  ReceiptType,
  SaleKind,
  SyncResult,
  TenderKind,
  VoidReason,
} from './index';
import type { LoyaltyMemberStatus } from './loyalty';
import type { VoucherEffect, VoucherKind, VoucherRefusal } from './vouchers';

/*
 * The store edge (ADR-0063, ADR-0067): what crosses the wire between the centre, the edge and the
 * kiosk. Money, quantities and factors travel as strings (NUMERIC), dates as ISO strings. The
 * centre's DTOs validate the sync documents; the edge and the kiosk share these shapes.
 */

// ---------------------------------------------------------------- edge → centre (sync)

export interface SaleDocLineWire {
  lineNo: number;
  productId: number;
  productUnitId: number;
  qty: string;
  factorSnapshot: string;
  basis: PriceBasis;
  listPrice: string;
  unitPrice: string;
  discountAmount: string;
  subtotal: string;
  total: string;
  vatRatePct: string;
  vatAmount: string;
  applied: unknown[];
  refundsLineNo: number | null;
  damaged: boolean;
}

export interface TenderWire {
  kind: TenderKind;
  /** ADR-0111: the admin's payment type the cashier chose and its name; absent on older edges. */
  paymentTypeId?: number | null;
  paymentTypeName?: string | null;
  amount: string;
  tendered: string | null;
  terminalId: string | null;
  rrn: string | null;
  maskedPan: string | null;
  /** A VOUCHER tender's code (ADR-0110); absent or null otherwise. */
  voucherCode?: string | null;
}

/**
 * A code a till took on a sale (ADR-0110): a coupon's discount (inside the lines' discounts) or a
 * partner voucher's payment (its VOUCHER tender), with the face value the partner is billed.
 */
export interface SaleVoucherWire {
  voucherId: number;
  code: string;
  kind: VoucherKind;
  /** A partner voucher's face value; a coupon's value as printed (percent or tugriks). */
  face: string;
  /** What it took off (a coupon) or paid (a partner voucher). */
  amount: string;
}

/**
 * A bonus card member's part of a sale or a return (ADR-0112). On a SALE: the money base it earned
 * on, the tier's percent, the points earned and spent (its POINTS tender); `spendDelta` = the base.
 * On a RETURN: the points given back (its POINTS tender), the earned points taken back, and
 * `spendDelta` = minus the money returned. `earned` / `spent` are 0 on a return.
 */
export interface SaleLoyaltyWire {
  memberId: number;
  earnBase: string;
  percent: string;
  earned: string;
  spent: string;
  givenBack: string;
  clawback: string;
  spendDelta: string;
}

export interface EbarimtFactsWire {
  status: EbarimtStatus;
  ddtd: string | null;
  posapiDate: string | null;
  billIdSuffix: string | null;
  inactiveId: string | null;
}

export interface SaleDocWire {
  clientId: string;
  kind: SaleKind;
  tillCode: string;
  shiftClientId: string;
  cashierUserId: number;
  approvedByUserId: number | null;
  number: string;
  soldAt: string;
  receiptType: ReceiptType;
  customerTin: string | null;
  customerName: string | null;
  consumerNo: string | null;
  refundsSaleClientId: string | null;
  /**
   * The registered customer a CREDIT tender charges (ADR-0109); null without credit. Absent from an
   * edge older than ADR-0109.
   */
  customerId?: number | null;
  /** The coupons and partner vouchers the till took (ADR-0110); absent from an older edge. */
  vouchers?: SaleVoucherWire[];
  /** The bonus card member's points (ADR-0112); absent or null without a member. */
  loyalty?: SaleLoyaltyWire | null;
  lines: SaleDocLineWire[];
  tenders: TenderWire[];
  subtotal: string;
  discountTotal: string;
  total: string;
  vatTotal: string;
  note: string | null;
  snapshotVersion: string | null;
  ebarimt: EbarimtFactsWire | null;
}

export interface ShiftOpenDocWire {
  clientId: string;
  tillCode: string;
  cashierUserId: number;
  number: string;
  openedAt: string;
  openingFloat: string;
}

export interface ShiftCloseDocWire {
  clientId: string;
  closedAt: string;
  countedCash: string;
  floatKept: string;
  note: string | null;
}

export interface TillBoundDocWire {
  tillCode: string;
  deviceTokenHash: string;
  userAgent: string | null;
  boundByUserId: number | null;
  boundAt: string;
}

export interface VoidLineWire {
  productId: number;
  productUnitId: number;
  qty: string;
  unitPrice: string;
  total: string;
}

/** Goods taken off a cart before payment, with the supervisor who approved it (ADR-0104). */
export interface VoidDocWire {
  clientId: string;
  tillCode: string;
  /** Null when no shift was open on the till (a parked basket cancelled between shifts). */
  shiftClientId: string | null;
  cashierUserId: number;
  approvedByUserId: number | null;
  voidedAt: string;
  reason: VoidReason;
  lines: VoidLineWire[];
  total: string;
}

/** The till's banknote count for its day summary (ADR-0111): kept, never posted. */
export interface DayCountDocWire {
  clientId: string;
  tillCode: string;
  /** The Ulaanbaatar business day it counts. */
  day: string;
  cashierUserId: number;
  counts: { note: number; count: number }[];
  total: string;
  countedAt: string;
}

/** What the edge learnt of a sale's (or a return's) receipt after it replayed it (ADR-0065). */
export interface ReceiptStatusDocWire {
  saleClientId: string;
  ebarimt: EbarimtFactsWire;
}

/** One document of `POST /api/v1/pos/sync/events`, in the shape of the centre's SyncEventDto. */
export type SyncEventWire =
  | { kind: 'SALE' | 'RETURN'; clientId: string; sale: SaleDocWire }
  | { kind: 'VOID'; clientId: string; voided: VoidDocWire }
  | { kind: 'SHIFT_OPENED'; clientId: string; shiftOpened: ShiftOpenDocWire }
  | { kind: 'SHIFT_CLOSED'; clientId: string; shiftClosed: ShiftCloseDocWire }
  | { kind: 'TILL_BOUND'; clientId: string; tillBound: TillBoundDocWire }
  | { kind: 'RECEIPT_STATUS'; clientId: string; receiptStatus: ReceiptStatusDocWire }
  | { kind: 'DAY_COUNT'; clientId: string; dayCount: DayCountDocWire };

export interface SyncOutcomeWire {
  clientId: string;
  kind: PosEventKind;
  status: SyncResult;
  id: number | null;
  number: string | null;
  code: string | null;
  params: Record<string, unknown> | null;
}

export interface SyncResponseWire {
  results: SyncOutcomeWire[];
  serverTime: string;
}

/** The store PosAPI as the edge last read it (`GET /rest/info`, ADR-0065); never a credential. */
export interface PosapiInfoWire {
  version: string | null;
  /** `lastSentDate` verbatim (when PosAPI last sent its receipts to the tax office). */
  lastSentDate: string | null;
  leftLotteries: number | null;
  checkedAt: string;
  /** Why the last read failed; null when it answered. */
  error: string | null;
}

export interface HeartbeatWire {
  appVersion: string | null;
  backlog: number;
  clockSkewMs: number | null;
  snapshotVersion: string | null;
  /** Absent from an edge older than ADR-0065 or one on the fake provider. */
  posapi?: PosapiInfoWire | null;
}

// ---------------------------------------------------------------- centre → edge (snapshot)

export interface SnapshotUnit {
  unitId: number;
  uomId: number;
  uomName: string;
  factor: string;
  isBase: boolean;
  /** Barcode lookup keys (`classify(code).lookupKey` of @tugeel/shared/gtin). */
  barcodes: string[];
  /** The barcodes as printed, for the till's search rows and price check (ADR-0104); absent in older snapshots. */
  codes?: string[];
}

export interface SnapshotProduct {
  id: number;
  sku: string;
  name: string;
  categoryId: number;
  /** VAT the company charges on it today (0 for an exempt product or a non-payer). */
  vatRatePct: string;
  /** The e-Barimt tax type (the catalog's `vat_type`); absent in a snapshot older than ADR-0065. */
  vatType?: EbarimtTaxType;
  taxProductCode?: string | null;
  /** The product's classification code, else its nearest category's default (ADR-0065). */
  classificationCode?: string | null;
  units: SnapshotUnit[];
  /** Null without price terms or a profile version today: the till cannot sell it. */
  terms: { warehousePrice: string; wholeUomId: number | null; profileId: number } | null;
}

export interface SnapshotProfile {
  id: number;
  looseMarkupPct: string;
  retailMarkupPct: string;
  retailBulkMinQty: string | null;
  retailBulkMarkupPct: string | null;
  rounding: PriceRounding;
}

export interface SnapshotProgram {
  id: number;
  name: string;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productId: number | null;
  productUnitId: number | null;
  categoryIds: number[] | null;
  countUomId: number | null;
  steps: { threshold: string; value: string }[];
}

export interface SnapshotTill {
  id: number;
  code: string;
  name: string;
  /** The STORE warehouse the till sells from (ADR-0123); absent in older snapshots. */
  warehouseId?: number;
  warehouseName?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** sha-256 of `${id}:${code}` of the one-time pairing code the admin issued (S1). */
  pairingCodeHash: string | null;
  pairingExpiresAt: string | null;
}

export interface SnapshotCashier {
  userId: number;
  fullName: string;
  status: 'ACTIVE' | 'INACTIVE';
  /** argon2id keyed with POS_PIN_PEPPER; null until the admin sets a PIN. */
  pinHash: string | null;
  /** May approve returns and no-sale drawer openings (`pos.till.supervise`). */
  supervisor: boolean;
}

/** A way to pay the admin offers at the till (ADR-0111), in the order the till lists them. */
export interface SnapshotPaymentType {
  id: number;
  name: string;
  kind: TenderKind;
}

/** A quick button: a product unit the admin put on the till's F7 panel (ADR-0104). */
export interface SnapshotQuickButton {
  productId: number;
  unitId: number;
  label: string | null;
}

export interface SnapshotQuickGroup {
  id: number;
  name: string;
  buttons: SnapshotQuickButton[];
}

export interface PosSnapshot {
  version: string;
  generatedAt: string;
  businessDate: string;
  node: { id: number; code: string; name: string; warehouseId: number; warehouseName: string };
  settings: {
    returnWindowDays: number;
    snapshotIntervalSec: number;
    supervisorRequired: boolean;
    /** ADR-0065: the receipt's heading and closing line, the store's e-Barimt codes. */
    receiptTitle?: string | null;
    receiptFooter?: string | null;
    ebarimtDistrictCode?: string | null;
    ebarimtClassificationCode?: string | null;
  };
  company: { name: string | null; vatPayer: boolean; vatRatePct: string };
  tills: SnapshotTill[];
  cashiers: SnapshotCashier[];
  products: SnapshotProduct[];
  profiles: SnapshotProfile[];
  programs: SnapshotProgram[];
  /** The F7 panel's groups in order; absent in a snapshot taken before ADR-0104. */
  quickGroups?: SnapshotQuickGroup[];
  /** ADR-0111: the active payment types in order; absent in a snapshot taken before it. */
  paymentTypes?: SnapshotPaymentType[];
}

/**
 * A customer as the till may charge it (ADR-0109): who it is, whether credit is stopped, its limit
 * (null: none set, so unlimited) and its exposure when the feed was built — the net receivable and
 * the confirmed wholesale orders not yet invoiced.
 */
export interface PosCustomerStanding {
  id: number;
  code: string;
  name: string;
  tin: string | null;
  regNo: string | null;
  phone: string | null;
  creditHold: boolean;
  creditLimit: string | null;
  exposure: string;
}

/** The store's customers (`GET /api/v1/pos/sync/customers?since=`), apart from the snapshot. */
export interface PosCustomerFeed {
  version: string;
  generatedAt: string;
  customers: PosCustomerStanding[];
}

export type CustomerFeedResponseWire =
  { changed: true; feed: PosCustomerFeed } | { changed: false; version: string };

/**
 * A code the till may take (ADR-0110): an ISSUED code of an ACTIVE batch not yet past its last
 * day, with its batch's terms and, for a partner voucher, the partner billed.
 */
export interface PosVoucherFacts {
  id: number;
  code: string;
  kind: VoucherKind;
  batchId: number;
  batchNumber: string;
  name: string;
  effect: VoucherEffect;
  value: string;
  validFrom: string;
  validTo: string;
  customerId: number | null;
  customerName: string | null;
}

/** The store's codes (`GET /api/v1/pos/sync/vouchers?since=`), apart from the snapshot. */
export interface PosVoucherFeed {
  version: string;
  generatedAt: string;
  vouchers: PosVoucherFacts[];
}

export type VoucherFeedResponseWire =
  { changed: true; feed: PosVoucherFeed } | { changed: false; version: string };

/** A bonus card tier as the till applies it (ADR-0112). */
export interface PosLoyaltyTierFacts {
  id: number;
  name: string;
  fromAmount: string;
  percent: string;
}

/**
 * A bonus card member as the till knows it (ADR-0112): the PIN's argon2 hash (keyed with the POS
 * pepper, like a cashier's), its version (a new PIN clears the till's lock), the balance and the
 * lifetime spend as the centre counted them when the feed was built.
 */
export interface PosLoyaltyMemberFacts {
  id: number;
  name: string;
  phone: string;
  pinHash: string;
  pinVersion: number;
  status: LoyaltyMemberStatus;
  balance: string;
  lifetime: string;
}

/** The bonus card (`GET /api/v1/pos/sync/loyalty?since=`), apart from the snapshot. */
export interface PosLoyaltyFeed {
  version: string;
  generatedAt: string;
  tiers: PosLoyaltyTierFacts[];
  members: PosLoyaltyMemberFacts[];
}

export type LoyaltyFeedResponseWire =
  { changed: true; feed: PosLoyaltyFeed } | { changed: false; version: string };

/**
 * `POST /api/v1/pos/sync/credit-check`: the centre's answer under the customer lock (ADR-0109 #7),
 * counting what this edge sold on credit and has not replayed yet.
 */
export interface CreditCheckRequestWire {
  customerId: number;
  amount: string;
  pendingOnEdge: string;
}

export interface CreditCheckResponseWire {
  ok: boolean;
  reason: 'HOLD' | 'LIMIT' | 'INACTIVE' | null;
  exposure: string;
  limit: string | null;
  excess: string;
}

/** `GET /api/v1/pos/snapshot?since=`: the whole snapshot, or only its version when unchanged. */
export type SnapshotResponseWire =
  { changed: true; snapshot: PosSnapshot } | { changed: false; version: string };

/** The pure resolver's context for RETAIL out of a snapshot (the same numbers as the centre). */
export function quoteContextOf(snapshot: PosSnapshot): {
  products: Map<number, QuoteProduct>;
  programs: QuoteProgram[];
} {
  const profiles = new Map(snapshot.profiles.map((profile) => [profile.id, profile]));
  const products = new Map<number, QuoteProduct>();
  for (const product of snapshot.products) {
    const profile = product.terms ? profiles.get(product.terms.profileId) : undefined;
    products.set(product.id, {
      categoryId: product.categoryId,
      units: product.units.map((unit) => ({
        unitId: unit.unitId,
        uomId: unit.uomId,
        factor: new Decimal(unit.factor),
        isBase: unit.isBase,
      })),
      terms:
        product.terms && profile
          ? {
              warehousePrice: new Decimal(product.terms.warehousePrice),
              wholeUomId: product.terms.wholeUomId,
              profile: {
                looseMarkupPct: new Decimal(profile.looseMarkupPct),
                retailMarkupPct: new Decimal(profile.retailMarkupPct),
                retailBulkMinQty:
                  profile.retailBulkMinQty === null ? null : new Decimal(profile.retailBulkMinQty),
                retailBulkMarkupPct:
                  profile.retailBulkMarkupPct === null
                    ? null
                    : new Decimal(profile.retailBulkMarkupPct),
                rounding: profile.rounding,
              },
            }
          : null,
    });
  }
  const programs: QuoteProgram[] = snapshot.programs.map((program) => ({
    id: program.id,
    name: program.name,
    scope: program.scope,
    measure: program.measure,
    effect: program.effect,
    productId: program.productId,
    productUnitId: program.productUnitId,
    categoryIds: program.categoryIds ? new Set(program.categoryIds) : null,
    countUomId: program.countUomId,
    steps: program.steps.map((step) => ({
      threshold: new Decimal(step.threshold),
      value: new Decimal(step.value),
    })),
  }));
  return { products, programs };
}

/**
 * A priced cart as sale document lines (the test till's `priceLines` twin): one line per priced
 * part, the VAT of each line out of its total at the product's rate.
 */
export function saleDocLinesOf(
  inputs: readonly QuoteLineInput[],
  result: QuoteResult,
  units: ReadonlyMap<number, { factor: string }>,
  vatRateOf: (productId: number) => Decimal,
  lineVat: (total: Decimal, ratePct: Decimal) => Decimal,
): SaleDocLineWire[] {
  const lines: SaleDocLineWire[] = [];
  inputs.forEach((input, index) => {
    const line = result.lines[index];
    if (!line?.priced) return;
    const rate = vatRateOf(input.productId);
    for (const part of line.parts) {
      lines.push({
        lineNo: lines.length + 1,
        productId: input.productId,
        productUnitId: part.unitId,
        qty: part.qty.toFixed(3),
        factorSnapshot: new Decimal(units.get(part.unitId)?.factor ?? '1').toFixed(6),
        basis: part.basis,
        listPrice: part.listPrice.toFixed(2),
        unitPrice: part.unitPrice.toFixed(2),
        discountAmount: part.discountAmount.toFixed(2),
        subtotal: part.subtotal.toFixed(2),
        total: part.total.toFixed(2),
        vatRatePct: rate.toFixed(2),
        vatAmount: lineVat(part.total, rate).toFixed(2),
        applied: JSON.parse(JSON.stringify(part.applied)) as unknown[],
        refundsLineNo: null,
        damaged: false,
      });
    }
  });
  return lines;
}

// ---------------------------------------------------------------- kiosk ↔ edge (`/edge/v1`)

/** Where the kiosk finds its edge: the same origin, under this prefix (Caddy or Vite proxies it). */
export const EDGE_API_PREFIX = '/edge/v1';
/** The bound browser's credential, kept in its localStorage after pairing. */
export const EDGE_DEVICE_HEADER = 'x-bto-device';

export interface EdgeHealth {
  status: 'ok';
  version: string;
  node: { code: string; name: string } | null;
  snapshot: { version: string | null; pulledAt: string | null; products: number };
  central: { reachable: boolean; lastPullAt: string | null; lastPushAt: string | null };
  outbox: { pending: number; rejected: number };
  /** ADR-0065: the provider and how many receipts wait to be printed or checked on this edge. */
  ebarimt?: EdgeEbarimtSummary;
}

export interface EdgeEbarimtSummary {
  provider: 'fake' | 'posapi';
  /** Issued late (PosAPI was away) and not printed yet. */
  ready: number;
  /** Waiting for PosAPI, failed or unanswered: a supervisor looks at them. */
  attention: number;
}

export interface EdgePairRequest {
  tillCode: string;
  pairingCode: string;
}

export interface EdgePairResponse {
  deviceToken: string;
  till: { code: string; name: string };
}

export interface EdgeDeviceInfo {
  till: { code: string; name: string };
  cashiers: { userId: number; fullName: string }[];
  companyName: string | null;
}

export interface EdgeLoginRequest {
  userId: number;
  pin: string;
}

export interface EdgeCashier {
  userId: number;
  fullName: string;
  supervisor: boolean;
}

export interface EdgeLoginResponse {
  token: string;
  expiresAt: string;
  cashier: EdgeCashier;
}

export interface EdgeShiftSummary {
  clientId: string;
  number: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  cashierName: string;
  openingFloat: string;
  salesCount: number;
  cashSales: string;
  cardSales: string;
  /** The sales' total and VAT, returns not netted. */
  total: string;
  vatTotal: string;
  returnsCount: number;
  /** Returns are refunded in cash (owner 2026-10-23, ADR-0104), a credit sale's off its debt first. */
  cashRefunds: string;
  /** ADR-0109: sold on credit, and taken back off customers' debts; absent on older edges. */
  creditSales?: string;
  creditRefunds?: string;
  /** ADR-0110: paid by partner vouchers; absent on older edges. */
  voucherSales?: string;
  /** ADR-0112: paid with bonus points, and given back as points; absent on older edges. */
  pointsSales?: string;
  pointsRefunds?: string;
  /** ADR-0111: bank transfers; and every payment type's sales less refunds, in the till's order. */
  transferSales?: string;
  payments?: EdgePaymentTotal[];
  expectedCash: string;
  closedAt: string | null;
  countedCash: string | null;
  floatKept: string | null;
  variance: string | null;
}

export interface EdgeSession {
  till: { code: string; name: string };
  cashier: EdgeCashier;
  shift: EdgeShiftSummary | null;
  businessDate: string;
  companyName: string | null;
  /** Whether a void or a return needs a supervisor's PIN (the store's settings, ADR-0104). */
  approvalRequired?: boolean;
  /** ADR-0111: the payment types the till offers, in order; absent from an older edge. */
  paymentTypes?: SnapshotPaymentType[];
}

export interface EdgeShiftOpenRequest {
  openingFloat: string;
}

export interface EdgeShiftCloseRequest {
  countedCash: string;
  floatKept: string;
  note: string | null;
}

export interface EdgeProductUnitHit {
  unitId: number;
  uomName: string;
  factor: string;
  isBase: boolean;
  /** RETAIL price of one unit today; null when the product cannot be sold yet. */
  price: string | null;
  /** Its barcodes as printed. */
  barcodes: string[];
}

export interface EdgeProductHit {
  productId: number;
  sku: string;
  name: string;
  units: EdgeProductUnitHit[];
}

/** One F7 button as the till shows it: the product with today's prices, the unit it adds. */
export interface EdgeQuickButton {
  label: string | null;
  unitId: number;
  product: EdgeProductHit;
}

export interface EdgeQuickGroup {
  id: number;
  name: string;
  buttons: EdgeQuickButton[];
}

/** A barcode resolves to a product and the unit the code is printed on. */
export interface EdgeBarcodeHit {
  product: EdgeProductHit;
  unitId: number;
}

export interface EdgeCartLine {
  productUnitId: number;
  qty: string;
}

export interface EdgeQuoteRequest {
  lines: EdgeCartLine[];
  /** The coupons and partner vouchers scanned, in order (ADR-0110). */
  codes?: string[];
}

/** A code as the till shows it (ADR-0110). */
export interface EdgeVoucher {
  code: string;
  kind: VoucherKind;
  name: string;
  effect: VoucherEffect;
  value: string;
  partnerName: string | null;
  validTo: string;
}

/** A code the till refused, with why. */
export interface EdgeVoucherRefused {
  code: string;
  reason: VoucherRefusal;
}

/** A code on a quote: what a coupon took off or a partner voucher pays. */
export interface EdgeQuotedVoucher extends EdgeVoucher {
  amount: string;
}

export interface EdgeQuotedLine {
  productId: number;
  productUnitId: number;
  sku: string;
  name: string;
  uomName: string;
  qty: string;
  priced: boolean;
  /** The line's price of one unit after its own discounts; null when not priced. */
  unitPrice: string | null;
  total: string | null;
  discount: string | null;
}

export interface EdgeQuoteResponse {
  lines: EdgeQuotedLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  vatTotal: string;
  /** ADR-0110: the codes taken, what the partner vouchers pay and what is left to pay. */
  vouchers?: EdgeQuotedVoucher[];
  voucherTotal?: string;
  due?: string;
}

export interface EdgeTenderInput {
  kind: TenderKind;
  /** ADR-0111: the payment type chosen; the edge takes the kind from it. */
  paymentTypeId?: number | null;
  amount: string;
  /** Cash handed over; the change is what exceeds the amount. */
  tendered?: string | null;
  terminalId?: string | null;
  rrn?: string | null;
}

export interface EdgeSaleRequest {
  /** A uuid the kiosk draws once per sale: a repeated request returns the same receipt. */
  clientId: string;
  lines: EdgeCartLine[];
  tenders: EdgeTenderInput[];
  /** A company's receipt (B2B, ADR-0065): its TIN as the lookup answered; absent for a citizen. */
  buyer?: { tin: string } | null;
  /**
   * The receipt the cashier chose (ADR-0109): «Хувь хүн» B2C or «Байгууллага» B2B (which needs the
   * buyer). Absent from an older kiosk: B2B when a buyer is given. Ignored for a sale with credit,
   * which gets no e-Barimt.
   */
  receiptType?: ReceiptType;
  /** The registered customer a CREDIT tender charges (required with one). */
  customerId?: number | null;
  /** The cashier went on after the offline warning that the customer's limit is passed. */
  acceptOverLimit?: boolean;
  /**
   * The coupons and partner vouchers scanned, in order (ADR-0110). The edge derives the vouchers'
   * tenders; the kiosk's tenders make what is left (the quote's `due`).
   */
  codes?: string[];
  /** A supervisor's PIN, once for the sale's codes (required with codes). */
  voucherApproval?: EdgeApproval | null;
  /**
   * The bonus card member (ADR-0112), found by phone; `pin` is the member's own PIN, required when
   * a POINTS tender spends points.
   */
  member?: { id: number; pin?: string | null } | null;
}

/** A bonus card member as the till shows it (ADR-0112), from the edge's feed and its own sales. */
export interface EdgeMember {
  id: number;
  name: string;
  /** The phone with its middle digits hidden. */
  phone: string;
  status: LoyaltyMemberStatus;
  /** The points this edge may spend: the centre's balance and this edge's sales not yet counted. */
  balance: string;
  lifetime: string;
  tier: { name: string; percent: string } | null;
  nextTier: { name: string; percent: string; fromAmount: string; left: string } | null;
}

export interface EdgeMemberPinRequest {
  pin: string;
}

/** A customer the till may sell to on credit (ADR-0109), from the edge's feed. */
export interface EdgeCustomer {
  id: number;
  code: string;
  name: string;
  tin: string | null;
  phone: string | null;
  creditHold: boolean;
  creditLimit: string | null;
  /** What is left of the limit as this edge knows it; null without a limit. */
  available: string | null;
}

/** A supervisor's PIN typed at the till for a void or a return (ADR-0104). */
export interface EdgeApproval {
  supervisorUserId: number;
  pin: string;
}

export interface EdgeSupervisor {
  userId: number;
  fullName: string;
}

export interface EdgeVoidRequest {
  clientId: string;
  reason: VoidReason;
  /** What leaves the cart: the removed line, or the part a lower quantity takes off. */
  lines: EdgeCartLine[];
  /** Required while the store's settings ask for a supervisor. */
  approval: EdgeApproval | null;
}

export interface EdgeVoidResponse {
  clientId: string;
  approvedByName: string | null;
}

/** A cart set aside on its till (ADR-0104): resumed there, at that day's prices. */
export interface EdgeParkedBasket {
  clientId: string;
  tillCode: string;
  cashierName: string;
  parkedAt: string;
  lines: EdgeCartLine[];
  itemCount: number;
  /** What the cart came to when it was parked; the resume prices it again. */
  total: string;
  /** The first products' names, to tell the baskets apart. */
  preview: string;
}

export interface EdgeParkRequest {
  clientId: string;
  lines: EdgeCartLine[];
}

export interface EdgeDiscardParkedRequest {
  approval: EdgeApproval | null;
}

export interface EdgeReturnableLine {
  lineNo: number;
  productId: number;
  productUnitId: number;
  name: string;
  uomName: string;
  qty: string;
  unitPrice: string;
  total: string;
  /** What is left to take back after earlier returns of this sale. */
  returnable: string;
}

/** A sale found by its receipt number for a return at the till. */
export interface EdgeReturnSale {
  clientId: string;
  number: string;
  soldAt: string;
  soldDay: string;
  tillCode: string;
  total: string;
  windowDays: number;
  withinWindow: boolean;
  /** ADR-0109: a sale with credit — its customer and the credit not yet taken back. */
  credit?: { customerName: string; left: string } | null;
  /** ADR-0110: a sale paid partly by vouchers gives back at most this (its cash and card left). */
  refundable?: string | null;
  /** ADR-0112: a bonus card sale — its member and the points it spent and earned. */
  loyalty?: { memberName: string; spent: string; earned: string } | null;
  lines: EdgeReturnableLine[];
}

export interface EdgeReturnLineInput {
  refundsLineNo: number;
  qty: string;
  damaged: boolean;
}

export interface EdgeReturnRequest {
  clientId: string;
  refundsSaleClientId: string;
  lines: EdgeReturnLineInput[];
  approval: EdgeApproval | null;
}

export interface EdgeReceiptLine {
  name: string;
  uomName: string;
  qty: string;
  unitPrice: string;
  total: string;
}

export interface EdgeReceipt {
  clientId: string;
  /** A RETURN pays the total back in cash. Absent on receipts stored before ADR-0104. */
  kind?: SaleKind;
  /** The sale a return takes goods back from. */
  refundsNumber?: string | null;
  number: string;
  soldAt: string;
  tillCode: string;
  cashierName: string;
  companyName: string | null;
  lines: EdgeReceiptLine[];
  subtotal: string;
  discountTotal: string;
  total: string;
  vatTotal: string;
  tenders: {
    kind: TenderKind;
    amount: string;
    tendered: string | null;
    /** ADR-0111: the payment type's name as printed; absent on older receipts. */
    name?: string | null;
  }[];
  change: string;
  /** ADR-0110: the coupons and partner vouchers taken (amount = what each took off or paid). */
  vouchers?: { code: string; kind: VoucherKind; name: string; amount: string }[];
  /**
   * ADR-0112: the bonus card — the member, the tier the sale earned at, the points earned, spent,
   * given back and taken back, and the balance after this document as the edge knows it.
   */
  loyalty?: {
    memberName: string;
    phone: string;
    tierName: string | null;
    percent: string;
    earned: string;
    spent: string;
    givenBack: string;
    clawback: string;
    balance: string;
  } | null;
  /**
   * A sale with credit (ADR-0109): the customer it is charged to and how much; printed as a credit
   * slip in two copies, without VAT, QR or lottery. Absent or null otherwise.
   */
  credit?: {
    customerId: number;
    customerCode: string;
    customerName: string;
    amount: string;
  } | null;
  /** The store's heading and closing line from its settings (ADR-0065); absent on older receipts. */
  title?: string | null;
  footer?: string | null;
  /** TEST: the fake provider (ADR-0067), never a tax receipt; REAL: the store PosAPI (ADR-0065). */
  ebarimt: EdgeReceiptEbarimt;
}

/** The receipt's e-Barimt facts as kept on the edge: never the lottery or the QR (ADR-0065). */
export interface EdgeReceiptEbarimt {
  mode: 'TEST' | 'REAL';
  ddtd: string | null;
  status?: EbarimtStatus;
  /** PosAPI's `date` verbatim. */
  posapiDate?: string | null;
  receiptType?: ReceiptType;
  customerTin?: string | null;
  customerName?: string | null;
  merchantTin?: string | null;
  merchantName?: string | null;
  /** The ДДТД this receipt replaced (a partial return's new receipt). */
  inactiveId?: string | null;
  /** PosAPI's refusal, shown to the supervisor. */
  message?: string | null;
}

/**
 * What only a printer may see (ADR-0065, CLAUDE.md NEVER): the lottery and the QR data, held in
 * the edge's memory for the till's last receipt and for a late receipt until it is printed once.
 * Never stored, never logged.
 */
export interface EdgePrintSecrets {
  lottery: string | null;
  qrData: string | null;
}

/** A receipt to print: with the secrets while the edge still holds them, else a copy. */
export interface EdgePrintableReceipt {
  receipt: EdgeReceipt;
  print: EdgePrintSecrets | null;
  /** Printed before, or the secrets are gone: «ХУУЛБАР». */
  copy: boolean;
}

/** One payment type's money on a shift or a day (ADR-0111). */
export interface EdgePaymentTotal {
  paymentTypeId: number | null;
  name: string;
  kind: TenderKind;
  sales: string;
  refunds: string;
  net: string;
}

/** A sale or a return in the till's history (ADR-0111), newest first. */
export interface EdgeSaleListItem {
  clientId: string;
  kind: SaleKind;
  number: string;
  soldAt: string;
  total: string;
  /** The payment types' names (or the kinds' on older sales). */
  payments: string[];
  customerName: string | null;
  receiptType: ReceiptType | null;
  ebarimtStatus: EbarimtStatus | null;
}

/** The till's day (ADR-0111): its money by payment type and the banknotes counted last. */
export interface EdgeDaySummary {
  tillCode: string;
  tillName: string;
  day: string;
  /** When the day's first shift opened on this till; null without a shift. */
  startedAt: string | null;
  salesCount: number;
  returnsCount: number;
  payments: EdgePaymentTotal[];
  /** The float of the day's first shift plus cash sales less cash refunds. */
  expectedCash: string;
  counted: {
    clientId: string;
    counts: { note: number; count: number }[];
    total: string;
    cashierName: string;
    countedAt: string;
  } | null;
}

export interface EdgeDayCountRequest {
  /** A uuid drawn once per count: a repeated request keeps the same count. */
  clientId: string;
  day: string;
  counts: { note: number; count: number }[];
}

/** A company found by its registration number or TIN (`api.ebarimt.mn`, online only). */
export interface EdgeTaxpayer {
  tin: string;
  name: string;
  vatPayer: boolean;
}

export const EDGE_EBARIMT_GROUPS = ['READY', 'WAITING', 'CHECK', 'ERROR'] as const;
export type EdgeEbarimtGroup = (typeof EDGE_EBARIMT_GROUPS)[number];

/** One PosAPI operation of this edge as the supervisor's list shows it. */
export interface EdgeEbarimtItem {
  id: number;
  group: EdgeEbarimtGroup;
  op: 'ISSUE' | 'CANCEL';
  saleClientId: string;
  number: string;
  kind: SaleKind;
  tillCode: string;
  soldAt: string;
  total: string;
  receiptType: ReceiptType;
  status: string;
  ddtd: string | null;
  message: string | null;
  attempts: number;
  createdAt: string;
}

export interface EdgeEbarimtQueue {
  provider: 'fake' | 'posapi';
  posapi: PosapiInfoWire | null;
  items: EdgeEbarimtItem[];
}

/** A supervisor's decision on an unanswered receipt after looking it up on ebarimt.mn. */
export interface EdgeEbarimtResolveRequest {
  outcome: 'ISSUED' | 'NOT_ISSUED';
  /** ISSUED: the ДДТД and PosAPI's date as ebarimt.mn shows them. */
  ddtd?: string | null;
  posapiDate?: string | null;
  approval: EdgeApproval | null;
}

export interface EdgeEbarimtSendDataRequest {
  approval: EdgeApproval | null;
}
