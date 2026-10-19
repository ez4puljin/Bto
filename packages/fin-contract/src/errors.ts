/**
 * The Finance Core's stable error codes (docs/modules/finance-core.md §7). Within 1.x codes are only
 * added, on the server first; a sender treats a code it does not know as permanent. Their HTTP
 * statuses live in the core's error registry (apps/api/src/finance-core/errors.ts).
 */
export const FIN_ERROR_CODES = [
  // Envelope and access
  'FIN_PAYLOAD_INVALID',
  'FIN_CONTRACT_UNSUPPORTED',
  'FIN_COMPANY_UNKNOWN',
  'FIN_COMPANY_FORBIDDEN',
  'FIN_SOURCE_NOT_GRANTED',
  'FIN_SOURCE_MISMATCH',
  'FIN_DOCTYPE_UNKNOWN',
  'FIN_CLASS_RULE',
  // Amounts
  'FIN_CURRENCY_UNSUPPORTED',
  'FIN_AMOUNT_PRECISION',
  'FIN_TOTAL_MISMATCH',
  'FIN_UNBALANCED',
  // Mapping
  'FIN_MAPPING_MISSING',
  'FIN_ACCOUNT_INACTIVE',
  'FIN_PARTY_REQUIRED',
  'FIN_MONEY_ACCOUNT_REQUIRED',
  'FIN_TAX_CODE_UNKNOWN',
  'FIN_TAX_MISMATCH',
  // Items, allocations, reversals
  'FIN_SETTLE_TARGET_NOT_FOUND',
  'FIN_OVER_ALLOCATION',
  'FIN_REVERSAL_BLOCKED',
  'FIN_REVISION_NOT_ALLOWED',
  'FIN_FUTURE_DATE',
  // Identity of a document
  'FIN_PAYLOAD_CONFLICT',
  'FIN_SOURCE_COMPANY_MISMATCH',
  // Periods and approvals (all but the first from P5)
  'FIN_PERIOD_CLOSED',
  'FIN_PERIOD_NOT_ENDED',
  'FIN_PERIOD_ORDER',
  'FIN_CHECKLIST_FAILED',
  'FIN_APPROVER_IS_SUBMITTER',
  // Dependencies (from A1)
  'FIN_DEPENDENCY_MISSING',
  // Retryable: a lock timeout or a serialization failure
  'FIN_BUSY',
] as const;
export type FinErrorCode = (typeof FIN_ERROR_CODES)[number];

export function isFinErrorCode(value: unknown): value is FinErrorCode {
  return typeof value === 'string' && (FIN_ERROR_CODES as readonly string[]).includes(value);
}

/** The only codes a sender retries with backoff; every other refusal is final for that payload. */
export const FIN_RETRYABLE_CODES = ['FIN_BUSY'] as const satisfies readonly FinErrorCode[];

/** Refusals that time or the accountant cures: HELD when asynchronous (ADR-0071 #3). */
export const FIN_HELD_CODES = [
  'FIN_PERIOD_CLOSED',
  'FIN_DEPENDENCY_MISSING',
] as const satisfies readonly FinErrorCode[];
