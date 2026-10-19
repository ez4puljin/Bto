import { describe, expect, it } from 'vitest';
import { appConfigOf } from './app-config';

describe('the build’s app config', () => {
  it('is the staff app unless the build says customer', () => {
    expect(appConfigOf(undefined)).toEqual({
      variant: 'staff',
      defaultServer: null,
      serverFixed: false,
    });
    expect(appConfigOf({ variant: 'customer' }).variant).toBe('customer');
    expect(appConfigOf({ variant: 'driver' }).variant).toBe('staff');
  });

  it('fixes the server only when a production build names one', () => {
    expect(
      appConfigOf({ variant: 'customer', defaultServer: 'https://bto.mn', serverFixed: true }),
    ).toEqual({ variant: 'customer', defaultServer: 'https://bto.mn', serverFixed: true });
    expect(appConfigOf({ defaultServer: '', serverFixed: true })).toMatchObject({
      defaultServer: null,
      serverFixed: false,
    });
    expect(appConfigOf({ defaultServer: 'http://192.168.0.100:3300' }).serverFixed).toBe(false);
  });
});
