import { z } from 'zod';
import { ANTHROPIC_BASE_URL, ANTHROPIC_VERSION } from './anthropic.client';
import { endpoint, getJson } from './http';
import { type FetchFn, type LlmConfig, LlmError, type LlmErrorReason } from './llm.types';
import { OLLAMA_BASE_URL } from './ollama.client';
import { OPENAI_BASE_URL } from './openai.client';

const CHECK_TIMEOUT_MS = 10_000;

const OllamaTags = z.object({ models: z.array(z.object({ name: z.string() })) });

export type LlmCheck =
  { ok: true } | { ok: false; reason: LlmErrorReason; status?: number; providerCode?: string };

/**
 * Asks the provider about the configured model (ADR-0162): this proves the address, the key and
 * the model, and spends no tokens. A provider has no call for the credit left on an account.
 */
export async function checkLlm(config: LlmConfig, fetchFn: FetchFn): Promise<LlmCheck> {
  try {
    await ask(config, fetchFn);
    return { ok: true };
  } catch (error: unknown) {
    if (!(error instanceof LlmError)) throw error;
    return {
      ok: false,
      reason: error.reason,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
    };
  }
}

async function ask(config: LlmConfig, fetchFn: FetchFn): Promise<void> {
  const model = encodeURIComponent(config.model);
  switch (config.provider) {
    case 'anthropic':
      await getJson(
        fetchFn,
        endpoint(config.baseUrl ?? ANTHROPIC_BASE_URL, `models/${model}`),
        { 'x-api-key': config.apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION },
        CHECK_TIMEOUT_MS,
        z.unknown(),
      );
      return;
    case 'openai':
      await getJson(
        fetchFn,
        endpoint(config.baseUrl ?? OPENAI_BASE_URL, `models/${model}`),
        { authorization: `Bearer ${config.apiKey ?? ''}` },
        CHECK_TIMEOUT_MS,
        z.unknown(),
      );
      return;
    case 'ollama': {
      const tags = await getJson(
        fetchFn,
        endpoint(config.baseUrl ?? OLLAMA_BASE_URL, 'tags'),
        {},
        CHECK_TIMEOUT_MS,
        OllamaTags,
      );
      const found = tags.models.some(
        ({ name }) => name === config.model || name === `${config.model}:latest`,
      );
      if (!found) {
        throw new LlmError('HTTP', 'the model is not on this Ollama server', { status: 404 });
      }
    }
  }
}
