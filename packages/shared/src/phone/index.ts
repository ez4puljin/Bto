/**
 * Mongolian mobile numbers are stored in E.164: `+976` and 8 digits (ADR-0005 #3). People type
 * them in local form, with spaces or dashes; this returns the stored form or null when invalid.
 */
export const MN_PHONE_E164 = /^\+976\d{8}$/;

export function normalizeMnPhone(input: string): string | null {
  const compact = input.replace(/[\s()-]/g, '');
  const local = compact.replace(/^(\+976|00976|976)(?=\d{8}$)/, '');
  return /^\d{8}$/.test(local) ? `+976${local}` : null;
}
