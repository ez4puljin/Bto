import { describe, expect, it } from 'vitest';
import { expiryBarcodeBars } from './expiry-barcode-encoding';

describe('expiry Code128 labels', () => {
  it('renders the set B payload, checksum, stop and quiet zones deterministically', () => {
    const result = expiryBarcodeBars('BTOEXP-12');
    expect(result.width).toBe(20 + 11 * (9 + 2) + 13);
    expect(result.bars[0]?.x).toBe(10);
    expect(result.bars.at(-1)).toEqual({ x: result.width - 12, width: 2 });
    expect(expiryBarcodeBars('BTOEXP-13')).not.toEqual(result);
    expect(() => expiryBarcodeBars('4870001000011')).toThrow();
  });
});
