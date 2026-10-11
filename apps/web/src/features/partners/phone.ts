/** A stored +976 number as people read it ("+97699112233" → "9911 2233"). */
export function localPhone(phone: string): string {
  return phone.replace(/^\+976(\d{4})(\d{4})$/, '$1 $2');
}

/** A stored number for a form field: the eight local digits. */
export function phoneInput(phone: string | null): string {
  return phone?.replace(/^\+976/, '') ?? '';
}
