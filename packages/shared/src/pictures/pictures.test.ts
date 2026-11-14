import { describe, expect, it } from 'vitest';
import {
  keepProduct,
  PICTURE_MARGIN,
  PICTURE_SIDE,
  productPlace,
  STAMP_HEIGHT,
  STAMP_MARGIN,
  STAMP_WIDTH,
  stampPlace,
} from './index';

/** An RGBA image of `width` × `height`, transparent but for the given rectangles. */
function image(
  width: number,
  height: number,
  rects: { x: number; y: number; w: number; h: number; alpha?: number }[],
) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const rect of rects) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        rgba[(y * width + x) * 4 + 3] = rect.alpha ?? 255;
      }
    }
  }
  return rgba;
}
const alphaAt = (rgba: Uint8ClampedArray, width: number, x: number, y: number) =>
  rgba[(y * width + x) * 4 + 3];

describe('the product of a cut-out (ADR-0198)', () => {
  // A bottle on the left, a matchbox for scale on the right.
  const bottle = { x: 10, y: 5, w: 30, h: 80 };
  const matchbox = { x: 60, y: 70, w: 15, h: 10 };

  it('keeps the largest object when the product’s place is unknown', () => {
    const rgba = image(100, 100, [bottle, matchbox]);
    expect(keepProduct(rgba, 100, 100, null)).toEqual({ x: 10, y: 5, width: 30, height: 80 });
    expect(alphaAt(rgba, 100, 20, 40)).toBe(255);
    expect(alphaAt(rgba, 100, 65, 75)).toBe(0);
  });

  it('keeps the object in the product’s place, even a smaller one', () => {
    // A small pack of gum beside a matchbox larger than itself.
    const gum = { x: 10, y: 60, w: 12, h: 8 };
    const bigMatchbox = { x: 50, y: 50, w: 30, h: 20 };
    const rgba = image(100, 100, [gum, bigMatchbox]);
    const bounds = keepProduct(rgba, 100, 100, { left: 0.05, top: 0.5, width: 0.25, height: 0.3 });
    expect(bounds).toEqual({ x: 10, y: 60, width: 12, height: 8 });
    expect(alphaAt(rgba, 100, 60, 60)).toBe(0);
  });

  it('keeps every piece of a set lying in the product’s place', () => {
    const left = { x: 10, y: 10, w: 20, h: 60 };
    const right = { x: 40, y: 10, w: 20, h: 60 };
    const rgba = image(100, 100, [left, right, matchbox]);
    const bounds = keepProduct(rgba, 100, 100, { left: 0.05, top: 0.05, width: 0.6, height: 0.7 });
    expect(bounds).toEqual({ x: 10, y: 10, width: 50, height: 60 });
    expect(alphaAt(rgba, 100, 45, 30)).toBe(255);
    expect(alphaAt(rgba, 100, 65, 75)).toBe(0);
  });

  it('falls back to the largest object when the named place holds nothing', () => {
    const rgba = image(100, 100, [bottle, matchbox]);
    const bounds = keepProduct(rgba, 100, 100, { left: 0.9, top: 0, width: 0.1, height: 0.1 });
    expect(bounds).toEqual({ x: 10, y: 5, width: 30, height: 80 });
  });

  it('does not join the product and the matchbox through the haze of a shadow', () => {
    const rgba = image(100, 100, [
      { x: 10, y: 5, w: 30, h: 80 },
      { x: 40, y: 80, w: 20, h: 5, alpha: 90 }, // a faint shadow between the two
      { x: 60, y: 70, w: 15, h: 15 },
    ]);
    expect(keepProduct(rgba, 100, 100, null)).toEqual({ x: 10, y: 5, width: 30, height: 80 });
    expect(alphaAt(rgba, 100, 65, 75)).toBe(0);
    expect(alphaAt(rgba, 100, 50, 82)).toBe(0);
  });

  it('keeps the soft rim of the product and clears haze elsewhere', () => {
    const rgba = image(100, 100, [
      bottle,
      { x: 40, y: 5, w: 1, h: 80, alpha: 20 }, // the bottle's anti-aliased edge
      { x: 80, y: 10, w: 5, h: 5, alpha: 20 }, // haze far away
    ]);
    keepProduct(rgba, 100, 100, null);
    expect(alphaAt(rgba, 100, 40, 40)).toBe(20);
    expect(alphaAt(rgba, 100, 82, 12)).toBe(0);
  });

  it('answers null for an empty cut-out', () => {
    expect(keepProduct(image(20, 20, []), 20, 20, null)).toBeNull();
  });
});

describe('the picture’s layout (ADR-0198)', () => {
  it('draws the product as large as the margins allow, in the middle', () => {
    const room = PICTURE_SIDE * (1 - 2 * PICTURE_MARGIN);
    const tall = productPlace({ x: 0, y: 0, width: 300, height: 600 });
    expect(tall.height).toBe(room);
    expect(tall.width).toBe(room / 2);
    expect(tall.x).toBe((PICTURE_SIDE - tall.width) / 2);
    expect(tall.y).toBe(PICTURE_SIDE * PICTURE_MARGIN);
    const wide = productPlace({ x: 5, y: 5, width: 800, height: 200 });
    expect(wide.width).toBe(room);
    expect(wide.y).toBeGreaterThan(wide.x);
  });

  it('draws a product that would reach under the logo in the room below it', () => {
    const logo = stampPlace(920, 322);
    // A bottle is narrow: it passes beside the logo and keeps the whole height.
    const bottle = { x: 0, y: 0, width: 300, height: 1100 };
    expect(productPlace(bottle, PICTURE_SIDE, logo)).toEqual(productPlace(bottle));
    // A wide pack would lie under the logo: it starts below it and stays inside the margins.
    const pack = { x: 0, y: 0, width: 700, height: 900 };
    const placed = productPlace(pack, PICTURE_SIDE, logo);
    expect(placed.y).toBeGreaterThanOrEqual(logo.y + logo.height);
    expect(placed.y + placed.height).toBeLessThanOrEqual(PICTURE_SIDE * (1 - PICTURE_MARGIN) + 1);
    expect(placed.width / placed.height).toBeCloseTo(700 / 900, 1);
    expect(placed.height).toBeLessThan(productPlace(pack).height);
  });

  it('puts the logo in the top-left corner at its own proportions', () => {
    const wide = stampPlace(920, 322);
    expect(wide.x).toBe(PICTURE_SIDE * STAMP_MARGIN);
    expect(wide.y).toBe(PICTURE_SIDE * STAMP_MARGIN);
    expect(wide.width).toBe(PICTURE_SIDE * STAMP_WIDTH);
    expect(wide.width / wide.height).toBeCloseTo(920 / 322, 1);
    const square = stampPlace(300, 300);
    expect(square.height).toBe(PICTURE_SIDE * STAMP_HEIGHT);
    expect(square.width).toBe(square.height);
  });
});
