import { Decimal } from '@tugeel/shared/money';
import type { TransferLine, TransferRequestGroup } from './types';

// Receiving by scan (ADR-0116 #4, #5): the states of a shipped line, the line a barcode lands on,
// and the count queue that sends each count to the server one at a time.

/**
 * A line's state after the count: not yet counted, nothing arrived («ирээгүй»), short of or over
 * what was shipped (with the difference in base units), exact, or a product the store added that
 * was not asked for.
 */
export type LineState =
  | { kind: 'unchecked' }
  | { kind: 'notArrived' }
  | { kind: 'short'; diffBase: string }
  | { kind: 'over'; diffBase: string }
  | { kind: 'exact' }
  | { kind: 'extra' };

export function lineState(
  line: Pick<TransferLine, 'countedQtyBase' | 'shippedQtyBase' | 'unrequested'>,
): LineState {
  if (line.unrequested) return { kind: 'extra' };
  if (line.countedQtyBase === null) return { kind: 'unchecked' };
  const counted = new Decimal(line.countedQtyBase);
  if (counted.lte(0)) return { kind: 'notArrived' };
  const shipped = new Decimal(line.shippedQtyBase ?? '0');
  const diff = counted.minus(shipped);
  if (diff.lt(0)) return { kind: 'short', diffBase: diff.abs().toFixed() };
  if (diff.gt(0)) return { kind: 'over', diffBase: diff.toFixed() };
  return { kind: 'exact' };
}

/** The groups the store counts now: shipped, not yet finished. */
export function shippedGroups<G extends Pick<TransferRequestGroup, 'status'>>(
  groups: readonly G[],
): G[] {
  return groups.filter((group) => group.status === 'SHIPPED');
}

/**
 * The line a scanned product lands on, searched across the shipped groups (any of the product's
 * barcodes resolves to the same product id); null when the product is not on the request.
 */
export function findLineByProduct<
  G extends Pick<TransferRequestGroup, 'id' | 'status'> & {
    lines: readonly Pick<TransferLine, 'id' | 'productId'>[];
  },
>(groups: readonly G[], productId: number): { group: G; line: G['lines'][number] } | null {
  for (const group of shippedGroups(groups)) {
    const line = group.lines.find((entry) => entry.productId === productId);
    if (line) return { group, line };
  }
  return null;
}

/** One count on its way to the server: `PUT /transfers/:groupId/counts` with one entry. */
export interface CountEntry {
  groupId: number;
  lineId: number;
  productUnitId: number;
  /** In that unit; "0" = nothing arrived. */
  qty: string;
}

/**
 * The queue is sent in order, the head first; a count typed again for a line whose earlier count
 * has not left replaces it in place (the server keeps the last write anyway).
 */
export function enqueueCount(queue: readonly CountEntry[], entry: CountEntry): CountEntry[] {
  const at = queue.findIndex((item) => item.lineId === entry.lineId);
  if (at === -1) return [...queue, entry];
  return queue.map((item, index) => (index === at ? entry : item));
}

/** The head left (sent, or dropped because the group moved on). */
export function dropHead(queue: readonly CountEntry[]): CountEntry[] {
  return queue.slice(1);
}

/** The server answers that the group moved on (confirmed, cancelled): the count is dropped. */
export const DROPPED_CODES = ['DOC_STATE_INVALID', 'DOC_ALREADY_POSTED'] as const;

export function dropsCount(status: number, code: string): boolean {
  return status === 409 && (DROPPED_CODES as readonly string[]).includes(code);
}

/** The counts of a queue by line, for the rows to show what is typed but not yet sent. */
export function queuedByLine(queue: readonly CountEntry[]): Map<number, CountEntry> {
  return new Map(queue.map((entry) => [entry.lineId, entry]));
}

/**
 * Whether a group's «тоолж дуусгах» may be pressed: nothing of it unsent, and every line counted;
 * `unchecked` counts the lines still without a count.
 */
export function finishReadiness(
  group: Pick<TransferRequestGroup, 'id'> & {
    lines: readonly Pick<TransferLine, 'id' | 'countedQtyBase' | 'unrequested'>[];
  },
  queue: readonly CountEntry[],
): { ready: boolean; unchecked: number; unsent: number } {
  const unsent = queue.filter((entry) => entry.groupId === group.id).length;
  const unchecked = group.lines.filter(
    (line) => line.countedQtyBase === null && !line.unrequested,
  ).length;
  return { ready: unsent === 0 && unchecked === 0, unchecked, unsent };
}
