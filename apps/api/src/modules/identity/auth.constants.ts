// Authentication parameters (ADR-0005, ADR-0027). Change them only together with the ADR.

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const JWT_ISSUER = 'tugeel';
export const JWT_AUDIENCE = 'tugeel-api';

/** httpOnly refresh cookie `<sessionId>.<token>`, sent only to the auth routes. */
export const REFRESH_COOKIE = 'tugeel_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
/** A rotated refresh token presented again within this window is two tabs racing, not theft. */
export const REFRESH_GRACE_MS = 20_000;

/** Failed attempts (login, code redemption) per IP + username, then a wait (SPEC §5.1). */
export const LOGIN_FAILURES_PER_USER = 5;
/** Failed attempts per IP across all usernames (credential stuffing). */
export const LOGIN_FAILURES_PER_IP = 30;
export const LOGIN_WINDOW_MS = 15 * 60_000;

/** Consecutive failures that lock the account itself (backstop; an admin can unlock). */
export const ACCOUNT_LOCK_THRESHOLD = 20;
export const ACCOUNT_LOCK_MINUTES = 15;

/** One-time password codes issued by an admin (ADR-0027 #9). */
export const SETUP_CODE_TTL_MINUTES = 30;
export const SETUP_CODE_MAX_ATTEMPTS = 5;
