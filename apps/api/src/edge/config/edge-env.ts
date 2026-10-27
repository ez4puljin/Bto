import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EDGE_TOKEN_PATTERN } from '@tugeel/shared/pos';
import { z } from 'zod';
import { postgresUrl } from '../../common/config/env.schema';

/**
 * Environment of the store edge (ADR-0067; docs/architecture.md §10.2): its own database, the
 * centre it replays to, its node token, the key of the kiosk sessions and the PIN key it shares
 * with the centre. The process refuses to start on a missing or malformed value.
 */
export const EdgeEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Set by Compose; the edge entrypoint runs only as edge. */
  ROLE: z.literal('edge').optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().trim().min(1).default('dev'),
  /** HTTP port of the edge (3400 locally; Caddy fronts it in the store). */
  EDGE_PORT: z.coerce.number().int().min(0).max(65_535).default(3400),
  EDGE_DATABASE_URL: postgresUrl,
  EDGE_DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  /** The centre's api, e.g. https://bto.example/ or http://host.docker.internal:3300 in tests. */
  CENTRAL_API_URL: z.url({ protocol: /^https?$/ }),
  /** `tgs_<node>_<secret>` from «Супермаркет → Касс → Шинэ токен» (ADR-0063 #6). */
  EDGE_NODE_TOKEN: z.string().trim().regex(EDGE_TOKEN_PATTERN),
  /** HS256 key of the kiosk sessions (12 hours). */
  EDGE_JWT_SECRET: z.string().min(32),
  /** The cashiers' PIN key, the same value as the centre's POS_PIN_PEPPER (or its AUTH_PEPPER). */
  POS_PIN_PEPPER: z.string().min(32),
  /**
   * fake: on-screen test receipts, nothing sent to the tax office (ADR-0067); posapi: real receipts
   * from the store PosAPI at POSAPI_URL (ADR-0065).
   */
  EBARIMT_PROVIDER: z.enum(['fake', 'posapi']).default('fake'),
  /** The store PosAPI 3.0 on the LAN, e.g. http://192.168.1.254:7080 (required for posapi). */
  POSAPI_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.url({ protocol: /^http$/ }).optional(),
  ),
  /**
   * The merchant's branch number PosAPI registered this store under (digits; the old till sends
   * "01"); required with posapi: PosAPI refuses a receipt without it (2026-10-26).
   */
  EBARIMT_BRANCH_NO: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[0-9]{1,6}$/)
      .optional(),
  ),
  /** How long the till waits for PosAPI's answer before the receipt is left to be checked. */
  POSAPI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(20_000),
  /** The public taxpayer lookup (Mongolian addresses only) for a company's name at the till. */
  EBARIMT_LOOKUP_URL: z.url({ protocol: /^https?$/ }).default('https://api.ebarimt.mn'),
  /** The sync timers; tests turn them off and drive pull, push and heartbeat by hand. */
  EDGE_TIMERS: z.stringbool().default(true),
  /** How often a non-empty outbox is pushed. */
  EDGE_PUSH_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
  /**
   * ADR-0109: how long a credit sale waits for the centre's credit check before the till decides
   * from the customers it pulled last (offline).
   */
  EDGE_CREDIT_CHECK_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(3_000),
});

export type EdgeEnv = z.infer<typeof EdgeEnvSchema>;

export function parseEdgeEnv(raw: Record<string, unknown>): EdgeEnv {
  const result = EdgeEnvSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid environment (edge):\n${z.prettifyError(result.error)}`);
  }
  const data = result.data;
  // POS_PIN_PEPPER mirrors the centre's value (the centre refuses a placeholder in production), so a
  // dev centre's pepper is accepted here; the session key is the edge's own.
  if (data.NODE_ENV === 'production' && data.EDGE_JWT_SECRET.startsWith('dev-')) {
    throw new Error('Invalid environment (edge): EDGE_JWT_SECRET is a development placeholder');
  }
  if (data.EBARIMT_PROVIDER === 'posapi' && (!data.POSAPI_URL || !data.EBARIMT_BRANCH_NO)) {
    throw new Error(
      'Invalid environment (edge): EBARIMT_PROVIDER=posapi needs POSAPI_URL and EBARIMT_BRANCH_NO',
    );
  }
  return data;
}

/** Typed access to the edge's validated environment. */
@Injectable()
export class EdgeConfig {
  constructor(private readonly config: ConfigService<EdgeEnv, true>) {}

  get<K extends keyof EdgeEnv>(key: K): EdgeEnv[K] {
    return this.config.get(key, { infer: true });
  }
}
