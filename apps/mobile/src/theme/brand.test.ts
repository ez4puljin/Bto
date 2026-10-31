import { afterEach, describe, expect, it } from 'vitest';
import {
  applyBrand,
  brandOf,
  brandSheet,
  BUILT_IN_PALETTE,
  contrastWithWhite,
  currentBrand,
  NO_BRAND,
  paletteOf,
  storedBrandOf,
  subscribeBrand,
} from './brand';

afterEach(() => {
  applyBrand(NO_BRAND);
});

describe("the office's branding of the apps (ADR-0127 #4)", () => {
  it('takes a name within the web form’s limit and a #RRGGBB white can stand on', () => {
    expect(brandOf({ appName: '  Оргил  ', appColor: '#1a7f37' })).toEqual({
      name: 'Оргил',
      primary: '#1A7F37',
    });
  });

  it('keeps the built-in name and blue for nothing, an empty or too long name, an odd colour', () => {
    expect(brandOf(null)).toEqual(NO_BRAND);
    expect(brandOf({ appName: '   ', appColor: null })).toEqual(NO_BRAND);
    expect(brandOf({ appName: 'x'.repeat(41) })).toEqual(NO_BRAND);
    expect(brandOf({ appColor: '1A7F37' })).toEqual(NO_BRAND);
    expect(brandOf({ appColor: '#1A7' })).toEqual(NO_BRAND);
    expect(brandOf({ appColor: 'blue' })).toEqual(NO_BRAND);
  });

  it('refuses a colour too light for white text (under 3:1) and keeps the built-in blue', () => {
    expect(contrastWithWhite('#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 5);
    expect(contrastWithWhite('#0071E3')).toBeGreaterThan(4);
    expect(brandOf({ appColor: '#FFD700' }).primary).toBeNull();
    expect(brandOf({ appColor: '#FF9500' }).primary).toBeNull();
    expect(brandOf({ appColor: '#D70015' }).primary).toBe('#D70015');
  });

  it('reads a stored copy the same way and drops an old or odd one', () => {
    expect(storedBrandOf({ name: 'Bto Мөрөн', primary: '#D70015' })).toEqual({
      name: 'Bto Мөрөн',
      primary: '#D70015',
    });
    expect(storedBrandOf({ name: 5, primary: '#FFFFFF' })).toEqual(NO_BRAND);
    expect(storedBrandOf('blue')).toEqual(NO_BRAND);
    expect(storedBrandOf(null)).toEqual(NO_BRAND);
  });
});

describe('the palette the primary colour decides', () => {
  it('is the web’s blue, byte for byte, when the office set none', () => {
    expect(paletteOf(null)).toBe(BUILT_IN_PALETTE);
    expect(BUILT_IN_PALETTE.primaryPressed).toBe('#0066CC');
    expect(BUILT_IN_PALETTE.secondary).toBe('#E8F0FB');
  });

  it('derives the pressed shade, the link, the tint and the glows from the colour', () => {
    // The built-in blue derives its own pressed shade: the rule matches the hand-picked value.
    expect(paletteOf('#0071E3').primaryPressed).toBe('#0066CC');
    const red = paletteOf('#D70015');
    expect(red.primary).toBe('#D70015');
    expect(red.primaryPressed).toBe('#C20013');
    expect(red.link).toBe(red.primaryPressed);
    expect(red.secondary).toBe('#FBE8EA');
    expect(red.rangeFill).toBe('rgba(215,0,21,0.12)');
    expect(red.shadows.brand).toBe('0 6px 16px rgba(215,0,21,0.28)');
    expect(red.shadows.bluePill).toBe('0 8px 24px rgba(215,0,21,0.3)');
  });
});

describe('the brand in use', () => {
  it('tells its listeners of a change, and nothing of the same brand again', () => {
    let heard = 0;
    const stop = subscribeBrand(() => {
      heard += 1;
    });
    expect(applyBrand({ name: 'Оргил', primary: '#1A7F37' })).toBe(true);
    expect(applyBrand({ name: 'Оргил', primary: '#1A7F37' })).toBe(false);
    expect(currentBrand()).toEqual({ name: 'Оргил', primary: '#1A7F37' });
    expect(heard).toBe(1);
    stop();
    applyBrand(NO_BRAND);
    expect(heard).toBe(1);
  });

  it('rebuilds a sheet once the brand changed and keeps it otherwise', () => {
    let builds = 0;
    const sheet = brandSheet(() => {
      builds += 1;
      return { band: { backgroundColor: paletteOf(currentBrand().primary).primary } };
    });
    expect(sheet.band.backgroundColor).toBe('#0071E3');
    expect(sheet.band).toBe(sheet.band);
    expect(builds).toBe(1);
    applyBrand({ name: null, primary: '#1A7F37' });
    expect(sheet.band.backgroundColor).toBe('#1A7F37');
    expect(Object.keys(sheet)).toEqual(['band']);
    expect(builds).toBe(2);
  });
});
