import type { CustomerPrincipal, Me, SessionState } from '../api/session';

/** Which screens the phone may show now (ADR-0061, ADR-0085). */
export type Phase = 'boot' | 'server' | 'login' | 'offline' | 'notRep' | 'app';

/** The rep's right (ADR-0061 #5) and the store seller's (ADR-0116: transfer requests). */
export const REP_RIGHT = 'sales.orders.rep';
export const TRANSFER_RIGHT = 'inventory.transfers.manage';

/** A sales rep: the shop, the cart and the orders are theirs. */
export function isRep(me: Me): boolean {
  return me.permissions.includes(REP_RIGHT);
}

/** A store's seller (ADR-0116 #1): «Шилжүүлэг» is theirs; a rep may hold it too. */
export function mayRequestTransfers(me: Me): boolean {
  return me.permissions.includes(TRANSFER_RIGHT);
}

/**
 * A staff member may use the staff app with the rep's right or the transfer right (ADR-0116);
 * every signed-in store may use «Bto300».
 */
export function mayUseApp(me: Me | CustomerPrincipal): boolean {
  return 'permissions' in me ? isRep(me) || mayRequestTransfers(me) : true;
}

/** The server, the sign-in, the offline page, «not a rep» (staff only) or the app itself. */
export function phaseOf(
  server: string | null | undefined,
  state: SessionState<Me | CustomerPrincipal>,
): Phase {
  if (server === undefined) return 'boot';
  if (server === null) return 'server';
  switch (state.status) {
    case 'loading':
      return 'boot';
    case 'anonymous':
      return 'login';
    case 'offline':
      return 'offline';
    case 'signedIn':
      return mayUseApp(state.me) ? 'app' : 'notRep';
  }
}
