import {
  CodedError,
  type FieldError,
  type ProblemParams,
  registerErrorStatuses,
} from '../../common/errors/coded-error';

/**
 * The printing module's own error codes (ADR-0226 #7), registered beside Bto's catalog the way
 * the Finance Core registers its own (ADR-0069 #7): the clients show `errors.<code>` of mn.json.
 */
export const PRINT_ERROR_HTTP_STATUS = {
  /** The caller is tied to no till as its cashier («Танд Пос тохируулаагүй байна»). */
  PRINT_NO_TILL: 403,
  /** A till the caller is not tied to. */
  PRINT_TILL_NOT_YOURS: 403,
  /** Unknown, not sold at that till, or without a price there today («Бараа олдсонгүй»). */
  PRINT_PRODUCT_NOT_FOUND: 404,
  /** More than 100 labels in one print. */
  PRINT_TOO_MANY_LABELS: 422,
  /** An unknown or disabled printer. */
  PRINT_STATION_NOT_FOUND: 404,
  /** The bridge's key is missing, wrong or of a disabled printer. */
  PRINT_KEY_INVALID: 401,
  /** A job that is not there, or not the caller's to read. */
  PRINT_JOB_NOT_FOUND: 404,
  /** A job the bridge reports on is not its own or not being printed. */
  PRINT_JOB_STATE: 409,
  /** A job's end, by code (`PrintJob.error`). */
  PRINTER_OFFLINE: 409,
  PRINTER_UNREACHABLE: 502,
  PRINTER_REFUSED: 502,
} as const;

export type PrintErrorCode = keyof typeof PRINT_ERROR_HTTP_STATUS;

const STATUS = registerErrorStatuses('printing', PRINT_ERROR_HTTP_STATUS);

export class PrintError extends CodedError<PrintErrorCode> {
  constructor(
    code: PrintErrorCode,
    detail?: string,
    params?: ProblemParams,
    errors?: FieldError[],
  ) {
    super(code, STATUS[code], detail, params, errors);
    this.name = 'PrintError';
  }
}
