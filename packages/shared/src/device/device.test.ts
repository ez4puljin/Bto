import { describe, expect, it } from 'vitest';
import { appUserAgent, describeClient, shortInstallId } from './index';

const PHONE = {
  app: 'Bto-staff',
  version: '0.19.0',
  os: 'Android',
  osVersion: '14',
  brand: 'samsung',
  model: 'SM-A546E',
  installId: '3F2A9C1E-77aa-4bbb-8ccc-0123456789ab',
};

describe('the device a sign-in came from', () => {
  it('names the app, its version, the system and the phone in the header', () => {
    expect(appUserAgent(PHONE)).toBe(
      'Bto-staff/0.19.0 (Android 14; samsung SM-A546E; id 3f2a9c1e)',
    );
  });

  it('reads its own header back', () => {
    expect(describeClient(appUserAgent(PHONE))).toEqual({
      kind: 'app',
      app: 'Bto-staff',
      appVersion: '0.19.0',
      os: 'Android 14',
      device: 'samsung SM-A546E',
      installId: '3f2a9c1e',
    });
  });

  it('keeps the header plain whatever the phone calls itself', () => {
    const header = appUserAgent({
      ...PHONE,
      brand: 'Xiaomi',
      model: 'Xiaomi Redmi (Note) 12; Pro/5G утас',
      installId: '',
    });
    // The brand is not said twice; separators and non-ASCII letters are gone; no id is zeros.
    expect(header).toBe('Bto-staff/0.19.0 (Android 14; Xiaomi Redmi Note 12 Pro 5G; id 00000000)');
    expect(/^[\x20-\x7e]+$/.test(header)).toBe(true);
    expect(describeClient(header)).toMatchObject({
      kind: 'app',
      device: 'Xiaomi Redmi Note 12 Pro 5G',
    });
    expect(appUserAgent({ ...PHONE, brand: '', model: '' })).toContain('; unknown; ');
    expect(appUserAgent({ ...PHONE, model: 'x'.repeat(500) }).length).toBeLessThan(160);
  });

  it('shortens an install id to eight hex digits', () => {
    expect(shortInstallId('3F2A9C1E-77aa-4bbb-8ccc-0123456789ab')).toBe('3f2a9c1e');
    expect(shortInstallId('zz')).toBe('00000000');
  });

  it('knows the browsers and systems the office uses', () => {
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
    expect(describeClient(chrome)).toEqual({
      kind: 'browser',
      browser: 'Chrome 142',
      os: 'Windows 10/11',
    });
    expect(describeClient(`${chrome} Edg/142.0.0.0`)).toMatchObject({ browser: 'Edge 142' });
    expect(
      describeClient(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ kind: 'browser', browser: 'Safari 17', os: 'iOS 17.4' });
    expect(
      describeClient(
        'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      ),
    ).toEqual({ kind: 'browser', browser: 'Chrome 141', os: 'Android 14' });
    expect(
      describeClient(
        'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
      ),
    ).toEqual({ kind: 'browser', browser: 'Firefox 144', os: 'Linux' });
  });

  it('tells an old app, a tool and nothing apart', () => {
    expect(describeClient('okhttp/4.9.2')).toEqual({ kind: 'legacyApp' });
    expect(describeClient('curl/8.21.0')).toEqual({ kind: 'other', raw: 'curl/8.21.0' });
    expect(describeClient('node')).toEqual({ kind: 'other', raw: 'node' });
    expect(describeClient('Mozilla/5.0 (compatible; unknown)')).toEqual({
      kind: 'other',
      raw: 'Mozilla/5.0 (compatible; unknown)',
    });
    expect(describeClient(null)).toEqual({ kind: 'unknown' });
    expect(describeClient('   ')).toEqual({ kind: 'unknown' });
    // A forged header that only looks like ours is not taken for an app.
    expect(describeClient('Bto-staff/0.19.0 (Android 14; x; id nothex!!)').kind).toBe('other');
  });
});
