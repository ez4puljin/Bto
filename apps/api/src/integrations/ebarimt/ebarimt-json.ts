import { Decimal } from '@tugeel/shared/money';

/** A JSON number as its text: never turned into a float on the way (ADR-0228). */
export class JsonNumber {
  constructor(readonly text: string) {}
}

/**
 * JSON with every number kept as the text it was written in, so «2522.727273» reaches Decimal
 * untouched. Uses the reviver's source text (JSON.parse source text access, Node 21+).
 */
export function parseExactJson(text: string): unknown {
  return JSON.parse(text, (_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source !== undefined
      ? new JsonNumber(context.source)
      : value,
  );
}

const NUMERIC_TEXT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/**
 * An amount from an answer: a JSON number, or a string holding one. Undefined when it is not one
 * (a missing or null amount is the caller's to judge).
 */
export function exactAmount(value: unknown): Decimal | null | undefined {
  if (value === null || value === undefined) return null;
  const text =
    value instanceof JsonNumber ? value.text : typeof value === 'string' ? value.trim() : '';
  if (!NUMERIC_TEXT.test(text)) return undefined;
  return new Decimal(text);
}

/** A text field; a number written where text was expected is read as its digits. */
export function textOf(value: unknown): string | null {
  if (value instanceof JsonNumber) return value.text;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
