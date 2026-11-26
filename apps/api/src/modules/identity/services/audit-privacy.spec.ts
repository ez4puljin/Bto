import { auditForReader } from './audit-privacy';
import type { AuditRow } from './audit-query.service';

const entry = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 1,
  occurredAt: new Date('2026-11-01T00:00:00Z'),
  actorKind: 'STAFF',
  actorId: 1,
  actorUsername: 'admin',
  actorLabel: null,
  action: 'UPDATE',
  entity: 'hr_position',
  entityId: '7',
  before: null,
  after: null,
  requestId: 'request',
  ...over,
});

describe('generic audit salary privacy', () => {
  it('removes historical position salaries recursively without changing stored evidence', () => {
    const row = entry({
      before: { name: 'Cashier', baseSalary: '1234567.89' },
      after: {
        name: 'Cashier',
        roleIds: [3],
        nextBaseSalary: '2345678.90',
        salaryHistory: [{ baseSalary: '1234567.89' }],
        nested: [{ positionBaseSalary: '1', kept: true }],
      },
    });
    const original = structuredClone(row);
    expect(auditForReader(row, false)).toEqual({
      ...row,
      before: { name: 'Cashier' },
      after: { name: 'Cashier', roleIds: [3], nested: [{ kept: true }] },
    });
    expect(row).toEqual(original);
    expect(auditForReader(row, true)).toBe(row);
  });

  it.each(['payroll_terms', 'payroll_advance', 'payroll_line_adjustment', 'payroll_settings'])(
    'keeps metadata but hides private %s snapshots from an audit-only reader',
    (entity) => {
      const row = entry({ entity, before: { amount: '100.00' }, after: { amount: '200.00' } });
      expect(auditForReader(row, false)).toEqual({ ...row, before: null, after: null });
      expect(auditForReader(row, true)).toBe(row);
    },
  );

  it('preserves ordinary business snapshots', () => {
    const row = entry({ entity: 'products', after: { name: 'Rice', amount: '100.00' } });
    expect(auditForReader(row, false)).toBe(row);
  });
});
