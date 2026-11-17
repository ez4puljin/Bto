import { Decimal } from '@tugeel/shared/money';
import type { NoteDraftRequest, NoteReading } from './receipt-notes-api';

// What the person does to a reading before it becomes a draft receipt (ADR-0210), kept pure so
// its rules are tested without a screen: which lines go in, as which product unit and quantity.

/** How a line came to its product: by the reading, or chosen by the person here. */
export type ReviewMatch = 'BARCODE' | 'MEMORY' | 'MODEL' | 'PERSON';

export interface ReviewProduct {
  productUnitId: number;
  sku: string;
  name: string;
  units: { unitId: number; name: string; factor: string }[];
}

export interface ReviewLine {
  index: number;
  /** Unticked: the line stays out of the receipt. */
  include: boolean;
  qty: string;
  product: ReviewProduct | null;
  how: ReviewMatch | null;
}

export type ReviewProblem = 'product' | 'qty';

const QTY = /^\d{1,9}(\.\d{1,3})?$/;

/** A typed quantity as the API takes it, or null: a positive number of at most three places. */
export function qtyOf(text: string): string | null {
  const value = text.trim().replace(',', '.');
  return QTY.test(value) && new Decimal(value).greaterThan(0) ? value : null;
}

/** The lines as the reading proposes them: every line in, with what it was matched to. */
export function reviewLinesOf(reading: Pick<NoteReading, 'proposal'>): ReviewLine[] {
  return (reading.proposal?.lines ?? []).map((line) => ({
    index: line.index,
    include: true,
    qty: line.qty ?? '',
    product: line.match
      ? {
          productUnitId: line.match.productUnitId,
          sku: line.match.sku,
          name: line.match.productName,
          units: line.match.units,
        }
      : null,
    how: line.match?.how ?? null,
  }));
}

/** What still keeps a line from being saved; null for one that is ready or left out. */
export function problemOf(line: ReviewLine): ReviewProblem | null {
  if (!line.include) return null;
  if (line.product === null) return 'product';
  return qtyOf(line.qty) === null ? 'qty' : null;
}

/** The body of «Ноорог хадгалах», or null while a line or the supplier is not ready. */
export function draftOf(
  header: { supplierId: number | null; docNo: string; docDate: string },
  lines: readonly ReviewLine[],
): NoteDraftRequest | null {
  const chosen = lines.filter((line) => line.include);
  if (header.supplierId === null || chosen.length === 0) return null;
  if (chosen.some((line) => problemOf(line) !== null)) return null;
  return {
    supplierId: header.supplierId,
    ...(header.docNo.trim() ? { supplierDocNo: header.docNo.trim() } : {}),
    ...(header.docDate ? { supplierDocDate: header.docDate } : {}),
    lines: chosen.flatMap((line) => {
      const enteredQty = qtyOf(line.qty);
      return line.product && enteredQty
        ? [{ index: line.index, productUnitId: line.product.productUnitId, enteredQty }]
        : [];
    }),
  };
}

/**
 * The amounts of the lines going in, for the comparison with the note's printed total: null when
 * the reader may not see prices or no line carries one.
 */
export function amountOf(
  reading: Pick<NoteReading, 'proposal'>,
  lines: readonly ReviewLine[],
): string | null {
  const read = reading.proposal?.lines ?? [];
  let sum = new Decimal(0);
  let any = false;
  for (const line of lines) {
    const amount = line.include ? read[line.index]?.amount : null;
    if (amount === null || amount === undefined) continue;
    sum = sum.plus(amount);
    any = true;
  }
  return any ? sum.toFixed(2) : null;
}

/** Whether the lines add up to the note's printed total, within a tugrik; null when unknown. */
export function totalAgrees(sum: string | null, printed: string | null): boolean | null {
  if (sum === null || printed === null) return null;
  return new Decimal(sum).minus(printed).abs().lessThanOrEqualTo(1);
}

const FAILURE_REASONS = [
  'TIMEOUT',
  'NETWORK',
  'HTTP',
  'REFUSED',
  'INCOMPLETE',
  'INVALID_RESPONSE',
  'UNREADABLE_PAGE',
  'AI_BUDGET_REACHED',
  'AI_USER_LIMIT_REACHED',
] as const;
type FailureReason = (typeof FAILURE_REASONS)[number] | 'KEY' | 'OTHER';

/**
 * The key of the message for a failed reading: the reason's own, «the key is not accepted» for a
 * provider that answered 401 or 403, the general one for the unknown.
 */
export function failureKeyOf(
  failure: { reason: string; status: number | null } | null | undefined,
): `inventory.noteReading.failure.${FailureReason}` {
  if (failure?.reason === 'HTTP' && (failure.status === 401 || failure.status === 403)) {
    return 'inventory.noteReading.failure.KEY';
  }
  const known = FAILURE_REASONS.find((entry) => entry === failure?.reason);
  return `inventory.noteReading.failure.${known ?? 'OTHER'}`;
}

const SCAN_REASONS = [
  'TIMEOUT',
  'NETWORK',
  'HTTP',
  'NOT_A_SCANNER',
  'BUSY',
  'NO_PAPER',
  'NO_SOURCE',
  'INVALID_RESPONSE',
] as const;
type ScanReason = (typeof SCAN_REASONS)[number] | 'OTHER';

/** The key of the message for a scanner's refusal; the general one for the unknown. */
export function scanFailureKeyOf(
  reason: unknown,
): `inventory.noteReading.scanFailure.${ScanReason}` {
  const known = SCAN_REASONS.find((entry) => entry === reason);
  return `inventory.noteReading.scanFailure.${known ?? 'OTHER'}`;
}
