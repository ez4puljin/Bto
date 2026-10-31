import { Decimal } from '@tugeel/shared/money';
import { useEffect, useState } from 'react';
import { isQty } from '@/features/inventory/helpers';
import { formatQty, plainDecimal } from '@/lib/money';
import type { SalesOrder, SalesOrderLine } from './api';
import { usePickInfo } from './pipelines-api';

/** What a keeper types for a line of their part: the count picked and the shelf it leaves. */
export interface PickDraft {
  qty: string;
  binId: string;
}

type PickInfoLine = NonNullable<ReturnType<typeof usePickInfo>['data']>[number];

export interface PickDrafts {
  /** The shelves are loaded; before that nothing is confirmed. */
  ready: boolean;
  drafts: Record<number, PickDraft>;
  set: (lineId: number, fields: Partial<PickDraft>) => void;
  binsOf: (lineId: number) => PickInfoLine['bins'];
}

/**
 * The counts a keeper is typing, kept by line id while the order refreshes under them (the panel
 * re-reads the order as the other warehouses pick): a line gets its default — the reserved count
 * and the proposed shelf — once, when it first appears, and what was typed is never replaced.
 */
export function usePickDrafts(order: SalesOrder, enabled: boolean): PickDrafts {
  const info = usePickInfo(enabled ? order.id : null);
  const [drafts, setDrafts] = useState<Record<number, PickDraft>>({});
  useEffect(() => {
    const data = info.data;
    if (!data) return;
    setDrafts((current) => {
      let next = current;
      for (const line of order.lines) {
        if (next[line.id]) continue;
        const own = data.find((entry) => entry.lineId === line.id);
        next = {
          ...next,
          [line.id]: {
            qty: plainDecimal(line.qtyApproved),
            binId: String(own?.proposedBinId ?? ''),
          },
        };
      }
      return next;
    });
  }, [info.data, order.lines]);
  return {
    ready: info.data !== undefined,
    drafts,
    set: (lineId, fields) =>
      setDrafts((current) => ({
        ...current,
        [lineId]: {
          qty: current[lineId]?.qty ?? '0',
          binId: current[lineId]?.binId ?? '',
          ...fields,
        },
      })),
    binsOf: (lineId) => info.data?.find((entry) => entry.lineId === lineId)?.bins ?? [],
  };
}

/**
 * The deduction of a line: what the customer ordered less what is (being) picked, as «−n unit»;
 * empty when nothing is short or no count is known yet. The ordered quantity stays on the line;
 * the sale invoices the picked one (ADR-0060 #3).
 */
export function shortOf(line: SalesOrderLine, draftQty?: string): string {
  const picked =
    draftQty !== undefined
      ? isQty(draftQty)
        ? new Decimal(draftQty)
        : null
      : line.qtyPicked === null
        ? null
        : new Decimal(line.qtyPicked);
  if (picked === null) return '';
  const short = new Decimal(line.qtyBase).minus(picked);
  return short.lte(0) ? '' : `−${formatQty(short.toFixed())} ${line.baseUnitName}`;
}
