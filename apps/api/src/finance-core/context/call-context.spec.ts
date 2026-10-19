import { FinError } from '../errors';
import { assertFinCallContext, createFinCallContext, principalLabel } from './call-context';

const actor = { kind: 'SOURCE' as const, ref: 'test:PMS', label: 'PMS' };

describe('FinCallContext (ADR-0076 #2)', () => {
  it('is issued frozen, with only finance rights per company', () => {
    const ctx = createFinCallContext({
      principal: { kind: 'USER', tenant: 'T1', ref: 'u-1' },
      permissions: { CO: ['finance.read', 'sales.orders.create', 'finance.settings.manage'] },
      actor: { kind: 'STAFF', ref: 'u-1', label: 'Нягтлан' },
    });
    expect(() => assertFinCallContext(ctx)).not.toThrow();
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.principal)).toBe(true);
    expect([...(ctx.permissions.get('CO') ?? [])].sort()).toEqual([
      'finance.read',
      'finance.settings.manage',
    ]);
    expect(ctx.requestId).toBeNull();
    expect(principalLabel(ctx.principal)).toBe('USER:u-1');
  });

  it('refuses a forged object and a spread copy of a real one', () => {
    const real = createFinCallContext({
      principal: { kind: 'SOURCE', tenant: 'T1', system: 'PMS' },
      actor,
    });
    expect(principalLabel(real.principal)).toBe('SOURCE:PMS');
    expect(() => assertFinCallContext({ ...real })).toThrow(/createFinCallContext/);
    expect(() =>
      assertFinCallContext({
        principal: { kind: 'SOURCE', tenant: 'T1', system: 'PMS' },
        permissions: new Map(),
        actor,
        requestId: null,
      }),
    ).toThrow(/createFinCallContext/);
    expect(() => assertFinCallContext(null)).toThrow(/createFinCallContext/);
  });

  it.each([
    ['principal.tenant', { kind: 'SOURCE' as const, tenant: 'bad tenant', system: 'PMS' }],
    ['principal.system', { kind: 'SOURCE' as const, tenant: 'T1', system: '' }],
    ['principal.ref', { kind: 'USER' as const, tenant: 'T1', ref: '-x' }],
  ])('refuses a principal whose %s is not a code', (path, principal) => {
    let caught: unknown;
    try {
      createFinCallContext({ principal, actor });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FinError);
    expect((caught as FinError).code).toBe('FIN_PAYLOAD_INVALID');
    expect((caught as FinError).params).toEqual({ path });
  });

  it('refuses an actor outside the contract', () => {
    expect(() =>
      createFinCallContext({
        principal: { kind: 'SOURCE', tenant: 'T1', system: 'PMS' },
        actor: { ...actor, kind: 'ROBOT' as never },
      }),
    ).toThrow(FinError);
  });
});
