import { FIN_PERMISSIONS } from '@tugeel/fin-contract';
import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from './index';

/**
 * The Finance Core's rights that no Bto role grants yet: each phase adds its own to PERMISSIONS and
 * removes it here (P3 config, P5 periods, approvals and the pending list, the control system).
 */
const NOT_GRANTED_YET = [
  'finance.documents.approve',
  'finance.periods.close',
  'finance.periods.reopen',
  'finance.periods.override',
  'finance.intake.replay',
  'finance.config.manage',
  'finance.control.approve',
];

describe('finance rights (docs/modules/finance-core.md §13)', () => {
  it('lists the same strings as @tugeel/fin-contract', () => {
    const bto = PERMISSIONS.filter((code) => code.startsWith('finance.'));
    expect([...bto].sort()).toEqual(
      FIN_PERMISSIONS.filter((code) => !NOT_GRANTED_YET.includes(code)).sort(),
    );
    for (const code of NOT_GRANTED_YET) expect(FIN_PERMISSIONS).toContain(code);
  });
});
