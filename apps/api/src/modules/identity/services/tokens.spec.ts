import {
  hashSetupCode,
  newRefreshToken,
  newSetupCode,
  normalizeSetupCode,
  sameDigest,
  sha256Hex,
} from './tokens';

describe('token helpers', () => {
  it('creates distinct 256-bit refresh tokens', () => {
    const a = newRefreshToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newRefreshToken()).not.toBe(a);
  });

  it('compares digests in constant time and rejects different lengths', () => {
    const digest = sha256Hex('x');
    expect(sameDigest(digest, sha256Hex('x'))).toBe(true);
    expect(sameDigest(digest, sha256Hex('y'))).toBe(false);
    expect(sameDigest(digest, digest.slice(0, 10))).toBe(false);
    expect(sameDigest('', '')).toBe(false);
  });

  it('makes readable one-time codes and tolerates how people type them', () => {
    const code = newSetupCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeSetupCode(' 7kq2m - x9d4f ')).toBe('7KQ2MX9D4F');
    expect(normalizeSetupCode('O1LI0')).toBe('01110');
    expect(hashSetupCode('pepper-1', code)).toBe(hashSetupCode('pepper-1', code.toLowerCase()));
    expect(hashSetupCode('pepper-1', code)).not.toBe(hashSetupCode('pepper-2', code));
  });
});
