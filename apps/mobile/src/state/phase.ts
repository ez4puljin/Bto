import type { CustomerPrincipal, Me, SessionState } from '../api/session';

/** Which screens the phone may show now (ADR-0061, ADR-0083). */
export type Phase = 'boot' | 'server' | 'login' | 'offline' | 'notRep' | 'app';

/** A staff member may use the staff app only with the rep's right; every signed-in store may use «Bto300». */
export function mayUseApp(me: Me | CustomerPrincipal): boolean {
  return 'permissions' in me ? me.permissions.includes('sales.orders.rep') : true;
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
