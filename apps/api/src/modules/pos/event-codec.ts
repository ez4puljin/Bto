import { Decimal } from '@tugeel/shared/money';
import { type PosEventKind, VOID_REASONS, type VoidReason } from '@tugeel/shared/pos';
import { invalid } from '../../common/errors/app-error';
import type {
  EbarimtFacts,
  ReceiptStatusDoc,
  SaleDoc,
  ShiftCloseDoc,
  ShiftOpenDoc,
  SyncEvent,
  TillBoundDoc,
  VoidDoc,
} from './sale-doc';

/**
 * Documents as JSON (money and quantities as strings, instants in ISO 8601) for the rejection log,
 * and back into the typed documents when an admin replays one (ADR-0063 #4). The DTOs validated
 * the shape when the document first arrived; a stored payload is trusted to be ours.
 */

type Json = Record<string, unknown>;

const money = (value: Decimal) => value.toFixed();
const stamp = (value: Date) => value.toISOString();

export function encodeEvent(event: SyncEvent): Json {
  switch (event.kind) {
    case 'SALE':
    case 'RETURN':
      return encodeSale(event.payload);
    case 'SHIFT_OPENED':
      return {
        ...event.payload,
        openedAt: stamp(event.payload.openedAt),
        openingFloat: money(event.payload.openingFloat),
      };
    case 'SHIFT_CLOSED':
      return {
        ...event.payload,
        closedAt: stamp(event.payload.closedAt),
        countedCash: money(event.payload.countedCash),
        floatKept: money(event.payload.floatKept),
      };
    case 'RECEIPT_STATUS':
      return { ...event.payload };
    case 'TILL_BOUND':
      return { ...event.payload, boundAt: stamp(event.payload.boundAt) };
    case 'VOID':
      return {
        ...event.payload,
        voidedAt: stamp(event.payload.voidedAt),
        total: money(event.payload.total),
        lines: event.payload.lines.map((line) => ({
          ...line,
          qty: money(line.qty),
          unitPrice: money(line.unitPrice),
          total: money(line.total),
        })),
      };
  }
}

function encodeSale(doc: SaleDoc): Json {
  return {
    ...doc,
    soldAt: stamp(doc.soldAt),
    subtotal: money(doc.subtotal),
    discountTotal: money(doc.discountTotal),
    total: money(doc.total),
    vatTotal: money(doc.vatTotal),
    lines: doc.lines.map((line) => ({
      ...line,
      qty: money(line.qty),
      factorSnapshot: money(line.factorSnapshot),
      listPrice: money(line.listPrice),
      unitPrice: money(line.unitPrice),
      discountAmount: money(line.discountAmount),
      subtotal: money(line.subtotal),
      total: money(line.total),
      vatRatePct: money(line.vatRatePct),
      vatAmount: money(line.vatAmount),
    })),
    tenders: doc.tenders.map((tender) => ({
      ...tender,
      amount: money(tender.amount),
      tendered: tender.tendered === null ? null : money(tender.tendered),
    })),
  };
}

export function decodeEvent(kind: PosEventKind, clientId: string, payload: unknown): SyncEvent {
  const json = asObject(payload);
  switch (kind) {
    case 'SALE':
    case 'RETURN':
      return { kind, clientId, payload: decodeSale(json) };
    case 'SHIFT_OPENED':
      return {
        kind,
        clientId,
        payload: {
          clientId: str(json.clientId),
          tillCode: str(json.tillCode),
          cashierUserId: int(json.cashierUserId),
          number: str(json.number),
          openedAt: date(json.openedAt),
          openingFloat: dec(json.openingFloat),
        } satisfies ShiftOpenDoc,
      };
    case 'SHIFT_CLOSED':
      return {
        kind,
        clientId,
        payload: {
          clientId: str(json.clientId),
          closedAt: date(json.closedAt),
          countedCash: dec(json.countedCash),
          floatKept: dec(json.floatKept),
          note: optStr(json.note),
        } satisfies ShiftCloseDoc,
      };
    case 'RECEIPT_STATUS':
      return {
        kind,
        clientId,
        payload: {
          saleClientId: str(json.saleClientId),
          ebarimt: facts(json.ebarimt),
        } satisfies ReceiptStatusDoc,
      };
    case 'TILL_BOUND':
      return {
        kind,
        clientId,
        payload: {
          tillCode: str(json.tillCode),
          deviceTokenHash: str(json.deviceTokenHash),
          userAgent: optStr(json.userAgent),
          boundByUserId: optInt(json.boundByUserId),
          boundAt: date(json.boundAt),
        } satisfies TillBoundDoc,
      };
    case 'VOID': {
      const reason = str(json.reason);
      if (!(VOID_REASONS as readonly string[]).includes(reason)) {
        throw invalid('reason', 'enum', 'a void reason');
      }
      return {
        kind,
        clientId,
        payload: {
          clientId: str(json.clientId),
          tillCode: str(json.tillCode),
          shiftClientId: optStr(json.shiftClientId),
          cashierUserId: int(json.cashierUserId),
          approvedByUserId: optInt(json.approvedByUserId),
          voidedAt: date(json.voidedAt),
          reason: reason as VoidReason,
          lines: list(json.lines).map((raw) => {
            const line = asObject(raw);
            return {
              productId: int(line.productId),
              productUnitId: int(line.productUnitId),
              qty: dec(line.qty),
              unitPrice: dec(line.unitPrice),
              total: dec(line.total),
            };
          }),
          total: dec(json.total),
        } satisfies VoidDoc,
      };
    }
  }
}

function decodeSale(json: Json): SaleDoc {
  const kind = str(json.kind);
  if (kind !== 'SALE' && kind !== 'RETURN') throw invalid('kind', 'enum', 'SALE or RETURN');
  const receiptType = str(json.receiptType);
  if (receiptType !== 'B2C' && receiptType !== 'B2B') {
    throw invalid('receiptType', 'enum', 'B2C or B2B');
  }
  return {
    clientId: str(json.clientId),
    kind,
    tillCode: str(json.tillCode),
    shiftClientId: str(json.shiftClientId),
    cashierUserId: int(json.cashierUserId),
    approvedByUserId: optInt(json.approvedByUserId),
    number: str(json.number),
    soldAt: date(json.soldAt),
    receiptType,
    customerTin: optStr(json.customerTin),
    customerName: optStr(json.customerName),
    consumerNo: optStr(json.consumerNo),
    refundsSaleClientId: optStr(json.refundsSaleClientId),
    customerId: optInt(json.customerId),
    lines: list(json.lines).map((raw) => {
      const line = asObject(raw);
      const basis = str(line.basis);
      if (!['WAREHOUSE', 'LOOSE', 'RETAIL', 'RETAIL_BULK'].includes(basis)) {
        throw invalid('lines.basis', 'enum', 'a price basis');
      }
      return {
        lineNo: int(line.lineNo),
        productId: int(line.productId),
        productUnitId: int(line.productUnitId),
        qty: dec(line.qty),
        factorSnapshot: dec(line.factorSnapshot),
        basis: basis as SaleDoc['lines'][number]['basis'],
        listPrice: dec(line.listPrice),
        unitPrice: dec(line.unitPrice),
        discountAmount: dec(line.discountAmount),
        subtotal: dec(line.subtotal),
        total: dec(line.total),
        vatRatePct: dec(line.vatRatePct),
        vatAmount: dec(line.vatAmount),
        applied: Array.isArray(line.applied) ? line.applied : [],
        refundsLineNo: optInt(line.refundsLineNo),
        damaged: line.damaged === true,
      };
    }),
    tenders: list(json.tenders).map((raw) => {
      const tender = asObject(raw);
      const tenderKind = str(tender.kind);
      if (tenderKind !== 'CASH' && tenderKind !== 'CARD' && tenderKind !== 'CREDIT') {
        throw invalid('tenders.kind', 'enum', 'CASH, CARD or CREDIT');
      }
      return {
        kind: tenderKind,
        amount: dec(tender.amount),
        tendered:
          tender.tendered === null || tender.tendered === undefined ? null : dec(tender.tendered),
        terminalId: optStr(tender.terminalId),
        rrn: optStr(tender.rrn),
        maskedPan: optStr(tender.maskedPan),
      };
    }),
    subtotal: dec(json.subtotal),
    discountTotal: dec(json.discountTotal),
    total: dec(json.total),
    vatTotal: dec(json.vatTotal),
    note: optStr(json.note),
    snapshotVersion: optStr(json.snapshotVersion),
    ebarimt: json.ebarimt === null || json.ebarimt === undefined ? null : facts(json.ebarimt),
  };
}

function facts(value: unknown): EbarimtFacts {
  const json = asObject(value);
  const status = str(json.status);
  const known = [
    'NONE',
    'PENDING',
    'CONFIRMED',
    'INDETERMINATE',
    'ERROR',
    'CANCELLED',
    'UNCONFIRMED_RETURN',
  ];
  if (!known.includes(status)) throw invalid('ebarimt.status', 'enum', 'a receipt status');
  return {
    status: status as EbarimtFacts['status'],
    ddtd: optStr(json.ddtd),
    posapiDate: optStr(json.posapiDate),
    billIdSuffix: optStr(json.billIdSuffix),
    inactiveId: optStr(json.inactiveId),
  };
}

function asObject(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid('payload', 'object', 'a document');
  }
  return value as Json;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw invalid('payload', 'array', 'a list');
  return value;
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw invalid('payload', 'string', 'a string');
  return value;
}

function optStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid('payload', 'integer', 'an integer');
  }
  return value;
}

function optInt(value: unknown): number | null {
  return value === null || value === undefined ? null : int(value);
}

function dec(value: unknown): Decimal {
  if (typeof value !== 'string' || !/^-?\d{1,13}(\.\d{1,6})?$/.test(value)) {
    throw invalid('payload', 'decimal', 'a decimal string');
  }
  return new Decimal(value);
}

function date(value: unknown): Date {
  const parsed = new Date(str(value));
  if (Number.isNaN(parsed.getTime())) throw invalid('payload', 'date', 'an ISO instant');
  return parsed;
}
