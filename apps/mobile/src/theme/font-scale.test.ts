import { describe, expect, it } from 'vitest';
import { fontScaleCap } from './font-scale';

describe("each app's font scaling cap", () => {
  it('lets the rep app grow to 1.15 and keeps «Bto300» at its measured sizes', () => {
    expect(fontScaleCap('staff')).toBe(1.15);
    expect(fontScaleCap('customer')).toBe(1);
  });
});
