import { describe, expect, it } from 'vitest';
import { BANNER_SIZE, CATEGORY_PICTURE_SIZE, coverRect, fitWithin } from './image-resize';

describe('fitWithin', () => {
  it('scales the longer side down and never up', () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});

describe('coverRect (ADR-0092 #5, #6)', () => {
  it('cuts a 2:1 banner from the middle of a 4:3 photo', () => {
    expect(coverRect(4000, 3000, BANNER_SIZE.width, BANNER_SIZE.height)).toEqual({
      x: 0,
      y: 500,
      width: 4000,
      height: 2000,
    });
  });

  it('cuts a square from the middle of a wide or a tall photo', () => {
    const square = CATEGORY_PICTURE_SIZE;
    expect(coverRect(1600, 900, square.width, square.height)).toEqual({
      x: 350,
      y: 0,
      width: 900,
      height: 900,
    });
    expect(coverRect(600, 1000, square.width, square.height)).toEqual({
      x: 0,
      y: 200,
      width: 600,
      height: 600,
    });
  });

  it('takes the whole of a small photo of the right shape (it is scaled up)', () => {
    expect(coverRect(300, 150, BANNER_SIZE.width, BANNER_SIZE.height)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 150,
    });
  });
});
