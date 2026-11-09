import { describe, expect, it } from 'vitest';
import { firstNameOf, greetingOf, monthDayOf } from './home';

describe('the staff app’s «Нүүр» (ADR-0174)', () => {
  it('greets by the hour in Ulaanbaatar', () => {
    expect(greetingOf(Date.parse('2026-11-08T22:30:00Z'))).toBe('morning'); // 06:30
    expect(greetingOf(Date.parse('2026-11-09T03:59:00Z'))).toBe('morning'); // 11:59
    expect(greetingOf(Date.parse('2026-11-09T04:00:00Z'))).toBe('day'); // 12:00
    expect(greetingOf(Date.parse('2026-11-09T10:00:00Z'))).toBe('evening'); // 18:00
    expect(greetingOf(Date.parse('2026-11-09T18:00:00Z'))).toBe('evening'); // 02:00
  });

  it('reads the month and day of a date', () => {
    expect(monthDayOf('2026-11-09')).toEqual({ month: 11, day: 9 });
    expect(monthDayOf('2026-01-31')).toEqual({ month: 1, day: 31 });
  });

  it('calls a person by the first name', () => {
    expect(firstNameOf('Б.Болд')).toBe('Болд');
    expect(firstNameOf('Батын Болд')).toBe('Болд');
    expect(firstNameOf('Болд')).toBe('Болд');
    expect(firstNameOf('  Б. Болд ')).toBe('Болд');
  });
});
