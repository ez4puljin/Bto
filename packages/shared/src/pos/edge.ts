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
import type {
  EbarimtStatus,
  PosEventKind,
  ReceiptType,
  SaleKind,
  SyncResult,
  TenderKind,
  VoidReason,
} from './index';

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
  amount: string;
  tendered: string | null;
  terminalId: string | null;
  rrn: string | null;
  maskedPan: string | null;
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

/** One document of `POST /api/v1/pos/sync/events`, in the shape of the centre's SyncEventDto. */
export type SyncEventWire =
  | { kind: 'SALE' | 'RETURN'; clientId: string; sale: SaleDocWire }
  | { kind: 'VOID'; clientId: string; voided: VoidDocWire }
  | { kind: 'SHIFT_OPENED'; clientId: string; shiftOpened: ShiftOpenDocWire }
  | { kind: 'SHIFT_CLOSED'; clientId: string; shiftClosed: ShiftCloseDocWire }
  | { kind: 'TILL_BOUND'; clientId: string; tillBound: TillBoundDocWire };

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

export interface HeartbeatWire {
  appVersion: string | null;
  backlog: number;
  clockSkewMs: number | null;
  snapshotVersion: string | null;
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
  settings: { returnWindowDays: number; snapshotIntervalSec: number; supervisorRequired: boolean };
  company: { name: string | null; vatPayer: boolean; vatRatePct: string };
  tills: SnapshotTill[];
  cashiers: SnapshotCashier[];
  products: SnapshotProduct[];
  profiles: SnapshotProfile[];
  programs: SnapshotProgram[];
  /** The F7 panel's groups in order; absent in a snapshot taken before ADR-0104. */
  quickGroups?: SnapshotQuickGroup[];
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
  /** Returns are refunded in cash only (owner 2026-10-23, ADR-0104). */
  cashRefunds: string;
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
}

export interface EdgeTenderInput {
  kind: TenderKind;
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
  tenders: { kind: TenderKind; amount: string; tendered: string | null }[];
  change: string;
  /** TEST: the fake provider (ADR-0067), never a tax receipt; REAL arrives with PosAPI (ADR-0065). */
  ebarimt: { mode: 'TEST' | 'REAL'; ddtd: string | null };
}
