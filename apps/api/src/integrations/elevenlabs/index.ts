// ElevenLabs Agents for the phone AI order line (ADR-0232, docs/modules/phone-agent.md).
export {
  ELEVENLABS_BASE_URL,
  ELEVENLABS_READ_TIMEOUT_MS,
  ElevenLabsClient,
} from './elevenlabs.client';
export { elevenLabsConfigFromEnv } from './elevenlabs.config';
export { ElevenLabsGateway } from './elevenlabs.gateway';
export {
  ELEVENLABS_CONFIG,
  ELEVENLABS_FETCH,
  ElevenLabsIntegrationModule,
} from './elevenlabs.module';
export {
  type ElevenLabsConfig,
  type ElevenLabsConversation,
  ElevenLabsError,
  type ElevenLabsErrorCode,
  type ElevenLabsFetch,
  type ElevenLabsTurn,
} from './elevenlabs.types';
