import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
/** Binds a sealed value to its column: it cannot be moved to another use of the same secret. */
const CONTEXT = Buffer.from('ai_settings.api_key', 'utf8');

function keyOf(secret: string): Buffer {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32) throw new Error('the sealing secret must be 32 bytes in base64');
  return key;
}

/**
 * Seals the provider key saved on the settings screen (ADR-0162): AES-256-GCM under AI_KEY_SECRET,
 * as `v1.<iv>.<tag>.<ciphertext>` in base64url. A database backup alone does not reveal the key.
 */
export function sealSecret(plain: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyOf(secret), iv);
  cipher.setAAD(CONTEXT);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), body]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** The sealed value, or null when it cannot be opened (another secret, a damaged value). */
export function openSecret(sealed: string, secret: string): string | null {
  const [version, iv, tag, body, ...rest] = sealed.split('.');
  if (version !== VERSION || iv === undefined || tag === undefined || body === undefined) {
    return null;
  }
  if (rest.length > 0) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, keyOf(secret), Buffer.from(iv, 'base64url'));
    decipher.setAAD(CONTEXT);
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
