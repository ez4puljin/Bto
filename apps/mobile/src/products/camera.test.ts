import { describe, expect, it } from 'vitest';
import { pictureSizeFor } from './camera';

describe('the camera’s picture size (ADR-0199)', () => {
  it('takes the smallest size whose long side reaches 1600 px', () => {
    expect(pictureSizeFor(['4000x3000', '1920x1080', '1280x720', '2560x1440'])).toBe('1920x1080');
    expect(pictureSizeFor(['3000x4000', '1200x1600'])).toBe('1200x1600');
  });

  it('leaves the camera its own size when none is large enough or readable', () => {
    expect(pictureSizeFor(['1280x720', '640x480'])).toBeUndefined();
    expect(pictureSizeFor(['Photo', 'High', '4:3'])).toBeUndefined();
    expect(pictureSizeFor([])).toBeUndefined();
  });
});
