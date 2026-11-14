/** `fetch` as the background service's client uses it; tests pass a fake. */
export type PictureFetch = (url: string, init: RequestInit) => Promise<Response>;

/** A photo as it is sent to the service: the bytes with their media type. */
export interface PicturePhoto {
  data: Buffer;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** The photo's subject on a transparent background. */
export interface CutOut {
  png: Buffer;
  /** What the service says the call cost, as it wrote it (credits may have decimals). */
  creditsCharged: string | null;
}

/** What the service says of the account behind a key; null where it did not say. */
export interface PictureAccount {
  credits: string | null;
  freeCalls: number | null;
}

/** A service that removes the background of a photo (ADR-0198). */
export interface BackgroundRemover {
  readonly provider: 'removebg';
  cutOut(photo: PicturePhoto): Promise<CutOut>;
  /** A free request that tells whether the key works and what is left on the account. */
  account(): Promise<PictureAccount>;
}

export const PICTURE_ERROR_REASONS = ['TIMEOUT', 'NETWORK', 'HTTP', 'INVALID_RESPONSE'] as const;
export type PictureErrorReason = (typeof PICTURE_ERROR_REASONS)[number];

/**
 * A failed call of the background service. Carries no request or response body; `providerCode` is
 * the service's short code (`auth_failed`, `insufficient_credits`, …) when it sends one.
 */
export class PictureError extends Error {
  readonly reason: PictureErrorReason;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    reason: PictureErrorReason,
    message: string,
    details: { status?: number; providerCode?: string } = {},
  ) {
    super(message);
    this.name = 'PictureError';
    this.reason = reason;
    this.status = details.status;
    this.providerCode = details.providerCode;
  }
}
