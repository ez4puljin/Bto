import { describe, expect, it } from 'vitest';
import { noticeState, noticeTextLength } from './index';

describe('noticeState', () => {
  const notice = { validFrom: '2026-10-16', validTo: '2026-10-20', withdrawn: false };

  it('runs from its first day to the day before its end', () => {
    expect(noticeState(notice, '2026-10-15')).toBe('SCHEDULED');
    expect(noticeState(notice, '2026-10-16')).toBe('RUNNING');
    expect(noticeState(notice, '2026-10-19')).toBe('RUNNING');
    expect(noticeState(notice, '2026-10-20')).toBe('ENDED');
    expect(noticeState({ ...notice, validTo: null }, '2030-01-01')).toBe('RUNNING');
  });

  it('is withdrawn whatever the day', () => {
    expect(noticeState({ ...notice, withdrawn: true }, '2026-10-15')).toBe('WITHDRAWN');
    expect(noticeState({ ...notice, withdrawn: true }, '2026-10-17')).toBe('WITHDRAWN');
  });
});

describe('noticeTextLength', () => {
  it('counts code points after trimming, as PostgreSQL length() does', () => {
    expect(noticeTextLength('  Урамшуулал  ')).toBe(10);
    expect(noticeTextLength('\nШинэ бараа\n')).toBe(10);
    expect(noticeTextLength('🎉 Хямдрал')).toBe(9);
  });
});
