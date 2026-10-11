import { describe, expect, it } from 'vitest';
import { isInMongolia, mapsUrl, parseCoordinates } from './index';

const UB = { lat: '47.918412', lng: '106.917712' };

describe('parseCoordinates', () => {
  it.each([
    ['a pair copied from a right click', '47.918412, 106.917712'],
    ['a pair separated by a space', '47.918412 106.917712'],
    [
      'the dropped pin of a place URL, not the map centre',
      'https://www.google.com/maps/place/Store/@47.9,106.9,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d47.918412!4d106.917712!16s',
    ],
    ['a search query', 'https://www.google.com/maps?q=47.918412,106.917712'],
    [
      'an encoded api=1 query',
      'https://www.google.com/maps/search/?api=1&query=47.918412%2C106.917712',
    ],
    ['the map centre', 'https://www.google.com/maps/@47.918412,106.917712,15z'],
    ['a pair in the wrong order', '106.917712, 47.918412'],
  ])('reads %s', (_name, input) => {
    expect(parseCoordinates(input)).toEqual({ ok: true, value: UB });
  });

  it('rounds half up to six decimals', () => {
    expect(parseCoordinates('47.9184125, 106.91771249')).toEqual({
      ok: true,
      value: { lat: '47.918413', lng: '106.917712' },
    });
  });

  it('explains what it cannot read', () => {
    expect(parseCoordinates('  ')).toEqual({ ok: false, problem: 'EMPTY' });
    expect(parseCoordinates('https://maps.app.goo.gl/AbCdEf')).toEqual({
      ok: false,
      problem: 'SHORT_LINK',
    });
    expect(parseCoordinates('Баянзүрх дүүрэг')).toEqual({ ok: false, problem: 'FORMAT' });
    // Null Island and a point in Beijing are not customer locations.
    expect(parseCoordinates('0, 0')).toEqual({ ok: false, problem: 'OUTSIDE' });
    expect(parseCoordinates('39.9042, 116.4074')).toEqual({ ok: false, problem: 'OUTSIDE' });
  });
});

describe('Mongolian points', () => {
  it('accepts the far west and east of the country only', () => {
    expect(isInMongolia('48.0', '89.9')).toBe(true);
    expect(isInMongolia('46.7', '119.5')).toBe(true);
    expect(isInMongolia('53.0', '107.0')).toBe(false);
  });

  it('links a point to Google Maps', () => {
    expect(mapsUrl(UB)).toBe(
      'https://www.google.com/maps/search/?api=1&query=47.918412,106.917712',
    );
  });
});
