import { Decimal } from '@tugeel/shared/money';
import { formatMnt, formatQty } from '@/lib/money';
import {
  type StockCountPartyKind,
  type StockCountSettlement,
  type StockCountSettlementInput,
} from './counts-api';

// What the count's screens share that is not a component (ADR-0176).

/** A difference with its sign: «+2», «-3», «0». */
export const signedQty = (value: string) =>
  value.startsWith('-') || new RegExp('^0(\\.0+)?$').test(value)
    ? formatQty(value)
    : `+${formatQty(value)}`;

export interface SettlementDraft {
  accountCode: string;
  kind: '' | StockCountPartyKind;
  partyId: number | null;
  name: string;
  charged: boolean;
}

export const draftOf = (settlement: StockCountSettlement | null): SettlementDraft => ({
  accountCode: settlement?.accountCode ?? '',
  kind: settlement?.party?.kind ?? '',
  partyId: settlement?.party?.id ?? null,
  name: settlement?.party?.name ?? '',
  charged: settlement?.charged ?? false,
});

export const inputOf = (draft: SettlementDraft): StockCountSettlementInput => ({
  accountCode: draft.accountCode || null,
  party:
    draft.kind === ''
      ? null
      : draft.kind === 'OTHER'
        ? { kind: 'OTHER', name: draft.name.trim() }
        : { kind: draft.kind, id: draft.partyId },
  charged: draft.kind !== '' && draft.charged,
});

/** A chosen kind names its party. */
export const draftValid = (draft: SettlementDraft): boolean =>
  draft.kind === '' || (draft.kind === 'OTHER' ? draft.name.trim() !== '' : draft.partyId !== null);

/** One supplier's block of the count sheet: its products and what they differ by (ADR-0177). */
export interface SheetGroup<Row> {
  supplierId: number | null;
  supplierName: string | null;
  rows: Row[];
  surplusQty: string;
  surplusAmount: string;
  shortageQty: string;
  shortageAmount: string;
  netQty: string;
  netAmount: string;
}

interface SheetRowLike {
  supplierId: number | null;
  supplierName: string | null;
  differenceQty: string | null;
  differenceAmount: string | null;
}

/** Rows already ordered by supplier, cut into one block per supplier with its sums. */
export function groupBySupplier<Row extends SheetRowLike>(rows: readonly Row[]): SheetGroup<Row>[] {
  const groups: SheetGroup<Row>[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (!last || last.supplierId !== row.supplierId) {
      groups.push({
        ...sumsOf([row]),
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        rows: [row],
      });
      continue;
    }
    last.rows.push(row);
    Object.assign(last, sumsOf(last.rows));
  }
  return groups;
}

/** What rows differ by: the surplus, the shortage and the net, in pieces and in money. */
export function sumsOf(rows: readonly SheetRowLike[]) {
  let surplusQty = new Decimal(0);
  let surplusAmount = new Decimal(0);
  let shortageQty = new Decimal(0);
  let shortageAmount = new Decimal(0);
  for (const row of rows) {
    if (row.differenceQty === null) continue;
    const qty = new Decimal(row.differenceQty);
    const amount = new Decimal(row.differenceAmount ?? '0');
    if (qty.gt(0)) {
      surplusQty = surplusQty.plus(qty);
      surplusAmount = surplusAmount.plus(amount);
    } else if (qty.lt(0)) {
      shortageQty = shortageQty.plus(qty);
      shortageAmount = shortageAmount.plus(amount);
    }
  }
  return {
    surplusQty: surplusQty.toFixed(),
    surplusAmount: surplusAmount.toFixed(2),
    shortageQty: shortageQty.toFixed(),
    shortageAmount: shortageAmount.toFixed(2),
    netQty: surplusQty.plus(shortageQty).toFixed(),
    netAmount: surplusAmount.plus(shortageAmount).toFixed(2),
  };
}

/** A money difference with its sign: «+361,200», «-153,920». */
export const signedMnt = (value: string) =>
  value.startsWith('-') || new RegExp('^0(\\.0+)?$').test(value)
    ? formatMnt(value)
    : `+${formatMnt(value)}`;

/** The sheet's query in the print page's address (ADR-0177). */
export function sheetSearch(query: {
  filter: string;
  q?: string;
  supplierId?: number;
  categoryId?: number;
  segmentId?: number;
}): string {
  const params = new URLSearchParams({ filter: query.filter });
  if (query.q) params.set('q', query.q);
  if (query.supplierId) params.set('supplierId', String(query.supplierId));
  if (query.categoryId) params.set('categoryId', String(query.categoryId));
  if (query.segmentId) params.set('segmentId', String(query.segmentId));
  return params.toString();
}
