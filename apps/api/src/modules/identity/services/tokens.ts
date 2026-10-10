import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** 256 random bits; only its SHA-256 is stored (auth_sessions.token_hash). */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex digests. */
export function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/** Crockford base32: no I, L, O or U, so codes read aloud or typed from paper stay unambiguous. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A one-time password code shown once to the admin, e.g. `7KQ2M-X9D4F` (50 random bits). */
export function newSetupCode(): string {
  let code = '';
  for (let index = 0; index < 10; index += 1) code += CODE_ALPHABET.charAt(randomInt(32));
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Accepts lowercase, spaces, dashes and the look-alikes I/L (→ 1) and O (→ 0). */
export function normalizeSetupCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');
}

/** HMAC-SHA256 with AUTH_PEPPER: a leaked database alone cannot be brute-forced offline. */
export function hashSetupCode(pepper: string, code: string): string {
  return createHmac('sha256', pepper).update(normalizeSetupCode(code), 'utf8').digest('hex');
}
