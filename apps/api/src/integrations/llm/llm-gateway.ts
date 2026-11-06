import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiUsagePurpose } from '@tugeel/shared/ai';
import { AppConfig } from '../../common/config/app-config';
import { createLlmClient, llmConfigFromEnv } from './create-llm-client';
import { checkLlm, type LlmCheck } from './llm-check';
import { LLM_CLIENT, LLM_FETCH } from './llm.tokens';
import {
  type FetchFn,
  type LlmClient,
  type LlmConfig,
  LlmError,
  type LlmErrorReason,
  type LlmRequest,
  type LlmResult,
} from './llm.types';

/** One piece of work that calls the model, for the usage page. */
export interface LlmWork {
  purpose: AiUsagePurpose;
  userId: number | null;
}

/** A call the provider answered, as the usage page counts it. */
export interface LlmCallFacts extends LlmWork {
  provider: LlmClient['provider'];
  /** The model asked for: it prices the call. */
  model: string;
  /** The model the provider says answered. */
  answeredModel: string;
  inputTokens: number;
  outputTokens: number;
}

/** The last call that failed, kept until one succeeds: the provider's code, never its text. */
export interface LlmFailure {
  reason: LlmErrorReason;
  status?: number;
  providerCode?: string;
  at: Date;
}

/**
 * What the saved settings say (ADR-0162): `off` switches the AI off whatever the environment says;
 * `config` overrides the environment; neither leaves the environment's client in force.
 */
export interface LlmSavedConnection {
  off: boolean;
  config: LlmConfig | null;
}

/** The ai module's side of the gateway, attached at start: the module sits above integrations. */
export interface LlmConnectionStore {
  saved(): Promise<LlmSavedConnection>;
  /** Refuses new work past the month's limit (an AppError). */
  assertWithinLimits(): Promise<void>;
  recordCall(facts: LlmCallFacts): Promise<void>;
}

/**
 * The model in force for every caller (ADR-0162): the connection saved on the settings screen,
 * else the environment's. Read at every call, so a saved key works at once and no process keeps an
 * old one. Work takes a metered client: the limit is checked once before it starts, and each call
 * the provider answers is counted, so a question in progress always finishes.
 */
@Injectable()
export class LlmGateway {
  private readonly logger = new Logger(LlmGateway.name);
  private store: LlmConnectionStore | null = null;
  private failure: LlmFailure | null = null;

  constructor(
    /** The client of the server's .env, in force while no connection is saved. */
    @Inject(LLM_CLIENT) readonly environment: LlmClient | null,
    @Inject(LLM_FETCH) private readonly fetchFn: FetchFn,
    private readonly config: AppConfig,
  ) {}

  attach(store: LlmConnectionStore): void {
    this.store = store;
  }

  /** The client in force, or null while the AI is off or not connected. */
  async current(): Promise<LlmClient | null> {
    const saved = await this.store?.saved();
    if (saved?.off) return null;
    if (saved?.config) return createLlmClient(saved.config, this.fetchFn);
    return this.environment;
  }

  /** The client for one piece of work; an AppError past the limit, null while the AI is off. */
  async forWork(work: LlmWork): Promise<LlmClient | null> {
    const client = await this.current();
    if (!client) return null;
    await this.store?.assertWithinLimits();
    return {
      provider: client.provider,
      model: client.model,
      complete: (request) => this.metered(client, work, request),
    };
  }

  /** The last failed call, until a later one succeeds. */
  get lastFailure(): LlmFailure | null {
    return this.failure;
  }

  /** Whether the connection in force answers: a free request that spends no tokens. */
  async check(): Promise<LlmCheck> {
    const saved = await this.store?.saved();
    if (saved?.config) return checkLlm(saved.config, this.fetchFn);
    const config = llmConfigFromEnv({
      LLM_PROVIDER: this.config.get('LLM_PROVIDER'),
      LLM_MODEL: this.config.get('LLM_MODEL'),
      LLM_API_KEY: this.config.get('LLM_API_KEY'),
      LLM_BASE_URL: this.config.get('LLM_BASE_URL'),
      LLM_TIMEOUT_MS: this.config.get('LLM_TIMEOUT_MS'),
    });
    // Only a test's scripted client has no configuration behind it.
    return config ? checkLlm(config, this.fetchFn) : { ok: true };
  }

  /** The same free request for values not saved yet. */
  checkConfig(config: LlmConfig): Promise<LlmCheck> {
    return checkLlm(config, this.fetchFn);
  }

  private async metered(client: LlmClient, work: LlmWork, request: LlmRequest): Promise<LlmResult> {
    let result: LlmResult;
    try {
      result = await client.complete(request);
    } catch (error: unknown) {
      if (error instanceof LlmError) {
        this.failure = {
          reason: error.reason,
          status: error.status,
          providerCode: error.providerCode,
          at: new Date(),
        };
      }
      throw error;
    }
    this.failure = null;
    try {
      await this.store?.recordCall({
        ...work,
        provider: client.provider,
        model: client.model,
        answeredModel: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    } catch (error: unknown) {
      // A paid answer is not thrown away because its usage row failed.
      this.logger.warn({ err: error }, 'AI usage was not recorded');
    }
    return result;
  }
}
