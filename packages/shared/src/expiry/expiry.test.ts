import { describe, expect, it } from 'vitest';
import {
  EXPIRY_QTY_PATTERN,
  EXPIRY_SOON_DAYS,
  EXPIRY_STATUSES,
  EXPIRY_URGENT_DAYS,
  EXPIRY_VIEWS,
  expiryUrgency,
  isExpiryDateInRange,
} from '.';

describe('expiryUrgency', () => {
  it.each([
    [-400, 'EXPIRED'],
    [-1, 'EXPIRED'],
    [0, 'URGENT'],
    [EXPIRY_URGENT_DAYS, 'URGENT'],
    [EXPIRY_URGENT_DAYS + 1, 'SOON'],
    [EXPIRY_SOON_DAYS, 'SOON'],
    [EXPIRY_SOON_DAYS + 1, 'OK'],
    [4000, 'OK'],
  ])('%i days left is %s', (daysLeft, urgency) => {
    expect(expiryUrgency(daysLeft)).toBe(urgency);
  });
});

describe('isExpiryDateInRange', () => {
  const today = '2026-11-07';

  it('takes a date in the past: finding expired goods is the point', () => {
    expect(isExpiryDateInRange('2026-11-06', today)).toBe(true);
    expect(isExpiryDateInRange('2021-11-07', today)).toBe(true);
  });

  it('refuses a date more than 5 years back', () => {
    expect(isExpiryDateInRange('2021-11-06', today)).toBe(false);
  });

  it('takes a date up to 15 years ahead and refuses the next day', () => {
    expect(isExpiryDateInRange('2041-11-07', today)).toBe(true);
    expect(isExpiryDateInRange('2041-11-08', today)).toBe(false);
  });

  it('counts its window from a leap day without slipping', () => {
    expect(isExpiryDateInRange('2019-02-28', '2024-02-29')).toBe(true);
    expect(isExpiryDateInRange('2019-02-27', '2024-02-29')).toBe(false);
  });

  it.each(['2026-02-30', '2026-13-01', '07.11.2026', '', 'tomorrow'])(
    'refuses %j, which is no calendar date',
    (date) => {
      expect(isExpiryDateInRange(date, today)).toBe(false);
    },
  );
});

describe('the lists', () => {
  it('every status except ARCHIVED is also a view of the list', () => {
    for (const status of EXPIRY_STATUSES) {
      expect(EXPIRY_VIEWS).toContain(status);
    }
  });
});

describe('EXPIRY_QTY_PATTERN', () => {
  it.each(['0', '12', '2.5', '0.125', '99999999999.999'])('takes %s', (value) => {
    expect(EXPIRY_QTY_PATTERN.test(value)).toBe(true);
  });

  it.each(['-1', '1.2345', '', '1,5', '1e3', '.5', '100000000000'])('refuses %j', (value) => {
    expect(EXPIRY_QTY_PATTERN.test(value)).toBe(false);
  });
});
