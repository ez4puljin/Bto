import { isErrorCode } from '@tugeel/shared/errors';

/**
 * The printing module's own error codes (ADR-0226 #7, `printing.errors.ts` in the api): they are
 * registered beside Bto's catalog, not in it, so the app's shared `isErrorCode` does not know them;
 * their texts are `errors.<code>` of mn.json like every other code's.
 */
export const PRINT_CODES = [
  'PRINT_NO_TILL',
  'PRINT_TILL_NOT_YOURS',
  'PRINT_PRODUCT_NOT_FOUND',
  'PRINT_TOO_MANY_LABELS',
  'PRINT_STATION_NOT_FOUND',
  'PRINT_KEY_INVALID',
  'PRINT_JOB_NOT_FOUND',
  'PRINT_JOB_STATE',
  'PRINTER_OFFLINE',
  'PRINTER_UNREACHABLE',
  'PRINTER_REFUSED',
] as const;

export type PrintCode = (typeof PRINT_CODES)[number];

export function isPrintCode(value: unknown): value is PrintCode {
  return typeof value === 'string' && (PRINT_CODES as readonly string[]).includes(value);
}

/** A code that has its own `errors.<code>` text: Bto's catalog or the printing module's. */
export function hasErrorText(value: unknown): boolean {
  return isPrintCode(value) || isErrorCode(value);
}
