import type { AppProblem } from '../api/problem';
import { ubTime } from '../dates/dates';
import { PASSWORD_MIN } from './sign-in';

// The store's own words for what its sign-in, «Нууц үг тавих» and «Нууц үг солих» may answer
// (ADR-0079 #3): mn.json's `errors.*` speak of a user name and an admin, the store has a phone and
// calls the office. Any other problem keeps the shared words.

export type SignInMessageKey =
  | 'invalidCredentials'
  | 'disabled'
  | 'locked'
  | 'lockedUntil'
  | 'tooMany'
  | 'tooManyMinutes'
  | 'codeInvalid'
  | 'tooWeak';

export interface SignInMessage {
  /** Under `mobile.customer.signIn.errors`. */
  key: SignInMessageKey;
  params: Record<string, string | number>;
}

/** Whole minutes to wait, at least one. */
export function minutesOf(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/** The store's message for a problem, or null when the shared words fit. */
export function signInMessageOf(problem: AppProblem): SignInMessage | null {
  const params = problem.params ?? {};
  switch (problem.code) {
    case 'INVALID_CREDENTIALS':
      return { key: 'invalidCredentials', params: {} };
    case 'ACCOUNT_DISABLED':
      return { key: 'disabled', params: {} };
    case 'ACCOUNT_LOCKED': {
      const time = typeof params.lockedUntil === 'string' ? ubTime(params.lockedUntil) : '';
      return time ? { key: 'lockedUntil', params: { time } } : { key: 'locked', params: {} };
    }
    case 'TOO_MANY_REQUESTS': {
      const seconds = params.retryAfterSeconds;
      return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
        ? { key: 'tooManyMinutes', params: { minutes: minutesOf(seconds) } }
        : { key: 'tooMany', params: {} };
    }
    case 'PASSWORD_CODE_INVALID':
      return { key: 'codeInvalid', params: {} };
    case 'PASSWORD_TOO_WEAK':
      return {
        key: 'tooWeak',
        params: { min: typeof params.minLength === 'number' ? params.minLength : PASSWORD_MIN },
      };
    default:
      return null;
  }
}
