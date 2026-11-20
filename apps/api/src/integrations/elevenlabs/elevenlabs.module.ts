import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../common/config/app-config';
import { elevenLabsConfigFromEnv } from './elevenlabs.config';
import { ElevenLabsGateway } from './elevenlabs.gateway';
import { ELEVENLABS_CONFIG, ELEVENLABS_FETCH } from './elevenlabs.tokens';
import type { ElevenLabsConfig, ElevenLabsFetch } from './elevenlabs.types';

export { ELEVENLABS_CONFIG, ELEVENLABS_FETCH };

/**
 * Imported only by the composition roots (the api fetches signed URLs, the worker reads finished
 * conversations); `*-flow.service.ts` files inject `ElevenLabsGateway` and call the provider
 * between transactions. Tests replace ELEVENLABS_FETCH with a scripted fetch and ELEVENLABS_CONFIG
 * with a made-up key: no test reaches ElevenLabs.
 */
@Global()
@Module({
  providers: [
    {
      provide: ELEVENLABS_FETCH,
      useValue: ((url, init) => fetch(url, init)) satisfies ElevenLabsFetch,
    },
    {
      provide: ELEVENLABS_CONFIG,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ElevenLabsConfig | null =>
        elevenLabsConfigFromEnv({
          ELEVENLABS_API_KEY: config.get('ELEVENLABS_API_KEY'),
          ELEVENLABS_AGENT_ID: config.get('ELEVENLABS_AGENT_ID'),
        }),
    },
    ElevenLabsGateway,
  ],
  exports: [ElevenLabsGateway],
})
export class ElevenLabsIntegrationModule {}
