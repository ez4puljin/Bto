/**
 * Barcode normalisation (architecture §5.2 M11, ADR-0028). GTIN-8/12/13/14 are padded to a canonical
 * 14-digit `gtin14` after the check digit is verified, UPC-E is expanded to UPC-A, and other codes
 * (Code 128 labels, short internal codes) stay as printed, upper-cased. The lookup key of a stored
 * barcode is `gtin14 ?? upper(code)`, so UPC-A "036000291452" and EAN-13 "0036000291452" are one key.
 */

/** e-Barimt `barCodeType` (PosAPI 3.0). Restricted-circulation GTINs are not global: UNDEFINED. */
export const BARCODE_TYPES = ['GS1', 'ISBN', 'UNDEFINED'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

/** Internal EAN-13 prefix: GS1 restricted circulation; 21–29 are read as weight codes by many POS. */
export const INTERNAL_BARCODE_PREFIX = '20';
const INTERNAL_SEQUENCE_DIGITS = 10;
export const MAX_BARCODE_LENGTH = 48;

const DIGITS = /^\d+$/;
const PRINTABLE = /^[\x21-\x7e]+$/;

/** GS1 check digit of a digit string without its check digit (weights 3,1 from the right). */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

function hasValidCheckDigit(code: string): boolean {
  return gtinCheckDigit(code.slice(0, -1)) === code.charCodeAt(code.length - 1) - 48;
}

/** UPC-E (8 digits, number system 0 or 1) expanded to UPC-A, or null when it is not valid UPC-E. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const numberSystem = code.charAt(0);
  const data = code.slice(1, 7);
  const last = data.charAt(5);
  let body: string;
  if (last <= '2') body = `${numberSystem}${data.slice(0, 2)}${last}0000${data.slice(2, 5)}`;
  else if (last === '3') body = `${numberSystem}${data.slice(0, 3)}00000${data.slice(3, 5)}`;
  else if (last === '4') body = `${numberSystem}${data.slice(0, 4)}00000${data.charAt(4)}`;
  else body = `${numberSystem}${data.slice(0, 5)}0000${last}`;
  const upcA = `${body}${code.charAt(7)}`;
  return hasValidCheckDigit(upcA) ? upcA : null;
}

/** A valid GTIN-8/12/13/14 padded to 14 digits, or null. */
export function toGtin14(code: string): string | null {
  if (!DIGITS.test(code) || ![8, 12, 13, 14].includes(code.length)) return null;
  return hasValidCheckDigit(code) ? code.padStart(14, '0') : null;
}

function isRestrictedCirculation(gtin14: string): boolean {
  if (gtin14.startsWith('000000')) {
    const ean8 = gtin14.slice(6);
    return ean8.startsWith('0') || ean8.startsWith('2');
  }
  if (!gtin14.startsWith('0')) return false;
  const ean13 = gtin14.slice(1);
  return ean13.startsWith('2') || ean13.startsWith('02') || ean13.startsWith('04');
}

function typeOf(gtin14: string): BarcodeType {
  if (isRestrictedCirculation(gtin14)) return 'UNDEFINED';
  const ean13 = gtin14.slice(1);
  if (gtin14.startsWith('0') && (ean13.startsWith('978') || ean13.startsWith('979'))) return 'ISBN';
  return 'GS1';
}

/** Typed or scanned text with whitespace removed. */
export function cleanBarcode(input: string): string {
  return input.replace(/\s+/g, '');
}

export type BarcodeProblem = 'EMPTY' | 'TOO_LONG' | 'CHARACTERS' | 'CHECK_DIGIT';

export interface ClassifiedBarcode {
  /** The code as stored: cleaned input. */
  code: string;
  gtin14: string | null;
  barcodeType: BarcodeType;
  /** Unique key of the barcode: gtin14 or the upper-cased code. */
  lookupKey: string;
}

/**
 * Validates and classifies a barcode for storage. Numeric codes of GTIN length must carry a valid
 * check digit (a wrong one is a typo: scanners verify it); an 8-digit code is read as EAN-8 first,
 * then as UPC-E.
 */
export function classifyBarcode(
  input: string,
): { ok: true; value: ClassifiedBarcode } | { ok: false; problem: BarcodeProblem } {
  const code = cleanBarcode(input);
  if (!code) return { ok: false, problem: 'EMPTY' };
  if (code.length > MAX_BARCODE_LENGTH) return { ok: false, problem: 'TOO_LONG' };
  if (!PRINTABLE.test(code)) return { ok: false, problem: 'CHARACTERS' };
  if (DIGITS.test(code) && [8, 12, 13, 14].includes(code.length)) {
    const upcA = code.length === 8 ? expandUpcE(code) : null;
    const gtin14 = toGtin14(code) ?? (upcA ? toGtin14(upcA) : null);
    if (!gtin14) return { ok: false, problem: 'CHECK_DIGIT' };
    return { ok: true, value: { code, gtin14, barcodeType: typeOf(gtin14), lookupKey: gtin14 } };
  }
  return {
    ok: true,
    value: { code, gtin14: null, barcodeType: 'UNDEFINED', lookupKey: code.toUpperCase() },
  };
}

/**
 * Every lookup key a scanned code may be stored under: an 8-digit code can be EAN-8 or UPC-E, so it
 * may yield two keys (the caller reports an ambiguity when both resolve). Empty when the code is invalid.
 */
export function lookupCandidates(input: string): string[] {
  const code = cleanBarcode(input);
  if (!code || code.length > MAX_BARCODE_LENGTH || !PRINTABLE.test(code)) return [];
  if (DIGITS.test(code) && [8, 12, 13, 14].includes(code.length)) {
    const keys = new Set<string>();
    const direct = toGtin14(code);
    if (direct) keys.add(direct);
    const upcA = code.length === 8 ? expandUpcE(code) : null;
    const expanded = upcA ? toGtin14(upcA) : null;
    if (expanded) keys.add(expanded);
    return [...keys];
  }
  return [code.toUpperCase()];
}

/** The internal EAN-13 for a sequence number: "20" + 10 digits + check digit. */
export function internalEan13(sequence: number): string {
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence >= 10 ** INTERNAL_SEQUENCE_DIGITS
  ) {
    throw new RangeError(`internal barcode sequence out of range: ${sequence}`);
  }
  const body = `${INTERNAL_BARCODE_PREFIX}${String(sequence).padStart(INTERNAL_SEQUENCE_DIGITS, '0')}`;
  return `${body}${gtinCheckDigit(body)}`;
}
