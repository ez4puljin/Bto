import { Injectable, Logger, type OnModuleInit, Inject } from '@nestjs/common';
import {
  AI_MODEL_CATALOG,
  type AiBudgetState,
  type AiConnectionSource,
  type AiConnectionState,
  type AiProvider,
} from '@tugeel/shared/ai';
import { Decimal } from '@tugeel/shared/money';
import { eq, sql } from 'drizzle-orm';
import { AppConfig } from '../../../common/config/app-config';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import {
  type LlmCallFacts,
  type LlmCheck,
  type LlmConnectionStore,
  LlmGateway,
  type LlmSavedConnection,
} from '../../../integrations/llm';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { aiSettings } from '../schema';
import { AiReaderService } from '../sql/ai-reader.service';
import {
  AiLimitsService,
  type AiSettingsRow,
  type AiUsageByUser,
  type AiUsageTotals,
  budgetStateOf,
  priceOf,
} from './ai-limits.service';
import { openSecret, sealSecret } from './secret-box';

const KEY_HINT_LENGTH = 4;
/** The free check of the connection is not repeated more often, unless someone asks. */
const CHECK_TTL_MS = 5 * 60_000;

export interface AiSettingsView {
  source: AiConnectionSource;
  enabled: boolean;
  provider: AiProvider | null;
  model: string | null;
  baseUrl: string | null;
  /** The saved key's last characters; the key itself never leaves the server. */
  keyHint: string | null;
  /** A saved key that AI_KEY_SECRET no longer opens. */
  keyUnreadable: boolean;
  /** AI_KEY_SECRET is set, so a key can be saved here. */
  secretReady: boolean;
  /** AI_DATABASE_URL is set, so questions can run. */
  readerReady: boolean;
  priceInputPerMtok: string | null;
  priceOutputPerMtok: string | null;
  monthlyBudgetUsd: string | null;
  userDailyQuestions: number | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface AiSettingsInput {
  enabled?: boolean;
  provider?: AiProvider | null;
  model?: string | null;
  baseUrl?: string | null;
  apiKey?: string;
  priceInputPerMtok?: string | null;
  priceOutputPerMtok?: string | null;
  monthlyBudgetUsd?: string | null;
  userDailyQuestions?: number | null;
}

export interface AiCheckInput {
  provider?: AiProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface AiConnectionView {
  state: AiConnectionState;
  source: AiConnectionSource;
  provider: AiProvider | null;
  model: string | null;
  /** Why the check failed: an LlmError reason, or KEY_UNREADABLE. */
  reason: string | null;
  status: number | null;
  providerCode: string | null;
  checkedAt: Date | null;
  /** The last model call that failed, until a later one succeeds. */
  lastFailure: {
    reason: string;
    status: number | null;
    providerCode: string | null;
    at: Date;
  } | null;
}

export interface AiUsageView {
  connection: AiConnectionView;
  today: AiUsageTotals;
  month: AiUsageTotals;
  budget: { state: AiBudgetState; limitUsd: string | null; spentUsd: string };
  byUser: AiUsageByUser[];
  userDailyQuestions: number | null;
}

/**
 * The AI's connection on the settings screen (ADR-0162, supersedes ADR-0045 #10 on where a key
 * lives): saved, sealed and in force at once, or left to the server's .env. It answers the gateway
 * for every model call and is a flow service because the check calls the provider, between
 * transactions. The key goes only to its provider's own address and never into a response, an
 * audit row or a log.
 */
@Injectable()
export class AiSettingsFlowService implements OnModuleInit, LlmConnectionStore {
  private readonly logger = new Logger(AiSettingsFlowService.name);
  private checked: { at: Date; result: LlmCheck } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
    private readonly gateway: LlmGateway,
    private readonly limits: AiLimitsService,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly reader: AiReaderService,
  ) {}

  onModuleInit(): void {
    this.gateway.attach(this);
  }

  // ---------------------------------------------------------------------------------------------
  // The gateway's side

  async saved(): Promise<LlmSavedConnection> {
    const row = await this.limits.settings();
    if (!row) return { off: false, config: null };
    if (!row.enabled) return { off: true, config: null };
    if (!row.provider || !row.model) return { off: false, config: null };
    const apiKey = this.keyOf(row);
    if (apiKey === null) {
      this.logger.error('the saved AI key cannot be opened: check AI_KEY_SECRET');
      return { off: true, config: null };
    }
    return {
      off: false,
      config: {
        provider: row.provider,
        model: row.model,
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
        timeoutMs: this.config.get('LLM_TIMEOUT_MS'),
      },
    };
  }

  assertWithinLimits(): Promise<void> {
    return this.limits.assertWithinBudget();
  }

  recordCall(facts: LlmCallFacts): Promise<void> {
    return this.limits.record({
      purpose: facts.purpose,
      userId: facts.userId,
      provider: facts.provider,
      model: facts.model,
      inputTokens: facts.inputTokens,
      outputTokens: facts.outputTokens,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // The settings screen

  async view(): Promise<AiSettingsView> {
    return this.viewOf(await this.limits.settings());
  }

  async update(actor: AuthContext, input: AiSettingsInput): Promise<AiSettingsView> {
    const secret = this.config.get('AI_KEY_SECRET');
    if (input.apiKey !== undefined && !secret) {
      throw new AppError('AI_KEY_SECRET_MISSING', 'AI_KEY_SECRET is not set on the server');
    }
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx.select().from(aiSettings).where(eq(aiSettings.id, 1)).for('update');
      const next = this.merged(before ?? null, input, secret);
      if (before) {
        await tx
          .update(aiSettings)
          .set({ ...next, updatedBy: actor.userId, updatedAt: sql`now()` })
          .where(eq(aiSettings.id, 1));
      } else {
        await tx.insert(aiSettings).values({ id: 1, ...next, updatedBy: actor.userId });
      }
      await this.audit.record(tx, actor, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'ai_settings',
        entityId: 1,
        ...(before ? { before: facts(before) } : {}),
        after: { ...facts(next), keyChanged: input.apiKey !== undefined },
      });
    });
    this.checked = null;
    return this.view();
  }

  /** The saved row after a change; every rule of a connection is checked here. */
  private merged(
    before: AiSettingsRow | null,
    input: AiSettingsInput,
    secret: string | undefined,
  ): Omit<AiSettingsRow, 'id' | 'updatedBy' | 'updatedAt'> {
    const provider = input.provider === undefined ? (before?.provider ?? null) : input.provider;
    const providerChanged = provider !== (before?.provider ?? null);
    const model = provider === null ? null : (input.model ?? before?.model ?? null);
    const modelChanged = model !== (before?.model ?? null);
    if (provider && !model) throw invalid('model', 'required', 'a provider needs its model');

    // A key never follows a connection to another provider.
    let apiKeySealed = providerChanged ? null : (before?.apiKeySealed ?? null);
    let apiKeyHint = providerChanged ? null : (before?.apiKeyHint ?? null);
    if (input.apiKey !== undefined) {
      if (!provider) throw invalid('apiKey', 'provider', 'a key needs its provider');
      if (!secret) throw new AppError('AI_KEY_SECRET_MISSING', 'AI_KEY_SECRET is not set');
      apiKeySealed = sealSecret(input.apiKey, secret);
      apiKeyHint = input.apiKey.slice(-KEY_HINT_LENGTH);
    }
    if (provider === null || provider === 'ollama') {
      apiKeySealed = null;
      apiKeyHint = null;
    } else if (!apiKeySealed) {
      throw invalid('apiKey', 'required', 'this provider needs a key');
    }

    // An address typed here is only for a key-less local server.
    const baseUrl = provider === 'ollama' ? (input.baseUrl ?? before?.baseUrl ?? null) : null;

    const prices = this.pricesOf(before, input, provider, model, providerChanged || modelChanged);
    const monthlyBudgetUsd =
      input.monthlyBudgetUsd === undefined
        ? (before?.monthlyBudgetUsd ?? null)
        : input.monthlyBudgetUsd === null
          ? null
          : new Decimal(input.monthlyBudgetUsd);
    if (monthlyBudgetUsd) this.assertPriced(provider, model, prices);

    return {
      enabled: input.enabled ?? before?.enabled ?? true,
      provider,
      model,
      baseUrl,
      apiKeySealed,
      apiKeyHint,
      ...prices,
      monthlyBudgetUsd,
      userDailyQuestions:
        input.userDailyQuestions === undefined
          ? (before?.userDailyQuestions ?? null)
          : input.userDailyQuestions,
    };
  }

  private pricesOf(
    before: AiSettingsRow | null,
    input: AiSettingsInput,
    provider: AiProvider | null,
    model: string | null,
    changed: boolean,
  ): Pick<AiSettingsRow, 'priceInputPerMtok' | 'priceOutputPerMtok'> {
    const given = (value: string | null | undefined, kept: Decimal | null): Decimal | null => {
      if (value === undefined) return changed ? null : kept;
      return value === null ? null : new Decimal(value);
    };
    const priceInputPerMtok = given(input.priceInputPerMtok, before?.priceInputPerMtok ?? null);
    const priceOutputPerMtok = given(input.priceOutputPerMtok, before?.priceOutputPerMtok ?? null);
    if (!provider || !model) return { priceInputPerMtok: null, priceOutputPerMtok: null };
    if ((priceInputPerMtok === null) !== (priceOutputPerMtok === null)) {
      throw invalid('priceOutputPerMtok', 'both', 'enter both prices or neither');
    }
    return { priceInputPerMtok, priceOutputPerMtok };
  }

  /** A month's limit cannot stop what has no price: refused while saving, not found out later. */
  private assertPriced(
    provider: AiProvider | null,
    model: string | null,
    prices: Pick<AiSettingsRow, 'priceInputPerMtok' | 'priceOutputPerMtok'>,
  ): void {
    const environment = this.gateway.environment;
    const inForce =
      provider && model
        ? { provider, model }
        : environment
          ? { provider: environment.provider, model: environment.model }
          : null;
    if (!inForce) return;
    const known =
      Boolean(prices.priceInputPerMtok) ||
      inForce.provider === 'ollama' ||
      AI_MODEL_CATALOG[inForce.provider].some((entry) => entry.id === inForce.model);
    if (!known) {
      throw new AppError('AI_PRICE_REQUIRED', 'a month limit needs the price of the model');
    }
  }

  /** Tries typed values (not saved yet), or the connection in force when none are given. */
  async test(input: AiCheckInput): Promise<LlmCheck> {
    if (!input.provider) {
      return (await this.gateway.current())
        ? this.gateway.check()
        : { ok: false, reason: 'NETWORK' };
    }
    if (!input.model) throw invalid('model', 'required', 'a provider needs its model');
    return this.gateway.checkConfig({
      provider: input.provider,
      model: input.model,
      ...(await this.keyForTest(input)),
      // A saved key is never sent to an address typed here: only Ollama takes one, and no key.
      ...(input.provider === 'ollama' && input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      timeoutMs: this.config.get('LLM_TIMEOUT_MS'),
    });
  }

  private async keyForTest(input: AiCheckInput): Promise<{ apiKey?: string }> {
    if (input.provider === 'ollama') return {};
    if (input.apiKey) return { apiKey: input.apiKey };
    const row = await this.limits.settings();
    if (row && row.provider === input.provider) {
      const apiKey = this.keyOf(row);
      if (apiKey) return { apiKey };
    }
    const environment = this.config.get('LLM_API_KEY');
    return environment && this.config.get('LLM_PROVIDER') === input.provider
      ? { apiKey: environment }
      : {};
  }

  // ---------------------------------------------------------------------------------------------
  // The status page

  async usage(fresh: boolean): Promise<AiUsageView> {
    const row = await this.limits.settings();
    const [today, month, spent, byUser, connection] = [
      await this.limits.totalsToday(),
      await this.limits.totalsThisMonth(),
      await this.limits.spentThisMonth(),
      await this.limits.byUserThisMonth(),
      await this.connection(row, fresh),
    ];
    const limit = row?.monthlyBudgetUsd ?? null;
    return {
      connection,
      today,
      month,
      budget: {
        state: budgetStateOf(limit, spent),
        limitUsd: limit ? limit.toFixed(2) : null,
        spentUsd: spent.toFixed(6),
      },
      byUser,
      userDailyQuestions: row?.userDailyQuestions ?? null,
    };
  }

  private async connection(row: AiSettingsRow | null, fresh: boolean): Promise<AiConnectionView> {
    const client = await this.gateway.current();
    const source = this.sourceOf(row);
    const failure = this.gateway.lastFailure;
    const base = {
      source,
      provider: client?.provider ?? row?.provider ?? null,
      model: client?.model ?? row?.model ?? null,
      reason: null,
      status: null,
      providerCode: null,
      checkedAt: null,
      lastFailure: failure
        ? {
            reason: failure.reason,
            status: failure.status ?? null,
            providerCode: failure.providerCode ?? null,
            at: failure.at,
          }
        : null,
    };
    if (row && !row.enabled) return { ...base, state: 'OFF' };
    if (row && this.keyOf(row) === null) {
      return { ...base, state: 'FAILED', reason: 'KEY_UNREADABLE' };
    }
    if (!client || !this.reader.configured) return { ...base, state: 'NOT_CONFIGURED' };
    const { at, result } = await this.checkedNow(fresh);
    return result.ok
      ? { ...base, state: 'CONNECTED', checkedAt: at }
      : {
          ...base,
          state: 'FAILED',
          reason: result.reason,
          status: result.status ?? null,
          providerCode: result.providerCode ?? null,
          checkedAt: at,
        };
  }

  private async checkedNow(fresh: boolean): Promise<{ at: Date; result: LlmCheck }> {
    const last = this.checked;
    if (!fresh && last && Date.now() - last.at.getTime() < CHECK_TTL_MS) return last;
    const result = { at: new Date(), result: await this.gateway.check() };
    this.checked = result;
    return result;
  }

  // ---------------------------------------------------------------------------------------------

  /** undefined: no key is saved; null: one is saved and AI_KEY_SECRET does not open it. */
  private keyOf(row: AiSettingsRow): string | null | undefined {
    if (!row.apiKeySealed) return undefined;
    const secret = this.config.get('AI_KEY_SECRET');
    return secret ? openSecret(row.apiKeySealed, secret) : null;
  }

  private sourceOf(row: AiSettingsRow | null): AiConnectionSource {
    if (row?.provider) return 'SETTINGS';
    return this.gateway.environment ? 'ENV' : 'NONE';
  }

  private async viewOf(row: AiSettingsRow | null): Promise<AiSettingsView> {
    const source = this.sourceOf(row);
    const environment = this.gateway.environment;
    const inForce = row?.provider
      ? { provider: row.provider, model: row.model }
      : environment
        ? { provider: environment.provider, model: environment.model }
        : { provider: null, model: null };
    const price =
      inForce.provider && inForce.model ? priceOf(row, inForce.provider, inForce.model) : null;
    const names = row?.updatedBy ? await this.names.namesOf([row.updatedBy]) : null;
    return {
      source,
      enabled: row?.enabled ?? true,
      provider: inForce.provider,
      model: inForce.model,
      baseUrl: row?.baseUrl ?? null,
      keyHint: row?.apiKeyHint ?? null,
      keyUnreadable: row ? this.keyOf(row) === null : false,
      secretReady: Boolean(this.config.get('AI_KEY_SECRET')),
      readerReady: this.reader.configured,
      priceInputPerMtok: price ? price.input.toString() : null,
      priceOutputPerMtok: price ? price.output.toString() : null,
      monthlyBudgetUsd: row?.monthlyBudgetUsd ? row.monthlyBudgetUsd.toFixed(2) : null,
      userDailyQuestions: row?.userDailyQuestions ?? null,
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ? (names?.get(row.updatedBy) ?? null) : null,
    };
  }
}

/** What an audit row keeps of the settings: never the sealed key or its last characters. */
function facts(row: Omit<AiSettingsRow, 'id' | 'updatedBy' | 'updatedAt'>) {
  return {
    enabled: row.enabled,
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    hasKey: row.apiKeySealed !== null,
    priceInputPerMtok: row.priceInputPerMtok?.toString() ?? null,
    priceOutputPerMtok: row.priceOutputPerMtok?.toString() ?? null,
    monthlyBudgetUsd: row.monthlyBudgetUsd?.toString() ?? null,
    userDailyQuestions: row.userDailyQuestions,
  };
}
