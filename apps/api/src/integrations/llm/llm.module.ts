import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../common/config/app-config';
import { createLlmClient, llmConfigFromEnv } from './create-llm-client';
import { LlmGateway } from './llm-gateway';
import { LLM_CLIENT, LLM_FETCH } from './llm.tokens';
import type { FetchFn, LlmClient } from './llm.types';

export { LLM_CLIENT, LLM_FETCH };

/**
 * Imported only by the api's composition root (ADR-0045); `*-flow.service.ts` files inject
 * `LlmGateway` and call the model between transactions (§3.1 rule 6). Tests replace LLM_CLIENT with
 * a scripted fake and LLM_FETCH with a scripted fetch.
 */
@Global()
@Module({
  providers: [
    {
      provide: LLM_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies FetchFn,
    },
    {
      provide: LLM_CLIENT,
      inject: [AppConfig, LLM_FETCH],
      useFactory: (config: AppConfig, fetchFn: FetchFn): LlmClient | null =>
        createLlmClient(
          llmConfigFromEnv({
            LLM_PROVIDER: config.get('LLM_PROVIDER'),
            LLM_MODEL: config.get('LLM_MODEL'),
            LLM_API_KEY: config.get('LLM_API_KEY'),
            LLM_BASE_URL: config.get('LLM_BASE_URL'),
            LLM_TIMEOUT_MS: config.get('LLM_TIMEOUT_MS'),
          }),
          fetchFn,
        ),
    },
    LlmGateway,
  ],
  exports: [LLM_CLIENT, LlmGateway],
})
export class LlmModule {}
