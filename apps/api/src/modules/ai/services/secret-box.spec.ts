import { randomBytes } from 'node:crypto';
import { openSecret, sealSecret } from './secret-box';

const SECRET = randomBytes(32).toString('base64');
const PLAIN = 'test-key-not-real-0123456789';

describe('secret box (ADR-0162)', () => {
  it('opens what it sealed, and the sealed text does not show it', () => {
    const sealed = sealSecret(PLAIN, SECRET);
    expect(sealed).not.toContain(PLAIN);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(openSecret(sealed, SECRET)).toBe(PLAIN);
  });

  it('seals the same text differently each time', () => {
    expect(sealSecret(PLAIN, SECRET)).not.toBe(sealSecret(PLAIN, SECRET));
  });

  it('another secret or a changed value opens nothing', () => {
    const sealed = sealSecret(PLAIN, SECRET);
    expect(openSecret(sealed, randomBytes(32).toString('base64'))).toBeNull();
    const parts = sealed.split('.');
    const body = parts[3] ?? '';
    parts[3] = `${body.startsWith('A') ? 'B' : 'A'}${body.slice(1)}`;
    expect(openSecret(parts.join('.'), SECRET)).toBeNull();
    expect(openSecret('v2.a.b.c', SECRET)).toBeNull();
    expect(openSecret('nonsense', SECRET)).toBeNull();
  });

  it('refuses a secret of the wrong length', () => {
    expect(() => sealSecret(PLAIN, 'short')).toThrow('32 bytes');
  });
});
