import { describe, expect, it } from 'vitest';
import { isSettingKey, parseSettingValue, SETTING_KEYS, settingDefault } from './index';

describe('settings registry', () => {
  it('never lets one key be a segment prefix of another (i18n key paths would collide)', () => {
    for (const a of SETTING_KEYS) {
      for (const b of SETTING_KEYS) {
        if (a !== b) expect(b.startsWith(`${a}.`)).toBe(false);
      }
    }
    expect(isSettingKey('auth.staff_session_hours')).toBe(true);
    expect(isSettingKey('constructor')).toBe(false);
  });

  it('defaults only the session length, never a tax rate', () => {
    expect(settingDefault('auth.staff_session_hours')).toBe(12);
    expect(settingDefault('tax.vat_rate_pct')).toBeUndefined();
    expect(settingDefault('tax.city_tax_rate_pct')).toBeUndefined();
  });

  it('accepts percentages as decimal strings from 0 to 100 with two decimals', () => {
    expect(parseSettingValue('tax.vat_rate_pct', '10')).toEqual({ ok: true, value: '10' });
    expect(parseSettingValue('tax.city_tax_rate_pct', '2.5')).toEqual({ ok: true, value: '2.5' });
    expect(parseSettingValue('tax.vat_rate_pct', '100.00')).toEqual({ ok: true, value: '100.00' });
    expect(parseSettingValue('tax.vat_rate_pct', '100.01')).toEqual({
      ok: false,
      problem: 'RANGE',
    });
    expect(parseSettingValue('tax.vat_rate_pct', '1.234')).toEqual({ ok: false, problem: 'RANGE' });
    expect(parseSettingValue('tax.vat_rate_pct', 10)).toEqual({ ok: false, problem: 'TYPE' });
  });

  it('checks booleans and integer ranges', () => {
    expect(parseSettingValue('company.vat_payer', true)).toEqual({ ok: true, value: true });
    expect(parseSettingValue('company.vat_payer', 'true')).toEqual({ ok: false, problem: 'TYPE' });
    expect(parseSettingValue('auth.staff_session_hours', 8)).toEqual({ ok: true, value: 8 });
    expect(parseSettingValue('auth.staff_session_hours', 0)).toEqual({
      ok: false,
      problem: 'RANGE',
    });
    expect(parseSettingValue('auth.staff_session_hours', 169)).toEqual({
      ok: false,
      problem: 'RANGE',
    });
    expect(parseSettingValue('auth.staff_session_hours', 1.5)).toEqual({
      ok: false,
      problem: 'TYPE',
    });
  });
});
