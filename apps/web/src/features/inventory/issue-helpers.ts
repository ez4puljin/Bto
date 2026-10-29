import type { IssueDetail } from './api';

/** A «Хүнд тооцох» issue: its lines are priced at the sale price and charged to the party. */
export const isDamageCharge = (detail: IssueDetail | null) =>
  detail?.expenseTypeCode === 'DAMAGE_CHARGE';

/** Whether the API sent the costs (only to holders of inventory.costs.manage). */
export const hasCosts = (detail: IssueDetail | null) =>
  detail !== null &&
  (detail.total !== undefined || detail.lines.some((line) => line.unitCost !== undefined));

/** The warehouses whose part left: their lines are frozen (ADR-0117 #1). */
export function postedWarehouses(detail: IssueDetail | null): ReadonlySet<number> {
  return new Set(
    (detail?.confirmations ?? []).filter((row) => !row.unchanged).map((row) => row.warehouseId),
  );
}
