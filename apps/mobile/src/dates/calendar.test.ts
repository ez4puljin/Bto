import { describe, expect, it } from 'vitest';
import {
  dayNameOf,
  daysBetween,
  daysInMonth,
  monthDay,
  monthGrid,
  pickDay,
  presetOf,
  presetRange,
} from './calendar';

describe('the calendar', () => {
  it('lays a month out Monday first', () => {
    // 2026-10-01 is a Thursday: three blanks (Mo, Tu, We).
    const october = monthGrid('2026-10');
    expect(october.filter((cell) => cell.kind === 'blank')).toHaveLength(3);
    expect(october.filter((cell) => cell.kind === 'day')).toHaveLength(31);
    // 2026-06-01 is a Monday: none.
    expect(monthGrid('2026-06')[0]).toMatchObject({ kind: 'day', date: '2026-06-01' });
    // 2026-11-01 is a Sunday: six.
    expect(monthGrid('2026-11').filter((cell) => cell.kind === 'blank')).toHaveLength(6);
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
  });

  it('counts days with both ends and names them', () => {
    expect(daysBetween('2026-10-01', '2026-10-16')).toBe(16);
    expect(daysBetween('2026-10-16', '2026-10-16')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(2);
    expect(monthDay('2026-10-07')).toBe('10/07');
    expect(dayNameOf('2026-10-16', '2026-10-16')).toBe('today');
    expect(dayNameOf('2026-10-15', '2026-10-16')).toBe('yesterday');
    expect(dayNameOf('2026-10-17', '2026-10-16')).toBe('tomorrow');
    expect(dayNameOf('2026-10-03', '2026-10-16')).toBe('date');
  });

  it('gives the presets of a day and finds a range among them', () => {
    const today = '2026-10-16';
    expect(presetRange('today', today)).toEqual({ from: today, to: today });
    expect(presetRange('yesterday', today)).toEqual({ from: '2026-10-15', to: '2026-10-15' });
    expect(presetRange('week', today)).toEqual({ from: '2026-10-10', to: today });
    expect(presetRange('twoWeeks', today)).toEqual({ from: '2026-10-03', to: today });
    expect(presetRange('month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetOf({ from: '2026-10-10', to: today }, today)).toBe('week');
    expect(presetOf({ from: '2026-10-11', to: today }, today)).toBeNull();
  });

  it('picks a range as the design does', () => {
    const range = { from: '2026-10-01', to: '2026-10-16' };
    expect(pickDay(range, 'start', '2026-10-05')).toEqual({
      range: { from: '2026-10-05', to: '2026-10-16' },
      picking: 'end',
    });
    expect(pickDay(range, 'start', '2026-10-20').range).toEqual({
      from: '2026-10-20',
      to: '2026-10-20',
    });
    expect(pickDay({ from: '2026-10-05', to: '2026-10-16' }, 'end', '2026-10-02')).toEqual({
      range: { from: '2026-10-02', to: '2026-10-05' },
      picking: 'start',
    });
    expect(pickDay(range, 'end', '2026-10-09')).toEqual({
      range: { from: '2026-10-01', to: '2026-10-09' },
      picking: 'start',
    });
    // Never more than 366 days.
    const long = pickDay({ from: '2026-10-01', to: '2026-10-01' }, 'end', '2027-12-31').range;
    expect(daysBetween(long.from, long.to)).toBe(366);
    expect(long.to).toBe('2027-12-31');
  });
});
