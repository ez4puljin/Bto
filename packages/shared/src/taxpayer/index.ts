/**
 * Mongolian taxpayer identifiers of customers and suppliers (SPEC §4, §6.10, ADR-0017): the
 * registration number (регистр), the TIN (ТТД) and a citizen's e-Barimt consumer number. The
 * database checks only the formats receipts rely on; the kind-specific rules live here so the API,
 * the web forms and the Excel import preview apply the same ones (ADR-0015 #2).
 */
export const CUSTOMER_KINDS = ['COMPANY', 'INDIVIDUAL'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

/** Stored TIN: 11 digits for a company, 12–14 for a citizen (PosAPI `customerTin`). */
export const TIN_PATTERN = /^[0-9]{11,14}$/;
/** A citizen's e-Barimt consumer number (`consumerNo`): 8 digits. */
export const CONSUMER_NO_PATTERN = /^[0-9]{8}$/;
export const REG_NO_MAX_LENGTH = 20;

const COMPANY_REG_NO = /^[0-9]{7}$/;
const CITIZEN_REG_NO = /^[А-ЯЁӨҮ]{2}[0-9]{8}$/;

/** Upper-case Latin letters typed for their Cyrillic look-alikes (citizen IDs use Cyrillic). */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};

/**
 * A registration number as stored: NFKC, spaces removed, upper case, Latin look-alikes as Cyrillic.
 * It stays free text otherwise (SPEC §5.3): a company number is 7 digits, a citizen's 2 Cyrillic
 * letters and 8 digits, but older or foreign numbers exist.
 */
export function normalizeRegNo(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[ABCEHKMOPTXY]/g, (letter) => LOOK_ALIKES[letter] ?? letter);
}

/** Which kind of customer a registration number looks like, or null when it fits neither. */
export function regNoShape(value: string): CustomerKind | null {
  const regNo = normalizeRegNo(value);
  if (COMPANY_REG_NO.test(regNo)) return 'COMPANY';
  if (CITIZEN_REG_NO.test(regNo)) return 'INDIVIDUAL';
  return null;
}

/** A TIN or consumer number as typed: spaces and dashes removed. */
export function cleanTaxNumber(value: string): string {
  return value.replace(/[\s-]+/g, '');
}

/** Whether a TIN fits a customer of this kind: 11 digits for a company, 12–14 for a citizen. */
export function isTinFor(kind: CustomerKind, tin: string): boolean {
  if (!TIN_PATTERN.test(tin)) return false;
  return kind === 'COMPANY' ? tin.length === 11 : tin.length >= 12;
}

export function isConsumerNo(value: string): boolean {
  return CONSUMER_NO_PATTERN.test(value);
}
