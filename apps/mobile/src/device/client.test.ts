import { describeClient } from '@tugeel/shared/device';
import { describe, expect, it } from 'vitest';
import { phoneOf, userAgentOf } from './client';

const ANDROID = {
  OS: 'android',
  Version: 34,
  constants: { Release: '14', Brand: 'samsung', Manufacturer: 'samsung', Model: 'SM-A546E' },
};

describe('how the app names its phone to the server', () => {
  it('reads an Android phone: the release people know, the brand and the model', () => {
    expect(phoneOf(ANDROID)).toEqual({
      os: 'Android',
      osVersion: '14',
      brand: 'samsung',
      model: 'SM-A546E',
    });
    // An odd build without the constants still says something true.
    expect(phoneOf({ OS: 'android', Version: 34 })).toEqual({
      os: 'Android',
      osVersion: 'API 34',
      brand: '',
      model: '',
    });
  });

  it('reads an iPhone and an iPad', () => {
    expect(phoneOf({ OS: 'ios', Version: '17.4', constants: { osVersion: '17.4' } })).toEqual({
      os: 'iOS',
      osVersion: '17.4',
      brand: 'Apple',
      model: 'iPhone',
    });
    expect(
      phoneOf({ OS: 'ios', Version: '17.4', constants: { interfaceIdiom: 'pad' } }).model,
    ).toBe('iPad');
  });

  it('builds the header the office reads back', () => {
    const header = userAgentOf({
      variant: 'staff',
      version: '0.19.0',
      platform: ANDROID,
      installId: '3f2a9c1e-77aa-4bbb-8ccc-0123456789ab',
    });
    expect(header).toBe('Bto-staff/0.19.0 (Android 14; samsung SM-A546E; id 3f2a9c1e)');
    expect(describeClient(header)).toMatchObject({ kind: 'app', device: 'samsung SM-A546E' });
    expect(
      userAgentOf({ variant: 'customer', version: '0.5.0', platform: ANDROID, installId: '' }),
    ).toBe('Bto300/0.5.0 (Android 14; samsung SM-A546E; id 00000000)');
  });
});
