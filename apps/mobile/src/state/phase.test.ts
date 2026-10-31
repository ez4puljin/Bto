import { describe, expect, it } from 'vitest';
import type { CustomerPrincipal, Me } from '../api/session';
import { isRep, mayPick, mayRequestTransfers, mayUseApp, phaseOf } from './phase';

const rep = { id: 7, permissions: ['sales.orders.rep'] } as unknown as Me;
const office = { id: 8, permissions: ['sales.orders.read'] } as unknown as Me;
const seller = { id: 9, permissions: ['inventory.transfers.manage'] } as unknown as Me;
const both = {
  id: 10,
  permissions: ['sales.orders.rep', 'inventory.transfers.manage'],
} as unknown as Me;
const keeper = { id: 11, permissions: ['sales.orders.read', 'sales.orders.pick'] } as unknown as Me;
const store = { accountId: 12, store: { customerId: 40 } } as unknown as CustomerPrincipal;

describe('the phases of the two apps', () => {
  it('waits for the stored server and the session', () => {
    expect(phaseOf(undefined, { status: 'loading' })).toBe('boot');
    expect(phaseOf(null, { status: 'anonymous' })).toBe('server');
    expect(phaseOf('http://pc:3300', { status: 'loading' })).toBe('boot');
    expect(phaseOf('http://pc:3300', { status: 'anonymous', reason: 'expired' })).toBe('login');
    expect(phaseOf('http://pc:3300', { status: 'offline' })).toBe('offline');
  });

  it('lets every staff member into the staff app (ADR-0131: «Ирц» is for all), every store into «Bto300»', () => {
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: rep, userId: 7 })).toBe('app');
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: office, userId: 8 })).toBe('app');
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: store, userId: 12 })).toBe('app');
    expect(mayUseApp(office)).toBe(true);
  });

  it('tells a store seller with only the transfer right (ADR-0116) from an office user', () => {
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: seller, userId: 9 })).toBe('app');
    expect(isRep(seller)).toBe(false);
    expect(mayRequestTransfers(seller)).toBe(true);
    expect(isRep(office)).toBe(false);
    expect(mayRequestTransfers(office)).toBe(false);
  });

  it('lets a warehouse keeper with the picking right in (ADR-0132)', () => {
    expect(phaseOf('http://pc:3300', { status: 'signedIn', me: keeper, userId: 11 })).toBe('app');
    expect(mayPick(keeper)).toBe(true);
    expect(isRep(keeper)).toBe(false);
    expect(mayRequestTransfers(keeper)).toBe(false);
    expect(mayPick(office)).toBe(false);
  });

  it('tells a rep who also requests transfers from one who does not', () => {
    expect(isRep(both)).toBe(true);
    expect(mayRequestTransfers(both)).toBe(true);
    expect(isRep(rep)).toBe(true);
    expect(mayRequestTransfers(rep)).toBe(false);
  });
});
