// The AI assistant (ADR-0045): values the api and the web share. Mongolian texts live in
// i18n/mn.json under `ai.*`.

/** What the model made of a question. */
export const AI_ANSWER_KINDS = ['QUERY', 'CLARIFY', 'UNSUPPORTED'] as const;
export type AiAnswerKind = (typeof AI_ANSWER_KINDS)[number];

/**
 * How a question ended: answered with rows; the model asks back; the data is not in the system;
 * the SQL guard refused the model's query twice; the database or the model failed.
 */
export const AI_ANSWER_STATUSES = [
  'ANSWERED',
  'CLARIFY',
  'UNSUPPORTED',
  'REFUSED',
  'FAILED',
] as const;
export type AiAnswerStatus = (typeof AI_ANSWER_STATUSES)[number];

/** Why a question was REFUSED or FAILED, as people read it (mn.json `ai.reasons.*`). */
export const AI_FAILURE_REASONS = [
  'GUARD',
  'TIMEOUT',
  'RESOURCES',
  'CONNECTION',
  'DATABASE',
] as const;
export type AiFailureReason = (typeof AI_FAILURE_REASONS)[number];

/**
 * The reason behind a stored error code: a guard reason for REFUSED; for FAILED an SQLSTATE
 * (57014 statement timeout, classes 53 and 54 resources), CONNECTION, or a provider failure.
 */
export function failureReasonOf(
  status: AiAnswerStatus,
  errorCode: string | null,
): AiFailureReason | null {
  if (status === 'REFUSED') return 'GUARD';
  if (status !== 'FAILED') return null;
  if (errorCode === '57014') return 'TIMEOUT';
  if (errorCode !== null && /^5[34]/.test(errorCode)) return 'RESOURCES';
  if (errorCode === 'CONNECTION') return 'CONNECTION';
  return 'DATABASE';
}

/** A question as typed; longer ones are refused before any model call. */
export const AI_QUESTION_MAX_LENGTH = 1_000;
export const AI_REPORT_NAME_MAX_LENGTH = 120;
/** Rows shown on screen; the reader fetches one more to know the result was cut. */
export const AI_MAX_ROWS = 500;
/** Rows of an Excel download. */
export const AI_EXPORT_MAX_ROWS = 20_000;
/** Earlier steps of a conversation the model sees with a follow-up question. */
export const AI_CONTEXT_STEPS = 5;
