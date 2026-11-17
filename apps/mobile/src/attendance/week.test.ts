import { describe, expect, it } from 'vitest';
import { chipOf, circleRing, monthsOfWeek, ringFill, scheduledMinutes, weekOf } from './week';

const clockOf = (iso: string) => iso.slice(11, 16);

describe('the week', () => {
  it('runs Monday to Sunday around today and may span two months', () => {
    const week = weekOf('2026-11-18');
    expect(week.from).toBe('2026-11-16');
    expect(week.to).toBe('2026-11-22');
    expect(week.dates).toHaveLength(7);
    expect(weekOf('2026-11-22').from).toBe('2026-11-16');
    expect(monthsOfWeek(weekOf('2026-12-02').dates)).toEqual(['2026-11', '2026-12']);
  });
});

describe('the chip of a day', () => {
  const base = { today: '2026-11-18', workdays: '1111100', workEnd: '18:00', clockOf };
  const present = { status: 'PRESENT', firstIn: 'x', lastOut: 'x', openIn: false } as const;
  it('reads the day the server lists', () => {
    expect(
      chipOf({ ...base, date: '2026-11-16', day: { ...present, lastOut: '2026-11-16T18:05' } }),
    ).toBe('OK');
    expect(
      chipOf({ ...base, date: '2026-11-16', day: { ...present, lastOut: '2026-11-16T16:30' } }),
    ).toBe('EARLY');
    expect(chipOf({ ...base, date: '2026-11-16', day: { ...present, status: 'LATE' } })).toBe(
      'LATE',
    );
    expect(
      chipOf({
        ...base,
        date: '2026-11-16',
        day: { ...present, status: 'ABSENT', firstIn: null, lastOut: null },
      }),
    ).toBe('ABSENT');
    expect(chipOf({ ...base, date: '2026-11-21', day: { ...present, status: 'OFF' } })).toBe('OFF');
  });
  it('calls today before the first punch and the days to come a planned workday', () => {
    const none = { ...present, status: 'ABSENT', firstIn: null, lastOut: null } as const;
    expect(chipOf({ ...base, date: '2026-11-18', day: none })).toBe('PLANNED');
    expect(chipOf({ ...base, date: '2026-11-19', day: none })).toBe('PLANNED');
    expect(chipOf({ ...base, date: '2026-11-20', day: undefined })).toBe('PLANNED');
    expect(chipOf({ ...base, date: '2026-11-22', day: undefined })).toBe('OFF');
  });
});

describe('the ring and the circle', () => {
  it('fills worked over scheduled minutes up to one', () => {
    expect(scheduledMinutes('09:00', '18:00')).toBe(540);
    expect(ringFill(270, 540)).toBe(0.5);
    expect(ringFill(900, 540)).toBe(1);
    expect(ringFill(30, 0)).toBe(0);
  });
  it('closes the circle', () => {
    const ring = circleRing(49.634, 100.162, 150);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
