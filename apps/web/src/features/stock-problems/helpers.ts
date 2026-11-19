import { businessDate } from '@tugeel/shared/time';
import { monthStart } from '@/features/reports/report-helpers';

/** A decimal string that is not zero. */
export const hasQty = (value: string | null | undefined): boolean =>
  value !== null && value !== undefined && /[1-9]/.test(value);

/** The stock balance report of the product in the warehouse, this month up to today. */
export const balanceReportHref = (productId: number, warehouseId: number, label: string): string =>
  `/reports/stock-balance?${new URLSearchParams({
    pr: String(productId),
    prn: label,
    w: String(warehouseId),
    from: monthStart(),
    to: businessDate(),
  }).toString()}`;

export const SHEETS_ROOT = '/inventory/stock-problems';
export const sheetPath = (id: number): string => `${SHEETS_ROOT}/sheets/${id}`;
export const sheetPrintPath = (id: number): string => `${sheetPath(id)}/print`;
