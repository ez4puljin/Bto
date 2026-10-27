import { Decimal } from '@tugeel/shared/money';
import { invalid } from '../../../common/errors/app-error';
import type {
  EbarimtFactsDto,
  ReceiptStatusDocDto,
  SaleDocDto,
  ShiftCloseDocDto,
  ShiftOpenDocDto,
  SyncEventDto,
  TillBoundDocDto,
  VoidDocDto,
} from '../dto/pos.dto';
import type {
  EbarimtFacts,
  ReceiptStatusDoc,
  SaleDoc,
  ShiftCloseDoc,
  ShiftOpenDoc,
  SyncEvent,
  TillBoundDoc,
  VoidDoc,
} from '../sale-doc';

/** The validated bodies as the services take them: money and quantities as `Decimal`. */

const dec = (value: string) => new Decimal(value);
const decOrNull = (value: string | null | undefined) =>
  value === null || value === undefined ? null : new Decimal(value);
const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

export function toEbarimtFacts(dto: EbarimtFactsDto): EbarimtFacts {
  return {
    status: dto.status,
    ddtd: orNull(dto.ddtd),
    posapiDate: orNull(dto.posapiDate),
    billIdSuffix: orNull(dto.billIdSuffix),
    inactiveId: orNull(dto.inactiveId),
  };
}

export function toSaleDoc(dto: SaleDocDto): SaleDoc {
  return {
    clientId: dto.clientId,
    kind: dto.kind,
    tillCode: dto.tillCode,
    shiftClientId: dto.shiftClientId,
    cashierUserId: dto.cashierUserId,
    approvedByUserId: orNull(dto.approvedByUserId),
    number: dto.number,
    soldAt: new Date(dto.soldAt),
    receiptType: dto.receiptType ?? 'B2C',
    customerTin: orNull(dto.customerTin),
    customerName: orNull(dto.customerName),
    consumerNo: orNull(dto.consumerNo),
    refundsSaleClientId: orNull(dto.refundsSaleClientId),
    customerId: orNull(dto.customerId),
    lines: dto.lines.map((line) => ({
      lineNo: line.lineNo,
      productId: line.productId,
      productUnitId: line.productUnitId,
      qty: dec(line.qty),
      factorSnapshot: dec(line.factorSnapshot),
      basis: line.basis,
      listPrice: dec(line.listPrice),
      unitPrice: dec(line.unitPrice),
      discountAmount: dec(line.discountAmount),
      subtotal: dec(line.subtotal),
      total: dec(line.total),
      vatRatePct: dec(line.vatRatePct),
      vatAmount: dec(line.vatAmount),
      applied: line.applied ?? [],
      refundsLineNo: orNull(line.refundsLineNo),
      damaged: line.damaged ?? false,
    })),
    tenders: dto.tenders.map((tender) => ({
      kind: tender.kind,
      amount: dec(tender.amount),
      tendered: decOrNull(tender.tendered),
      terminalId: orNull(tender.terminalId),
      rrn: orNull(tender.rrn),
      maskedPan: orNull(tender.maskedPan),
      voucherCode: orNull(tender.voucherCode),
    })),
    vouchers: (dto.vouchers ?? []).map((voucher) => ({
      voucherId: voucher.voucherId,
      code: voucher.code,
      kind: voucher.kind,
      face: dec(voucher.face),
      amount: dec(voucher.amount),
    })),
    subtotal: dec(dto.subtotal),
    discountTotal: dec(dto.discountTotal),
    total: dec(dto.total),
    vatTotal: dec(dto.vatTotal),
    note: orNull(dto.note),
    snapshotVersion: orNull(dto.snapshotVersion),
    ebarimt: dto.ebarimt ? toEbarimtFacts(dto.ebarimt) : null,
  };
}

export function toShiftOpenDoc(dto: ShiftOpenDocDto): ShiftOpenDoc {
  return {
    clientId: dto.clientId,
    tillCode: dto.tillCode,
    cashierUserId: dto.cashierUserId,
    number: dto.number,
    openedAt: new Date(dto.openedAt),
    openingFloat: dec(dto.openingFloat),
  };
}

export function toShiftCloseDoc(dto: ShiftCloseDocDto): ShiftCloseDoc {
  return {
    clientId: dto.clientId,
    closedAt: new Date(dto.closedAt),
    countedCash: dec(dto.countedCash),
    floatKept: dec(dto.floatKept),
    note: orNull(dto.note),
  };
}

export function toReceiptStatusDoc(dto: ReceiptStatusDocDto): ReceiptStatusDoc {
  return { saleClientId: dto.saleClientId, ebarimt: toEbarimtFacts(dto.ebarimt) };
}

export function toTillBoundDoc(dto: TillBoundDocDto): TillBoundDoc {
  return {
    tillCode: dto.tillCode,
    deviceTokenHash: dto.deviceTokenHash,
    userAgent: orNull(dto.userAgent),
    boundByUserId: orNull(dto.boundByUserId),
    boundAt: new Date(dto.boundAt),
  };
}

export function toVoidDoc(dto: VoidDocDto): VoidDoc {
  return {
    clientId: dto.clientId,
    tillCode: dto.tillCode,
    shiftClientId: orNull(dto.shiftClientId),
    cashierUserId: dto.cashierUserId,
    approvedByUserId: orNull(dto.approvedByUserId),
    voidedAt: new Date(dto.voidedAt),
    reason: dto.reason,
    lines: dto.lines.map((line) => ({
      productId: line.productId,
      productUnitId: line.productUnitId,
      qty: dec(line.qty),
      unitPrice: dec(line.unitPrice),
      total: dec(line.total),
    })),
    total: dec(dto.total),
  };
}

/** The body that matches `kind` must be present and be the only one; its ids must agree. */
export function toSyncEvent(dto: SyncEventDto, index: number): SyncEvent {
  const path = `events[${index}]`;
  const need = <T>(value: T | undefined, field: string): T => {
    if (value === undefined)
      throw invalid(`${path}.${field}`, 'required', `needed for ${dto.kind}`);
    return value;
  };
  switch (dto.kind) {
    case 'SALE':
    case 'RETURN': {
      const sale = toSaleDoc(need(dto.sale, 'sale'));
      if (sale.kind !== dto.kind) throw invalid(`${path}.sale.kind`, 'kind', 'matches the event');
      if (sale.clientId !== dto.clientId) {
        throw invalid(`${path}.sale.clientId`, 'clientId', 'matches the event');
      }
      return { kind: dto.kind, clientId: dto.clientId, payload: sale };
    }
    case 'SHIFT_OPENED': {
      const doc = toShiftOpenDoc(need(dto.shiftOpened, 'shiftOpened'));
      if (doc.clientId !== dto.clientId) {
        throw invalid(`${path}.shiftOpened.clientId`, 'clientId', 'matches the event');
      }
      return { kind: dto.kind, clientId: dto.clientId, payload: doc };
    }
    case 'SHIFT_CLOSED':
      return {
        kind: dto.kind,
        clientId: dto.clientId,
        payload: toShiftCloseDoc(need(dto.shiftClosed, 'shiftClosed')),
      };
    case 'RECEIPT_STATUS':
      return {
        kind: dto.kind,
        clientId: dto.clientId,
        payload: toReceiptStatusDoc(need(dto.receiptStatus, 'receiptStatus')),
      };
    case 'TILL_BOUND':
      return {
        kind: dto.kind,
        clientId: dto.clientId,
        payload: toTillBoundDoc(need(dto.tillBound, 'tillBound')),
      };
    case 'VOID': {
      const doc = toVoidDoc(need(dto.voided, 'voided'));
      if (doc.clientId !== dto.clientId) {
        throw invalid(`${path}.voided.clientId`, 'clientId', 'matches the event');
      }
      return { kind: dto.kind, clientId: dto.clientId, payload: doc };
    }
  }
}
