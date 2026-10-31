import { describe, expect, it } from 'vitest';
import { distanceMeters } from '../geo';
import {
  DEFAULT_SCHEDULE,
  hoursAndMinutes,
  isWorkday,
  minutesOf,
  summarizeDay,
  timeOf,
  ubMinutesOf,
  weekdayIndex,
} from './index';

// 2026-10-31 is a Saturday; Ulaanbaatar is UTC+8.
const DAY = '2026-10-31';
const ub = (time: string) => `${DAY}T${time}:00+08:00`;
const schedule = { ...DEFAULT_SCHEDULE, workdays: '1111110' };

describe('the schedule', () => {
  it('reads and writes HH:mm', () => {
    expect(minutesOf('09:00')).toBe(540);
    expect(timeOf(1095)).toBe('18:15');
    expect(ubMinutesOf(ub('09:07'))).toBe(547);
  });

  it('counts weekdays from Monday', () => {
    expect(weekdayIndex('2026-10-26')).toBe(0);
    expect(weekdayIndex(DAY)).toBe(5);
    expect(weekdayIndex('2026-11-01')).toBe(6);
    expect(isWorkday('1111100', DAY)).toBe(false);
    expect(isWorkday('1111110', DAY)).toBe(true);
  });
});

describe('summarizeDay', () => {
  it('is OFF or ABSENT without events', () => {
    expect(summarizeDay('2026-11-01', [], schedule).status).toBe('OFF');
    expect(summarizeDay(DAY, [], schedule)).toMatchObject({
      status: 'ABSENT',
      workedMinutes: 0,
      lateMinutes: 0,
      openIn: false,
    });
  });

  it('pairs each IN with the OUT after it and measures the first IN against the grace', () => {
    const events = [
      { kind: 'IN' as const, at: ub('08:58') },
      { kind: 'OUT' as const, at: ub('12:30') },
      { kind: 'IN' as const, at: ub('13:30') },
      { kind: 'OUT' as const, at: ub('18:05') },
    ];
    expect(summarizeDay(DAY, events, schedule)).toEqual({
      firstIn: ub('08:58'),
      lastOut: ub('18:05'),
      workedMinutes: 212 + 275,
      lateMinutes: 0,
      openIn: false,
      status: 'PRESENT',
    });
  });

  it('is LATE after the grace, by the minutes over it', () => {
    const summary = summarizeDay(
      DAY,
      [{ kind: 'IN', at: ub('09:25') }],
      schedule,
      new Date(ub('10:00')),
    );
    expect(summary.status).toBe('LATE');
    expect(summary.lateMinutes).toBe(15);
    // Still in: the open IN counts up to now on the day itself.
    expect(summary.openIn).toBe(true);
    expect(summary.workedMinutes).toBe(35);
  });

  it('does not count an open IN of an earlier day', () => {
    const summary = summarizeDay(
      DAY,
      [{ kind: 'IN', at: ub('09:00') }],
      schedule,
      new Date('2026-11-02T03:00:00Z'),
    );
    expect(summary).toMatchObject({ openIn: true, workedMinutes: 0, status: 'PRESENT' });
  });

  it('words minutes as hours and minutes', () => {
    expect(hoursAndMinutes(455)).toEqual({ hours: 7, minutes: 35 });
  });
});

describe('distanceMeters', () => {
  it('measures the geofence', () => {
    const site = { lat: '49.634500', lng: '100.162300' };
    expect(distanceMeters(site, site)).toBe(0);
    // About 111 m per 0.001° of latitude.
    expect(distanceMeters(site, { lat: '49.635500', lng: '100.162300' })).toBeGreaterThan(105);
    expect(distanceMeters(site, { lat: '49.635500', lng: '100.162300' })).toBeLessThan(118);
  });
});
