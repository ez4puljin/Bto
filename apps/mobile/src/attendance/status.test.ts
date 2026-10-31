import { describe, expect, it } from 'vitest';
import { blockerOf, isWorkdayFlag, liveWorkedMinutes, nearestSite, nextKind } from './status';

const orgil = { id: 1, name: 'Оргил', lat: '49.634000', lng: '100.162000', radiusM: 150 };
const shop = { id: 2, name: 'Супермаркет', lat: '49.640000', lng: '100.170000', radiusM: 100 };
const atOrgil = { lat: 49.6341, lng: 100.1621, accuracyM: 12 };

describe('the next punch', () => {
  it('is IN before the first punch and after an OUT, OUT while in', () => {
    expect(nextKind(null)).toBe('IN');
    expect(nextKind('OUT')).toBe('IN');
    expect(nextKind('IN')).toBe('OUT');
  });
});

describe('the nearest site', () => {
  it('picks the closest site and tells whether the fix lies inside its radius', () => {
    const near = nearestSite(atOrgil, [shop, orgil]);
    expect(near?.site.id).toBe(1);
    expect(near?.distanceM).toBeLessThan(20);
    expect(near?.inside).toBe(true);
    const far = nearestSite({ lat: 49.65, lng: 100.2, accuracyM: 10 }, [shop, orgil]);
    expect(far?.site.id).toBe(2);
    expect(far?.inside).toBe(false);
  });

  it('is null without sites', () => {
    expect(nearestSite(atOrgil, [])).toBeNull();
  });
});

describe('the button rule', () => {
  it('needs a site, a fix, a fix within 200 m and a place inside the radius', () => {
    expect(blockerOf(atOrgil, [])).toBe('NO_SITE');
    expect(blockerOf(null, [orgil])).toBe('NO_FIX');
    expect(blockerOf({ ...atOrgil, accuracyM: 201 }, [orgil])).toBe('IMPRECISE');
    expect(blockerOf({ ...atOrgil, accuracyM: 200 }, [orgil])).toBeNull();
    expect(blockerOf({ lat: 49.65, lng: 100.2, accuracyM: 10 }, [orgil])).toBe('OUT_OF_RANGE');
    expect(blockerOf(atOrgil, [orgil])).toBeNull();
  });

  it('lets a fix without an accuracy through (the server decides)', () => {
    expect(blockerOf({ ...atOrgil, accuracyM: null }, [orgil])).toBeNull();
  });
});

describe('the live worked minutes', () => {
  const now = '2026-10-31T04:00:00.000Z';
  it('grows with the clock only while in', () => {
    const later = Date.parse(now) + 7 * 60_000 + 59_000;
    expect(liveWorkedMinutes(100, 'IN', now, later)).toBe(107);
    expect(liveWorkedMinutes(100, 'OUT', now, later)).toBe(100);
    expect(liveWorkedMinutes(0, null, now, later)).toBe(0);
  });

  it('never counts backwards', () => {
    expect(liveWorkedMinutes(100, 'IN', now, Date.parse(now) - 60_000)).toBe(100);
  });
});

describe('workdays and the month', () => {
  it('reads Monday-first flags with the date', () => {
    // 2026-10-31 is a Saturday, 2026-11-01 a Sunday.
    expect(isWorkdayFlag('1111110', '2026-10-31')).toBe(true);
    expect(isWorkdayFlag('1111110', '2026-11-01')).toBe(false);
    expect(isWorkdayFlag('1111100', '2026-10-31')).toBe(false);
  });
});
