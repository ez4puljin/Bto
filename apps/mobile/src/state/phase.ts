import type { CustomerPrincipal, Me, SessionState } from '../api/session';

/** Which screens the phone may show now (ADR-0061, ADR-0085). */
export type Phase = 'boot' | 'server' | 'login' | 'offline' | 'notRep' | 'app';

/** The rep's right (ADR-0061 #5) and the store seller's (ADR-0116: transfer requests). */
export const REP_RIGHT = 'sales.orders.rep';
export const TRANSFER_RIGHT = 'inventory.transfers.manage';
/** The warehouse keeper's right (ADR-0126 #2): «Бэлтгэл» on the phone (ADR-0132). */
export const PICK_RIGHT = 'sales.orders.pick';
export const PICK_LEAD_RIGHT = 'sales.orders.pickLead';

/** A sales rep: the shop, the cart and the orders are theirs. */
export function isRep(me: Me): boolean {
  return me.permissions.includes(REP_RIGHT);
}

/** A store's seller (ADR-0116 #1): «Шилжүүлэг» is theirs; a rep may hold it too. */
export function mayRequestTransfers(me: Me): boolean {
  return me.permissions.includes(TRANSFER_RIGHT);
}

/** A warehouse keeper (ADR-0132): «Бэлтгэл» is theirs; a rep or a seller may hold it too. */
export function mayPick(me: Me): boolean {
  return me.permissions.includes(PICK_RIGHT);
}

/** The warehouse lead (ADR-0126 #2): sees and confirms every warehouse's part. */
export function isPickLead(me: Me): boolean {
  return me.permissions.includes(PICK_LEAD_RIGHT);
}

/**
 * Every signed-in staff member may use the staff app since «Ирц» (ADR-0131: the attendance is for
 * all staff; a rep, a seller or a picker gets their screens besides it, ADR-0116, ADR-0132); every signed-in store may
 * use «Bto300».
 */
export function mayUseApp(_me: Me | CustomerPrincipal): boolean {
  return true;
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
