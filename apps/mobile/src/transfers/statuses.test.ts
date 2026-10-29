import { describe, expect, it } from 'vitest';
import { colors } from '../theme/tokens';
import {
  matchesFilter,
  rankOf,
  serverStatusOf,
  statusesOf,
  statusKey,
  statusTone,
  TRANSFER_STATUSES,
} from './statuses';

describe('transfer statuses (ADR-0116)', () => {
  it('lists them in the order they move, CANCELLED apart', () => {
    expect(TRANSFER_STATUSES).toEqual([
      'DRAFT',
      'REQUESTED',
      'SHIPPED',
      'COUNTED',
      'RECEIVED',
      'CANCELLED',
    ]);
    expect(rankOf('DRAFT')).toBe(0);
    expect(rankOf('RECEIVED')).toBe(4);
    expect(rankOf('SHIPPED')).toBeLessThan(rankOf('COUNTED'));
  });

  it('names the word and the tone of each status by key and token', () => {
    expect(statusKey('SHIPPED')).toBe('inventory.docStatus.SHIPPED');
    expect(statusTone('RECEIVED')).toEqual({
      background: colors.successSoft,
      text: colors.success,
    });
    expect(statusTone('CANCELLED').text).toBe(colors.cancelled);
    for (const status of TRANSFER_STATUSES) {
      expect(statusTone(status).background).toMatch(/^#|^rgba/);
    }
  });

  it('maps the home chips: «Хүлээгдэж буй» is DRAFT and REQUESTED, filtered on the phone', () => {
    expect(statusesOf('ALL')).toBeNull();
    expect(statusesOf('PENDING')).toEqual(['DRAFT', 'REQUESTED']);
    expect(serverStatusOf('PENDING')).toBeNull();
    expect(serverStatusOf('SHIPPED')).toBe('SHIPPED');
    expect(serverStatusOf('ALL')).toBeNull();
    expect(matchesFilter('DRAFT', 'PENDING')).toBe(true);
    expect(matchesFilter('SHIPPED', 'PENDING')).toBe(false);
    expect(matchesFilter('CANCELLED', 'ALL')).toBe(true);
  });
});
