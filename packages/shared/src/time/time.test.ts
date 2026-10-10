import { describe, expect, it } from 'vitest';
import {
  addDays,
  BUSINESS_TZ,
  businessDate,
  businessDateTime,
  businessYear,
  isIsoDate,
} from './index';

describe('business dates in Asia/Ulaanbaatar', () => {
  it('uses UTC+8 without daylight saving', () => {
    expect(BUSINESS_TZ).toBe('Asia/Ulaanbaatar');
    // 15:59 UTC is 23:59 in Ulaanbaatar, 16:00 UTC is already the next day.
    expect(businessDate(new Date('2026-10-10T15:59:59Z'))).toBe('2026-10-10');
    expect(businessDate(new Date('2026-10-10T16:00:00Z'))).toBe('2026-10-11');
    expect(businessDate(new Date('2026-07-01T16:00:00Z'))).toBe('2026-07-02');
  });

  it('shows instants as Ulaanbaatar wall-clock time', () => {
    expect(businessDateTime(new Date('2026-10-10T16:30:00Z'))).toBe('2026-10-11 00:30');
  });

  it('rolls the year over at Ulaanbaatar midnight', () => {
    expect(businessYear(new Date('2026-12-31T15:59:59Z'))).toBe('2026');
    expect(businessYear(new Date('2026-12-31T16:00:00Z'))).toBe('2027');
  });

  it('accepts only real ISO calendar dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate('2026-10-10T00:00:00Z')).toBe(false);
  });

  it('moves plain dates by calendar days', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});
