import type { Env } from '../../common/config/env.schema';
import { AnthropicClient } from './anthropic.client';
import type { FetchFn, LlmClient, LlmConfig } from './llm.types';
import { OllamaClient } from './ollama.client';
import { OpenAiClient } from './openai.client';

type LlmEnv = Pick<
  Env,
  'LLM_PROVIDER' | 'LLM_MODEL' | 'LLM_API_KEY' | 'LLM_BASE_URL' | 'LLM_TIMEOUT_MS'
>;

/** The client configuration, or null while LLM_PROVIDER is unset (parseEnv checked the rest). */
export function llmConfigFromEnv(env: LlmEnv): LlmConfig | null {
  if (!env.LLM_PROVIDER || !env.LLM_MODEL) return null;
  return {
    provider: env.LLM_PROVIDER,
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    baseUrl: env.LLM_BASE_URL,
    timeoutMs: env.LLM_TIMEOUT_MS,
  };
}

export function createLlmClient(
  config: LlmConfig | null,
  fetchFn: FetchFn = (url, init) => fetch(url, init),
): LlmClient | null {
  if (!config) return null;
  switch (config.provider) {
    case 'openai':
      return new OpenAiClient(config, fetchFn);
    case 'anthropic':
      return new AnthropicClient(config, fetchFn);
    case 'ollama':
      return new OllamaClient(config, fetchFn);
  }
}
