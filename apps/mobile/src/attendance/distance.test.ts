import { describe, expect, it } from 'vitest';
import { formatDistance } from './distance';

describe('formatDistance', () => {
  it('shows metres under a kilometre', () => {
    expect(formatDistance(0)).toBe('0 м');
    expect(formatDistance(45.4)).toBe('45 м');
    expect(formatDistance(999)).toBe('999 м');
  });

  it('shows kilometres with one decimal from a kilometre, whole from ten', () => {
    expect(formatDistance(1000)).toBe('1.0 км');
    expect(formatDistance(1240)).toBe('1.2 км');
    expect(formatDistance(1250)).toBe('1.3 км');
    expect(formatDistance(12_400)).toBe('12 км');
  });

  it('never shows a negative distance', () => {
    expect(formatDistance(-3)).toBe('0 м');
  });
});
