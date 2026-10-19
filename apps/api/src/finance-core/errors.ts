import type { FinErrorCode } from '@tugeel/fin-contract';
import {
  CodedError,
  type ErrorStatusTable,
  type FieldError,
  type ProblemParams,
  registerErrorStatuses,
} from '../common/errors/coded-error';

/**
 * The HTTP status of every FIN_* code (docs/modules/finance-core.md §7), registered beside Bto's
 * catalog (ADR-0069 #7); a new code without a status fails typecheck. Provisional until the phase
 * that first raises each code. Over HTTP (A2) an unknown, forbidden or ungranted company is always
 * answered 404 FIN_COMPANY_UNKNOWN.
 */
export const FIN_ERROR_HTTP_STATUS: ErrorStatusTable<FinErrorCode> = registerErrorStatuses(
  'finance-core',
  {
    FIN_PAYLOAD_INVALID: 422,
    FIN_CONTRACT_UNSUPPORTED: 422,
    FIN_COMPANY_UNKNOWN: 404,
    FIN_COMPANY_FORBIDDEN: 403,
    FIN_SOURCE_NOT_GRANTED: 403,
    FIN_SOURCE_MISMATCH: 403,
    FIN_DOCTYPE_UNKNOWN: 422,
    FIN_CLASS_RULE: 422,
    FIN_CURRENCY_UNSUPPORTED: 422,
    FIN_AMOUNT_PRECISION: 422,
    FIN_TOTAL_MISMATCH: 422,
    FIN_UNBALANCED: 422,
    FIN_MAPPING_MISSING: 422,
    FIN_ACCOUNT_INACTIVE: 409,
    FIN_PARTY_REQUIRED: 422,
    FIN_MONEY_ACCOUNT_REQUIRED: 422,
    FIN_TAX_CODE_UNKNOWN: 422,
    FIN_TAX_MISMATCH: 422,
    FIN_SETTLE_TARGET_NOT_FOUND: 422,
    FIN_OVER_ALLOCATION: 422,
    FIN_REVERSAL_BLOCKED: 409,
    FIN_REVISION_NOT_ALLOWED: 409,
    FIN_FUTURE_DATE: 422,
    FIN_PAYLOAD_CONFLICT: 409,
    FIN_SOURCE_COMPANY_MISMATCH: 409,
    FIN_PERIOD_CLOSED: 409,
    FIN_PERIOD_NOT_ENDED: 409,
    FIN_PERIOD_ORDER: 409,
    FIN_CHECKLIST_FAILED: 409,
    FIN_APPROVER_IS_SUBMITTER: 409,
    FIN_DEPENDENCY_MISSING: 409,
    FIN_BUSY: 503,
  },
);

/**
 * What the core throws for an expected refusal; in-process every non-POSTED outcome becomes one, so
 * the caller's transaction rolls back (ADR-0071 #8). Renders as problem+json like Bto's `AppError`.
 */
export class FinError extends CodedError<FinErrorCode> {
  constructor(code: FinErrorCode, detail?: string, params?: ProblemParams, errors?: FieldError[]) {
    super(code, FIN_ERROR_HTTP_STATUS[code], detail, params, errors);
    this.name = 'FinError';
  }
}
