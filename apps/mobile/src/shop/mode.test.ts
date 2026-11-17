import { describe, expect, it } from 'vitest';
import { cartModeFrom } from './mode';

describe('cartModeFrom', () => {
  it('reads the two modes', () => {
    expect(cartModeFrom('easy')).toBe('easy');
    expect(cartModeFrom('normal')).toBe('normal');
  });
  it('falls back to the normal mode', () => {
    expect(cartModeFrom(null)).toBe('normal');
    expect(cartModeFrom('other')).toBe('normal');
    expect(cartModeFrom(3)).toBe('normal');
  });
});
