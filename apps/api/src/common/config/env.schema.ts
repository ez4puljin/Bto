import { z } from 'zod';

export const PROCESS_ROLES = ['api', 'worker'] as const;
export type ProcessRole = (typeof PROCESS_ROLES)[number];

export const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/**
 * Environment of the api and worker processes (docs/architecture.md §10.2). The process refuses to
 * start on a missing or malformed value. ADMIN_DATABASE_URL (db:provision) and TEST_ADMIN_DATABASE_URL
 * (tests) are read only by those tools, never by a running process.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Set per container in Compose; must match the entrypoint that is running. */
  ROLE: z.enum(PROCESS_ROLES).optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
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
  /** `Secure` flag of the refresh cookie; defaults to true only in production (LAN http in dev). */
  COOKIE_SECURE: z.stringbool().optional(),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

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
  }
  return { ...data, COOKIE_SECURE: data.COOKIE_SECURE ?? data.NODE_ENV === 'production' };
}
