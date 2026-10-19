import { z } from 'zod';

/**
 * The value shapes every v1 message shares, with the v1.0 limits (docs/modules/finance-core.md §6).
 * Within 1.x a limit may only be loosened.
 */

/** A decimal amount as a string, never a JS number: up to 12 integer digits and 2 decimals. */
export type Dec = string;
/** `YYYY-MM-DD`, a calendar date in the company's timezone. */
export type IsoDate = string;

export const DEC_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;
/** Codes: tenants, companies, source systems, document types, posting keys, branches, accounts. */
export const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

export const V1_LIMITS = {
  maxRef: 128,
  maxDocNo: 60,
  maxName: 200,
  maxLabel: 120,
  maxDescription: 300,
  maxReason: 500,
  maxTaxId: 32,
  maxLines: 500,
  maxPairs: 200,
  maxSettles: 200,
  maxAttributes: 20,
  maxAttributeValue: 200,
  maxRevision: 1_000_000,
} as const;

const hasNoControlCharacter = (value: string) =>
  [...value].every((char) => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127;
  });

/** A single-line text of 1..max characters without control characters. */
export const text = (max: number) =>
  z.string().min(1).max(max).refine(hasNoControlCharacter, 'control characters are not allowed');

export const DecSchema = z.string().regex(DEC_PATTERN, 'a decimal string with at most 2 places');
/** A decimal string above zero. */
export const PositiveDecSchema = DecSchema.refine(
  (value) => !value.startsWith('-') && /[1-9]/.test(value),
  'must be greater than zero',
);
/** A decimal string of zero or more. */
export const NonNegativeDecSchema = DecSchema.refine(
  (value) => !value.startsWith('-'),
  'must not be negative',
);
export const IsoDateSchema = z.iso.date();
export const CodeSchema = z.string().regex(CODE_PATTERN, 'a code of 1-64 letters, digits, _ . : -');
/** Ids and references chosen by a source: document ids, party refs, group and item refs. */
export const RefSchema = text(V1_LIMITS.maxRef);
/** ISO 4217, three capital letters; v1 accepts only the company's functional currency (MNT). */
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'an ISO 4217 code');
export const SideSchema = z.enum(['DEBIT', 'CREDIT']);
export type Side = z.infer<typeof SideSchema>;
