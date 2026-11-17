import { describe, expect, it } from 'vitest';
import { mailUriOf, phoneLabel, roleLine } from './people';

describe('the staff app’s «Манайхан»', () => {
  it('shows a Mongolian number in two fours', () => {
    expect(phoneLabel('+97689383719')).toBe('8938 3719');
    expect(phoneLabel('89383719')).toBe('8938 3719');
    expect(phoneLabel('+1 555 0100')).toBe('+1 555 0100');
  });

  it('puts the position before the division and skips what is missing', () => {
    expect(roleLine({ position: 'Нярав', divisionName: 'Агуулах' })).toBe('Нярав · Агуулах');
    expect(roleLine({ position: null, divisionName: 'Агуулах' })).toBe('Агуулах');
    expect(roleLine({ position: ' ', divisionName: null })).toBe('');
  });

  it('opens mail only for an address', () => {
    expect(mailUriOf('bat@example.mn')).toBe('mailto:bat@example.mn');
    expect(mailUriOf(null)).toBeNull();
    expect(mailUriOf('')).toBeNull();
  });
});
