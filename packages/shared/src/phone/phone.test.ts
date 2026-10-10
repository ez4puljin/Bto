import { describe, expect, it } from 'vitest';
import { MN_PHONE_E164, normalizeMnPhone } from './index';

describe('Mongolian phone numbers', () => {
  it('normalises local and international forms to E.164', () => {
    for (const input of ['99112233', '9911 2233', '9911-2233', '+97699112233', '976 9911 2233']) {
      expect(normalizeMnPhone(input)).toBe('+97699112233');
    }
    expect(MN_PHONE_E164.test('+97699112233')).toBe(true);
  });

  it('rejects numbers that are not 8 local digits', () => {
    for (const input of ['9911223', '991122334', '+7 9911 2233', 'abc', '']) {
      expect(normalizeMnPhone(input)).toBeNull();
    }
  });
});
