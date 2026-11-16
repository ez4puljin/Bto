import { openSealed, seal } from '../../../common/crypto/secret-box';

/** Binds a sealed value to its column: it cannot be moved to another use of the same secret. */
export const MODEL_KEY_CONTEXT = 'ai_settings.api_key';
/** The background service's key (ADR-0198). */
export const PICTURE_KEY_CONTEXT = 'ai_picture_settings.api_key';

/**
 * Seals the provider key saved on the settings screen (ADR-0162): AES-256-GCM under AI_KEY_SECRET,
 * as `v1.<iv>.<tag>.<ciphertext>` in base64url. A database backup alone does not reveal the key.
 */
export function sealSecret(
  plain: string,
  secret: string,
  context: string = MODEL_KEY_CONTEXT,
): string {
  return seal(plain, secret, context);
}

/** The sealed value, or null when it cannot be opened (another secret, a damaged value). */
export function openSecret(
  sealed: string,
  secret: string,
  context: string = MODEL_KEY_CONTEXT,
): string | null {
  return openSealed(sealed, secret, context);
}
