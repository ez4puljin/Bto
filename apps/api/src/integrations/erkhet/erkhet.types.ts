/** `fetch` as Erkhet's client uses it; tests pass a fake. */
export type ErkhetFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The sign-in the owner typed on the settings screen, opened. */
export interface ErkhetAccount {
  /** Erkhet's address, `https://…` without a path. */
  baseUrl: string;
  username: string;
  password: string;
  /** The company inside the account: one sign-in may hold several (ADR-0203 #2). */
  companyId: string;
}

export const ERKHET_ERROR_REASONS = [
  'LOGIN_FAILED',
  'COMPANY_UNREACHABLE',
  'UNREACHABLE',
  'TIMEOUT',
  'UNEXPECTED_ANSWER',
] as const;
export type ErkhetErrorReason = (typeof ERKHET_ERROR_REASONS)[number];

/** A failed exchange with Erkhet. Carries no page, cookie, name or password. */
export class ErkhetError extends Error {
  readonly reason: ErkhetErrorReason;
  readonly status?: number;

  constructor(reason: ErkhetErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'ErkhetError';
    this.reason = reason;
    this.status = status;
  }
}

/** One of Erkhet's lists, as its own «Excel» button downloads it. */
export interface ErkhetListFile {
  data: Buffer;
  /** Bytes, for the run's record. */
  size: number;
}
