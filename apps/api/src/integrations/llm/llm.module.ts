import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../common/config/app-config';
import { createLlmClient, llmConfigFromEnv } from './create-llm-client';
import type { LlmClient } from './llm.types';

/** The configured `LlmClient`, or null while the assistant is off (LLM_PROVIDER unset). */
export const LLM_CLIENT = Symbol('LLM_CLIENT');

/**
 * Imported only by the api's composition root (ADR-0045); `*-flow.service.ts` files inject the
 * client and call it between transactions (§3.1 rule 6). Tests replace it with a scripted fake.
 */
@Global()
@Module({
  providers: [
    {
      provide: LLM_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig): LlmClient | null =>
        createLlmClient(
          llmConfigFromEnv({
            LLM_PROVIDER: config.get('LLM_PROVIDER'),
            LLM_MODEL: config.get('LLM_MODEL'),
            LLM_API_KEY: config.get('LLM_API_KEY'),
            LLM_BASE_URL: config.get('LLM_BASE_URL'),
            LLM_TIMEOUT_MS: config.get('LLM_TIMEOUT_MS'),
          }),
        ),
    },
  ],
  exports: [LLM_CLIENT],
})
export class LlmModule {}
