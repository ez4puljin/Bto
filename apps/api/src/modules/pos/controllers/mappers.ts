import type { Decimal } from '@tugeel/shared/money';
import type {
  CashierDto,
  EdgeNodeDto,
  PosSettingsDto,
  RejectionDto,
  SaleDetailDto,
  SaleDto,
  ShiftDto,
  ShortfallDto,
  SyncOutcomeDto,
  TillDto,
  VoidDetailDto,
  VoidDto,
} from '../dto/pos.dto';
import type { SyncOutcome } from '../sale-doc';
import type { Cashier } from '../services/pos-cashiers.service';
import type { EdgeNode } from '../services/pos-edge-nodes.service';
import type {
  RejectionView,
  SaleDetail,
  SaleSummary,
  ShiftSummary,
  ShortfallView,
} from '../services/pos-query.service';
import type { PosSettings } from '../services/pos-settings.service';
import type { Till } from '../services/pos-tills.service';
import type { VoidDetail, VoidSummary } from '../services/pos-voids.service';

/** Money with its two decimals, quantities as entered, instants in ISO 8601. */
export const money = (value: Decimal): string => value.toFixed(2);
export const moneyOrNull = (value: Decimal | null): string | null =>
  value === null ? null : value.toFixed(2);
export const qty = (value: Decimal): string => value.toFixed();
export const iso = (value: Date): string => value.toISOString();
export const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

export const settingsDto = (settings: PosSettings): PosSettingsDto => ({
  ...settings,
  updatedAt: isoOrNull(settings.updatedAt),
});

export const edgeNodeDto = (node: EdgeNode): EdgeNodeDto => ({
  ...node,
  tokenIssuedAt: isoOrNull(node.tokenIssuedAt),
  lastSeenAt: isoOrNull(node.lastSeenAt),
  lastPullAt: isoOrNull(node.lastPullAt),
  lastPushAt: isoOrNull(node.lastPushAt),
  posapiCheckedAt: isoOrNull(node.posapiCheckedAt),
  createdAt: iso(node.createdAt),
  updatedAt: iso(node.updatedAt),
});

export const tillDto = (till: Till): TillDto => ({
  ...till,
  lastSaleAt: isoOrNull(till.lastSaleAt),
  pairingExpiresAt: isoOrNull(till.pairingExpiresAt),
  createdAt: iso(till.createdAt),
  updatedAt: iso(till.updatedAt),
});

export const cashierDto = (cashier: Cashier): CashierDto => ({
  ...cashier,
  pinSetAt: iso(cashier.pinSetAt),
  lockedUntil: isoOrNull(cashier.lockedUntil),
});

export const shiftDto = (shift: ShiftSummary): ShiftDto => ({
  ...shift,
  openedAt: iso(shift.openedAt),
  openingFloat: money(shift.openingFloat),
  closedAt: isoOrNull(shift.closedAt),
  countedCash: moneyOrNull(shift.countedCash),
  floatKept: moneyOrNull(shift.floatKept),
  expectedCash: moneyOrNull(shift.expectedCash),
  variance: moneyOrNull(shift.variance),
  cashSales: money(shift.cashSales),
  cashRefunds: money(shift.cashRefunds),
  cardSales: money(shift.cardSales),
  cardRefunds: money(shift.cardRefunds),
  salesTotal: money(shift.salesTotal),
  returnsTotal: money(shift.returnsTotal),
  salesVat: money(shift.salesVat),
  returnsVat: money(shift.returnsVat),
  handedOverAt: isoOrNull(shift.handedOverAt),
});

export const saleDto = (sale: SaleSummary): SaleDto => ({
  ...sale,
  soldAt: iso(sale.soldAt),
  subtotal: money(sale.subtotal),
  discountTotal: money(sale.discountTotal),
  total: money(sale.total),
  vatTotal: money(sale.vatTotal),
  cashAmount: money(sale.cashAmount),
  cardAmount: money(sale.cardAmount),
  createdAt: iso(sale.createdAt),
});

export const shortfallDto = (shortfall: ShortfallView): ShortfallDto => ({
  ...shortfall,
  qtyBase: qty(shortfall.qtyBase),
  resolvedAt: isoOrNull(shortfall.resolvedAt),
  createdAt: iso(shortfall.createdAt),
});

export const saleDetailDto = (sale: SaleDetail): SaleDetailDto => ({
  ...saleDto(sale),
  consumerNo: sale.consumerNo,
  posapiDate: sale.posapiDate,
  billIdSuffix: sale.billIdSuffix,
  inactiveId: sale.inactiveId,
  snapshotVersion: sale.snapshotVersion,
  note: sale.note,
  lines: sale.lines.map((line) => ({
    ...line,
    qty: qty(line.qty),
    factorSnapshot: qty(line.factorSnapshot),
    qtyBase: qty(line.qtyBase),
    listPrice: money(line.listPrice),
    unitPrice: money(line.unitPrice),
    discountAmount: money(line.discountAmount),
    subtotal: money(line.subtotal),
    total: money(line.total),
    vatRatePct: money(line.vatRatePct),
    vatAmount: money(line.vatAmount),
    returnedBase: qty(line.returnedBase),
  })),
  tenders: sale.tenders.map((tender) => ({
    ...tender,
    amount: money(tender.amount),
    tendered: moneyOrNull(tender.tendered),
  })),
  shortfalls: sale.shortfalls.map(shortfallDto),
  returns: sale.returns.map((entry) => ({
    ...entry,
    soldAt: iso(entry.soldAt),
    total: money(entry.total),
  })),
});

export const rejectionDto = (rejection: RejectionView): RejectionDto => ({
  ...rejection,
  createdAt: iso(rejection.createdAt),
  replayedAt: isoOrNull(rejection.replayedAt),
});

export const outcomeDto = (outcome: SyncOutcome): SyncOutcomeDto => ({ ...outcome });

export const voidDto = (row: VoidSummary): VoidDto => ({
  ...row,
  voidedAt: iso(row.voidedAt),
  total: money(row.total),
});

export const voidDetailDto = (row: VoidDetail): VoidDetailDto => ({
  ...voidDto(row),
  lines: row.lines.map((line) => ({
    ...line,
    qty: qty(line.qty),
    unitPrice: money(line.unitPrice),
    total: money(line.total),
  })),
});
