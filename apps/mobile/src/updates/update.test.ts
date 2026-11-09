import { describe, expect, it } from 'vitest';
import { apkUrlOf, checkOutcomeOf, megabytesOf, percentOf, updateOf } from './update';

const release = { version: '0.4.0', versionCode: 500, sizeBytes: 78_643_200 };

describe('an app’s own update (ADR-0166)', () => {
  it('offers only a newer build', () => {
    expect(updateOf(release, 499)).toBe(release);
    expect(updateOf(release, 500)).toBeNull();
    expect(updateOf(release, 501)).toBeNull();
  });

  it('offers nothing with no release or an unknown build', () => {
    expect(updateOf(null, 499)).toBeNull();
    expect(updateOf(undefined, 499)).toBeNull();
    expect(updateOf(release, undefined)).toBeNull();
  });

  it('says the size in whole megabytes', () => {
    expect(megabytesOf(78_643_200)).toBe(75);
    expect(megabytesOf(1000)).toBe(1);
  });

  it('counts the download from 0 to 100', () => {
    expect(percentOf(0, 100)).toBe(0);
    expect(percentOf(455, 1000)).toBe(45);
    expect(percentOf(1000, 1000)).toBe(100);
    expect(percentOf(1200, 1000)).toBe(100);
    expect(percentOf(10, 0)).toBe(0);
  });

  it('answers a press of «Шинэчлэл шалгах» (ADR-0174 #10)', () => {
    expect(checkOutcomeOf(true, release, 499)).toBe('found');
    expect(checkOutcomeOf(true, release, 500)).toBe('latest');
    expect(checkOutcomeOf(true, null, 500)).toBe('latest');
    expect(checkOutcomeOf(false, release, 499)).toBe('offline');
  });

  it('builds the APK’s address', () => {
    expect(apkUrlOf('http://192.168.1.215:3300', 'customer')).toBe(
      'http://192.168.1.215:3300/api/v1/app-releases/customer/apk',
    );
  });
});
