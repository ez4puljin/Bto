import { Decimal } from '@tugeel/shared/money';
import { userKey } from '../device/keys';
import type { TransferRequestChange, TransferRequestDetail } from './types';

// The request a seller is putting together (ADR-0116 #1): one line per product, kept on the phone
// per store until «Илгээх»; an existing DRAFT's lines when the request is edited.

export interface DraftLine {
  productId: number;
  productUnitId: number;
  /** In that unit, a whole count as the keypad types it. */
  qty: string;
}

export interface TransferDraft {
  storeId: number;
  lines: DraftLine[];
  note: string;
}

export function emptyDraft(storeId: number): TransferDraft {
  return { storeId, lines: [], note: '' };
}

/** Where a store's draft is kept: `bto.transferDraft.v1:<server>:<userId>:<storeId>`. */
export function draftKey(server: string, userId: number, storeId: number): string {
  return `${userKey('transferDraft', server, userId)}:${storeId}`;
}

function isLine(value: unknown): value is DraftLine {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as DraftLine).productId === 'number' &&
    typeof (value as DraftLine).productUnitId === 'number' &&
    typeof (value as DraftLine).qty === 'string' &&
    /^\d+(\.\d+)?$/.test((value as DraftLine).qty) &&
    new Decimal((value as DraftLine).qty).gt(0)
  );
}

/** A stored draft, or an empty one when what is stored is not one for this store. */
export function draftFrom(stored: unknown, storeId: number): TransferDraft {
  if (typeof stored !== 'object' || stored === null) return emptyDraft(storeId);
  const value = stored as Partial<TransferDraft>;
  if (value.storeId !== storeId || !Array.isArray(value.lines)) return emptyDraft(storeId);
  return {
    storeId,
    lines: value.lines.filter(isLine),
    note: typeof value.note === 'string' ? value.note : '',
  };
}

/** The line of a product, if it is in the draft. */
export function draftLineOf(draft: TransferDraft, productId: number): DraftLine | undefined {
  return draft.lines.find((line) => line.productId === productId);
}

/**
 * Sets a product's unit and quantity (a new line goes last; an existing one keeps its place); a
 * quantity of 0 removes the line.
 */
export function setDraftLine(
  draft: TransferDraft,
  productId: number,
  productUnitId: number,
  qty: string,
): TransferDraft {
  if (new Decimal(qty || '0').lte(0)) return removeDraftLine(draft, productId);
  const next: DraftLine = { productId, productUnitId, qty: new Decimal(qty).toFixed() };
  const at = draft.lines.findIndex((line) => line.productId === productId);
  return {
    ...draft,
    lines:
      at === -1
        ? [...draft.lines, next]
        : draft.lines.map((line, index) => (index === at ? next : line)),
  };
}

export function removeDraftLine(draft: TransferDraft, productId: number): TransferDraft {
  return { ...draft, lines: draft.lines.filter((line) => line.productId !== productId) };
}

export function setDraftNote(draft: TransferDraft, note: string): TransferDraft {
  return { ...draft, note };
}

/** A server DRAFT's lines as a draft (every group's lines; a cancelled group is not sent). */
export function draftOfDetail(detail: TransferRequestDetail): TransferDraft {
  return {
    storeId: detail.destWarehouseId,
    lines: detail.groups
      .filter((group) => group.status !== 'CANCELLED')
      .flatMap((group) =>
        group.lines.map((line) => ({
          productId: line.productId,
          productUnitId: line.requestUnitId,
          qty: new Decimal(line.requestedQty).toFixed(),
        })),
      ),
    note: detail.note ?? '',
  };
}

/**
 * One cell save of an edited DRAFT (`PUT /transfer-requests/:id/lines`): the value now and the
 * value the screen opened with, so the server can tell a change made by someone else meanwhile.
 */
export function changeOf(
  opened: DraftLine | undefined,
  productId: number,
  productUnitId: number | null,
  qty: string | null,
): TransferRequestChange {
  const removes = qty === null || new Decimal(qty).lte(0);
  return {
    productId,
    productUnitId: removes ? null : productUnitId,
    qty: removes ? null : new Decimal(qty).toFixed(),
    previousUnitId: opened?.productUnitId ?? null,
    previousQty: opened?.qty ?? null,
  };
}
