import type { EbarimtApiEnvironment } from '@tugeel/shared/ebarimt-check';
import type { Decimal } from '@tugeel/shared/money';

/** `fetch` as e-Barimt's client uses it; tests pass one aimed at a fake server. */
export type EbarimtFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Where an environment answers: the purchases service and the sign-in realm. */
export interface EbarimtHosts {
  /** `https://host`, the receipts service. */
  api: string;
  /** The realm's address, `…/auth/realms/<realm>`; the token is at `/protocol/openid-connect/token`. */
  auth: string;
}

/** The tax authority's two environments (developer.itc.gov.mn). Tests give their own. */
export const EBARIMT_DEFAULT_HOSTS: Readonly<Record<EbarimtApiEnvironment, EbarimtHosts>> = {
  STAGING: {
    api: 'https://st-api.ebarimt.mn',
    auth: 'https://st.auth.itc.gov.mn/auth/realms/Staging',
  },
  PRODUCTION: {
    api: 'https://api.ebarimt.mn',
    auth: 'https://auth.itc.gov.mn/auth/realms/ITC',
  },
};

/** The connection the owner typed on the Ebarimt page, opened. */
export interface EbarimtApiAccount {
  environment: EbarimtApiEnvironment;
  username: string;
  password: string;
  /** X-API-KEY, given by the tax authority's letter. */
  apiKey: string;
  /** The company's register, `pin` of the request. */
  pin: string;
}

/** One purchase receipt as `getSaleListERP` lists it; amounts exactly as they came. */
export interface EbarimtPurchase {
  /** ДДТД. */
  ddtd: string | null;
  sellerName: string | null;
  /** The seller's register; may come with stars in it. */
  sellerRegNo: string | null;
  buyerRegNo: string | null;
  /** «YYYY-MM-DD HH:mm:ss» as printed. */
  date: string | null;
  vat: Decimal;
  cityTax: Decimal;
  total: Decimal;
  net: Decimal;
  fromType: string | null;
  receiptType: string | null;
}

export const EBARIMT_API_ERROR_REASONS = [
  'SIGN_IN_REFUSED',
  'REFUSED',
  'UNREACHABLE',
  'BAD_RESPONSE',
] as const;
export type EbarimtApiErrorReason = (typeof EBARIMT_API_ERROR_REASONS)[number];

/**
 * A failed exchange with e-Barimt. `detail` is the service's own words (its `msg`), cut short;
 * it never carries a token, a password or the key.
 */
export class EbarimtApiError extends Error {
  readonly reason: EbarimtApiErrorReason;
  readonly status: number | null;
  readonly detail: string | null;

  constructor(
    reason: EbarimtApiErrorReason,
    message: string,
    options: { status?: number | null; detail?: string | null } = {},
  ) {
    super(message);
    this.name = 'EbarimtApiError';
    this.reason = reason;
    this.status = options.status ?? null;
    this.detail = options.detail ?? null;
  }
}
