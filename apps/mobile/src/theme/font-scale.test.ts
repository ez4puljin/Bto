import { describe, expect, it } from 'vitest';
import { fontScaleCap } from './font-scale';

describe("each app's font scaling cap", () => {
  it('keeps both apps at their measured sizes (ADR-0095, ADR-0100)', () => {
    expect(fontScaleCap('staff')).toBe(1);
    expect(fontScaleCap('customer')).toBe(1);
  });
});
