import { describe, expect, it } from 'vitest';
import type { CustomerPrincipal, Me } from '../api/session';
import { phaseOf } from './phase';

const rep = { id: 7, permissions: ['sales.orders.rep'] } as unknown as Me;
const office = { id: 8, permissions: ['sales.orders.read'] } as unknown as Me;
const store = { accountId: 12, store: { customerId: 40 } } as unknown as CustomerPrincipal;

describe('the phases of the two apps', () => {
  it('waits for the stored server and the session', () => {
    expect(phaseOf(undefined, { status: 'loading' })).toBe('boot');
    expect(phaseOf(null, { status: 'anonymous' })).toBe('server');
    expect(phaseOf('http://pc:3300', { status: 'loading' })).toBe('boot');
    expect(phaseOf('http://pc:3300', { status: 'anonymous', reason: 'expired' })).toBe('login');
    expect(phaseOf('http://pc:3300', { status: 'offline' })).toBe('offline');
  });

  it('lets a rep into the staff app, other staff to «not a rep», every store into «Bto300»', () => {
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: rep, userId: 7 })).toBe('app');
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: office, userId: 8 })).toBe('notRep');
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: store, userId: 12 })).toBe('app');
  });
});
