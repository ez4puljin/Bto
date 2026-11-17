import { FIN_PERMISSIONS } from '@tugeel/fin-contract';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './index';

/**
 * The Finance Core's rights that no Bto role grants yet: each phase adds its own to PERMISSIONS and
 * removes it here (P3 config, P5 periods, approvals and the pending list, the control system).
 */
const NOT_GRANTED_YET = [
  'finance.documents.approve',
  'finance.periods.override',
  'finance.intake.replay',
  'finance.config.manage',
  'finance.control.approve',
];

/**
 * Bto's own rights that only share the `finance.` prefix: they guard Bto modules, not the Finance
 * Core, so @tugeel/fin-contract does not list them (docs/modules/finance-core.md §2).
 * `finance.sms.send`: settlement SMS through WeSend, Bto's notifications module (ADR-0216).
 */
const BTO_ONLY = ['finance.sms.send'];

describe('finance rights (docs/modules/finance-core.md §13)', () => {
  it('lists the same strings as @tugeel/fin-contract', () => {
    const bto = PERMISSIONS.filter(
      (code) => code.startsWith('finance.') && !BTO_ONLY.includes(code),
    );
    expect([...bto].sort()).toEqual(
      FIN_PERMISSIONS.filter((code) => !NOT_GRANTED_YET.includes(code)).sort(),
    );
    for (const code of NOT_GRANTED_YET) expect(FIN_PERMISSIONS).toContain(code);
    for (const code of BTO_ONLY) {
      expect(PERMISSIONS).toContain(code);
      expect(FIN_PERMISSIONS).not.toContain(code);
    }
  });
});
