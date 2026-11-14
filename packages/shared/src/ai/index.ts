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

/**
 * What the assistant may read for a person (ADR-0162): each group is the permission
 * `ai.data.<group>` on a role, and opens a fixed set of the `ai` views. The assistant only ever
 * reads; no setting lets it change data.
 */
export const AI_DATA_GROUPS = [
  'catalog',
  'stock',
  'customers',
  'suppliers',
  'pricing',
  'sales',
  'finance',
] as const;
export type AiDataGroup = (typeof AI_DATA_GROUPS)[number];
export const aiDataPermission = (group: AiDataGroup) => `ai.data.${group}` as const;

/** The providers a connection may use (ADR-0045 #1). */
export const AI_PROVIDERS = ['anthropic', 'openai', 'ollama'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/**
 * Models offered on the settings screen with their published prices in USD per million tokens,
 * read from the provider's pricing page on 2026-11-06. The admin may type another model and price.
 */
export const AI_MODEL_CATALOG: Readonly<
  Record<AiProvider, readonly { id: string; input: string; output: string }[]>
> = {
  anthropic: [
    { id: 'claude-opus-5-5', input: '4', output: '20' },
    { id: 'claude-sonnet-5-5', input: '2', output: '10' },
    { id: 'claude-haiku-5-5', input: '0.10', output: '0.50' },
  ],
  openai: [],
  ollama: [],
};

/** Where a model call came from on the usage page. */
export const AI_USAGE_PURPOSES = ['ASK', 'INVOICE_CHECK', 'PRODUCT_READ'] as const;
export type AiUsagePurpose = (typeof AI_USAGE_PURPOSES)[number];

/** Where the connection in force comes from: the settings screen, the server's .env, nowhere. */
export const AI_CONNECTION_SOURCES = ['SETTINGS', 'ENV', 'NONE'] as const;
export type AiConnectionSource = (typeof AI_CONNECTION_SOURCES)[number];

export const AI_CONNECTION_STATES = ['CONNECTED', 'FAILED', 'NOT_CONFIGURED', 'OFF'] as const;
export type AiConnectionState = (typeof AI_CONNECTION_STATES)[number];

/** The month's spending against its limit: none set, under 80 %, from 80 %, reached. */
export const AI_BUDGET_STATES = ['NONE', 'OK', 'WARN', 'REACHED'] as const;
export type AiBudgetState = (typeof AI_BUDGET_STATES)[number];

/** A question as typed; longer ones are refused before any model call. */
export const AI_QUESTION_MAX_LENGTH = 1_000;
export const AI_REPORT_NAME_MAX_LENGTH = 120;
/** Rows shown on screen; the reader fetches one more to know the result was cut. */
export const AI_MAX_ROWS = 500;
/** Rows of an Excel download. */
export const AI_EXPORT_MAX_ROWS = 20_000;
/** Earlier steps of a conversation the model sees with a follow-up question. */
export const AI_CONTEXT_STEPS = 5;
