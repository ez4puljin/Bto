import type mn from '@tugeel/shared/i18n/mn.json';
import { checkPassword } from '@tugeel/shared/auth';

/** Zod messages are i18n keys under `validation.` so the form shows Mongolian text. */
export type ValidationMessage = `validation.${keyof (typeof mn)['validation']}`;

export function isValidationMessage(value: unknown): value is ValidationMessage {
  return typeof value === 'string' && value.startsWith('validation.');
}

/**
 * The shared password policy as a form message (the API stays authoritative): never the login
 * name, never the staff member's own phone (ADR-0128 #5).
 */
export function passwordMessage(
  password: string,
  username: string,
  phone?: string | null,
): ValidationMessage | null {
  switch (checkPassword(password, username, phone)) {
    case 'TOO_SHORT':
      return 'validation.passwordTooShort';
    case 'TOO_LONG':
      return 'validation.passwordTooLong';
    case 'SAME_AS_USERNAME':
      return 'validation.passwordSameAsUsername';
    case 'SAME_AS_PHONE':
      return 'validation.passwordSameAsPhone';
    case null:
      return null;
  }
}
