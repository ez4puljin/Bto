import { normalizeMnPhone } from '@tugeel/shared/phone';

// The sign-in and «Нууц үг тавих» fields (ADR-0079 #3, the Login and SetPassword boards): the
// phone typed after «+976», the office's code as `XXXXX-XXXXX`, a new password twice.

/** The phone field: digits only, at most 8, shown as «9911 2233». */
export function phoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

/** The phone the server takes (`+976` and 8 digits), or null while it is not one yet. */
export function phoneOf(input: string): string | null {
  return normalizeMnPhone(input.replace(/\D/g, ''));
}

/** The code field: letters upper case, other marks dropped, a dash after the fifth (`7KQ2M-X9D4F`). */
export function codeInput(raw: string): string {
  const plain = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, 10);
  return plain.length > 5 ? `${plain.slice(0, 5)}-${plain.slice(5)}` : plain;
}

/** A whole code: ten letters or digits. */
export function codeComplete(input: string): boolean {
  return /^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(input);
}

/** The server's rule (ADR-0027): at least 8 characters; at most 128. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** What keeps a new password from being set: too short, too long, or the two differ. */
export function newPasswordIssue(
  password: string,
  again: string,
): 'short' | 'long' | 'mismatch' | null {
  if ([...password].length < PASSWORD_MIN) return 'short';
  if ([...password].length > PASSWORD_MAX) return 'long';
  return password === again ? null : 'mismatch';
}
