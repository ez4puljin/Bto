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

/** A question as typed; longer ones are refused before any model call. */
export const AI_QUESTION_MAX_LENGTH = 1_000;
export const AI_REPORT_NAME_MAX_LENGTH = 120;
/** Rows shown on screen; the reader fetches one more to know the result was cut. */
export const AI_MAX_ROWS = 500;
/** Rows of an Excel download. */
export const AI_EXPORT_MAX_ROWS = 20_000;
/** Earlier steps of a conversation the model sees with a follow-up question. */
export const AI_CONTEXT_STEPS = 5;
