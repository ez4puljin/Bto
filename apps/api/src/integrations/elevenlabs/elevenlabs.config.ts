import { ELEVENLABS_BASE_URL } from './elevenlabs.client';
import type { ElevenLabsConfig } from './elevenlabs.types';

/**
 * The agent's configuration from the environment (ADR-0232 #11): `ELEVENLABS_API_KEY` (a secret
 * like LLM_API_KEY: never logged, sent only to the provider) and `ELEVENLABS_AGENT_ID`; an empty
 * or missing one of the two leaves the agent off.
 */
export function elevenLabsConfigFromEnv(env: {
  ELEVENLABS_API_KEY?: string | undefined;
  ELEVENLABS_AGENT_ID?: string | undefined;
}): ElevenLabsConfig | null {
  const apiKey = env.ELEVENLABS_API_KEY?.trim() ?? '';
  const agentId = env.ELEVENLABS_AGENT_ID?.trim() ?? '';
  if (apiKey === '' || agentId === '') return null;
  return { apiKey, agentId, baseUrl: ELEVENLABS_BASE_URL };
}
