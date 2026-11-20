import {
  CodedError,
  type FieldError,
  type ProblemParams,
  registerErrorStatuses,
} from '../../common/errors/coded-error';

/**
 * The phone AI order line's own error codes (ADR-0232), registered beside Bto's catalog the way
 * printing registers its own (ADR-0226 #7): the clients show `errors.<code>` of mn.json, and the
 * bridge hands a tool's refusal to the agent by its code.
 */
export const PHONE_ERROR_HTTP_STATUS = {
  /** The station's key is missing, wrong or was replaced. */
  PHONE_KEY_INVALID: 401,
  PHONE_LINE_NOT_FOUND: 404,
  /** A call that is not there, or not this line's. */
  PHONE_CALL_NOT_FOUND: 404,
  /** The line did not answer this call: it takes no events and no tools. */
  PHONE_CALL_NOT_ANSWERED: 409,
  /** A tool call after the call ended. */
  PHONE_CALL_ENDED: 409,
  /** A tool the agent does not have. */
  PHONE_TOOL_UNKNOWN: 404,
  /** The sequence number already holds a different message. */
  PHONE_SEQ_TAKEN: 409,
  /** The caller is not one recognised store: no order and no order status, only a callback. */
  PHONE_CALLER_UNKNOWN: 409,
  /** No stage takes PHONE_AI orders (the sales settings): the agent offers a callback. */
  PHONE_AI_CLOSED: 409,
  /** The quote is not this call's latest one. */
  PHONE_QUOTE_NOT_FOUND: 409,
  /** No read-back followed by the caller's answer after the quote, or a turn is missing. */
  PHONE_ORDER_NOT_CONFIRMED: 409,
  /** This call already placed its order. */
  PHONE_ORDER_PLACED: 409,
  /** A product of the cart has no price today: the office prices it, the agent offers a callback. */
  PHONE_PRICE_MISSING: 409,
  /** A product or unit the line does not sell. */
  PHONE_PRODUCT_NOT_FOUND: 404,
  /** A delivery was asked for a store without a default address: pickup, or a callback. */
  PHONE_NO_DELIVERY_ADDRESS: 409,
  PHONE_CALLBACK_NOT_FOUND: 404,
  /** A callback that is no longer open. */
  PHONE_CALLBACK_STATE: 409,
} as const;

export type PhoneErrorCode = keyof typeof PHONE_ERROR_HTTP_STATUS;

const STATUS = registerErrorStatuses('phone-agent', PHONE_ERROR_HTTP_STATUS);

export class PhoneError extends CodedError<PhoneErrorCode> {
  constructor(
    code: PhoneErrorCode,
    detail?: string,
    params?: ProblemParams,
    errors?: FieldError[],
  ) {
    super(code, STATUS[code], detail, params, errors);
    this.name = 'PhoneError';
  }
}
