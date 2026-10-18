import { resolve } from 'node:path';
import { z } from 'zod';

export const PROCESS_ROLES = ['api', 'worker', 'edge'] as const;
export type ProcessRole = (typeof PROCESS_ROLES)[number];

export const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Providers of the AI assistant (ADR-0045); the clients live in src/integrations/llm. */
export const LLM_PROVIDERS = ['openai', 'anthropic', 'ollama'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** The read-only role of the AI assistant; provisioning creates it under this name only. */
export const AI_READER_ROLE = 'ai_reader';

/** `KEY=` in a .env file counts as unset. */
function unsetWhenEmpty<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
}

/**
 * Environment of the api and worker processes (docs/architecture.md §10.2). The process refuses to
 * start on a missing or malformed value. ADMIN_DATABASE_URL (db:provision) and TEST_ADMIN_DATABASE_URL
 * (tests) are read only by those tools, never by a running process.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Set per container in Compose; must match the entrypoint that is running. */
  ROLE: z.enum(PROCESS_ROLES).optional(),
  /**
   * HTTP port of the api (3000 in the container). Not `PORT`: dev launchers export `PORT` for the
   * web dev server. Local development uses 3300 (apps/api/.env), which the Vite proxy reads too.
   */
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Loopback health endpoint of the worker; 0 = any free port (tests). */
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Role app. */
  DATABASE_URL: postgresUrl,
  /** Role migrator; used only by src/db/migrate.ts, validated here when present. */
  MIGRATOR_DATABASE_URL: postgresUrl.optional(),
  /** Pool budget per process (docs/architecture.md §10.2): required, never defaulted. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50),
  PGBOSS_POOL_MAX: z.coerce.number().int().min(1).max(10),
  /** Image tag or git sha, reported by /health. */
  APP_VERSION: z.string().trim().min(1).default('dev'),
  /** HS256 key of the 15-minute access tokens (ADR-0027); api only. */
  JWT_SECRET: z.string().min(32).optional(),
  /** HMAC key of one-time password codes (ADR-0027); api only. */
  AUTH_PEPPER: z.string().min(32).optional(),
  /**
   * The key the cashiers' PIN hashes are salted with (ADR-0063 #6); shared by the api and the
   * store's edge, so a hash copied to the store is useless without it. Falls back to AUTH_PEPPER
   * until the owner sets it.
   */
  POS_PIN_PEPPER: z.string().min(32).optional(),
  /** `Secure` flag of the refresh cookie; defaults to true only in production (LAN http in dev). */
  COOKIE_SECURE: z.stringbool().optional(),
  /**
   * File storage (ADR-0014, ADR-0030): `local` keeps files under STORAGE_LOCAL_DIR and the api signs
   * the upload and download URLs; `spaces` arrives in the go-live phase (ADR-0026) and refuses to
   * start until then.
   */
  STORAGE_DRIVER: z.enum(['spaces', 'local']).default('spaces'),
  /** Root directory of the local driver; a relative path resolves from the working directory. */
  STORAGE_LOCAL_DIR: z.string().trim().min(1).optional(),
  /** The AI assistant (ADR-0045), api only. Without a provider the assistant is off. */
  LLM_PROVIDER: unsetWhenEmpty(z.enum(LLM_PROVIDERS)),
  LLM_MODEL: unsetWhenEmpty(z.string().trim().min(1)),
  /** A secret like JWT_SECRET: never logged, sent only to the provider. Ollama needs none. */
  LLM_API_KEY: unsetWhenEmpty(z.string().trim().min(1)),
  /** Everything before the endpoint name; each provider has a default (src/integrations/llm). */
  LLM_BASE_URL: unsetWhenEmpty(z.url({ protocol: /^https?$/ })),
  /** One model call, the answer included. */
  LLM_TIMEOUT_MS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(5_000).max(300_000).default(60_000),
  ),
  /** Role ai_reader: the assistant's queries and saved reports run only through it. */
  AI_DATABASE_URL: unsetWhenEmpty(postgresUrl),
  /** The assistant's own pool (§10.2); at most the role's CONNECTION LIMIT 4. */
  AI_POOL_MAX: unsetWhenEmpty(z.coerce.number().int().min(1).max(4)),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE' | 'STORAGE_LOCAL_DIR'> & {
  COOKIE_SECURE: boolean;
  STORAGE_LOCAL_DIR: string;
};

/** Secrets the api process cannot start without; the worker never signs or checks tokens. */
const API_SECRETS = ['JWT_SECRET', 'AUTH_PEPPER'] as const;

export function parseEnv(raw: Record<string, unknown>, role: ProcessRole): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment (${role}):\n${z.prettifyError(result.error)}`);
  }
  const data = result.data;
  if (data.ROLE && data.ROLE !== role) {
    throw new Error(`ROLE=${data.ROLE} but this is the ${role} entrypoint`);
  }
  if (role === 'api') {
    for (const key of API_SECRETS) {
      const value = data[key];
      if (!value) throw new Error(`Invalid environment (api): ${key} is required`);
      if (data.NODE_ENV === 'production' && value.startsWith('dev-')) {
        throw new Error(`Invalid environment (api): ${key} is a development placeholder`);
      }
    }
    // The tills' PIN key (ADR-0063 #6) is optional, but never a placeholder in production.
    if (data.NODE_ENV === 'production' && data.POS_PIN_PEPPER?.startsWith('dev-')) {
      throw new Error('Invalid environment (api): POS_PIN_PEPPER is a development placeholder');
    }
  }
  if (data.STORAGE_DRIVER === 'spaces') {
    throw new Error(
      `Invalid environment (${role}): STORAGE_DRIVER=spaces arrives in the go-live phase (ADR-0026); set STORAGE_DRIVER=local`,
    );
  }
  if (!data.STORAGE_LOCAL_DIR) {
    throw new Error(
      `Invalid environment (${role}): STORAGE_LOCAL_DIR is required when STORAGE_DRIVER=local`,
    );
  }
  if (role === 'api') assertAiAssistant(data);
  return {
    ...data,
    COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production',
    STORAGE_LOCAL_DIR: resolve(data.STORAGE_LOCAL_DIR),
  };
}

/**
 * The assistant is on when LLM_PROVIDER is set; it then needs its model, key (not Ollama) and
 * read-only database. AI_DATABASE_URL alone runs saved reports, which need no model.
 */
function assertAiAssistant(data: z.infer<typeof EnvSchema>): void {
  if (data.LLM_PROVIDER) {
    const missing = [
      !data.LLM_MODEL && 'LLM_MODEL',
      data.LLM_PROVIDER !== 'ollama' && !data.LLM_API_KEY && 'LLM_API_KEY',
      !data.AI_DATABASE_URL && 'AI_DATABASE_URL',
    ].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Invalid environment (api): LLM_PROVIDER=${data.LLM_PROVIDER} needs ${missing.join(', ')}`,
      );
    }
  }
  if (!data.AI_DATABASE_URL) return;
  if (decodeURIComponent(new URL(data.AI_DATABASE_URL).username) !== AI_READER_ROLE) {
    throw new Error(`Invalid environment (api): AI_DATABASE_URL must connect as ${AI_READER_ROLE}`);
  }
  if (!data.AI_POOL_MAX) {
    throw new Error('Invalid environment (api): AI_POOL_MAX is required with AI_DATABASE_URL');
  }
}
