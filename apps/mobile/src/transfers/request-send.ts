import { canonical, type PendingSend, pendingFor } from '../cart/send';
import { userKey } from '../device/keys';
import type { TransferDraft } from './draft';
import type { TransferRequestCreateRequest } from './types';

// The request's send (ADR-0116 #1, on the cart's idempotent send of ADR-0061 #8): the body of
// `POST /transfer-requests`, its canonical form, and the pending send kept before it leaves.

/** The body sent: the lines by product id, so the same draft always gives the same body. */
export function requestBodyOf(draft: TransferDraft): TransferRequestCreateRequest | null {
  if (draft.lines.length === 0) return null;
  const note = draft.note.trim();
  return {
    destWarehouseId: draft.storeId,
    ...(note ? { note } : {}),
    lines: [...draft.lines]
      .sort((a, b) => a.productId - b.productId)
      .map((line) => ({
        productId: line.productId,
        productUnitId: line.productUnitId,
        qty: line.qty,
      })),
  };
}

/** The canonical JSON of a body: two equal drafts give one string, hence one Idempotency-Key. */
export function requestCanonical(body: TransferRequestCreateRequest): string {
  return canonical(body);
}

/** Where the pending send is kept: `bto.transferSend.v1:<server>:<userId>`. */
export function requestSendKey(server: string, userId: number): string {
  return userKey('transferSend', server, userId);
}

/** The pending send for this body (the stored one when it is for the same body and fresh). */
export function requestPendingFor(
  previous: PendingSend | null,
  body: TransferRequestCreateRequest,
  newKey: () => string,
  now: Date,
): PendingSend {
  return pendingFor(previous, body, newKey, now);
}
