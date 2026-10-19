import { describe, expect, it } from 'vitest';
import { BUSINESS_TZ, businessDate, businessDateIn } from './index';

describe('businessDateIn (ADR-0069 #7)', () => {
  it('dates an instant in the zone it is given', () => {
    const at = new Date('2026-10-17T20:30:00Z');
    expect(businessDateIn('Asia/Ulaanbaatar', at)).toBe('2026-10-18');
    expect(businessDateIn('Europe/London', at)).toBe('2026-10-17');
    expect(businessDateIn('UTC', new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31');
  });

  it('is what businessDate uses for Ulaanbaatar', () => {
    for (const iso of ['2026-10-10T15:59:59Z', '2026-10-10T16:00:00Z', '2027-02-28T16:00:00Z']) {
      expect(businessDate(new Date(iso))).toBe(businessDateIn(BUSINESS_TZ, new Date(iso)));
    }
  });

  it('refuses a zone that does not exist', () => {
    expect(() => businessDateIn('Mars/Olympus', new Date())).toThrow();
  });
});
