/** `fetch` as the ElevenLabs client uses it; tests give a scripted one, never the network. */
export const ELEVENLABS_FETCH = Symbol('ELEVENLABS_FETCH');
/** The key and agent id from the environment, or null when the agent is not configured. */
export const ELEVENLABS_CONFIG = Symbol('ELEVENLABS_CONFIG');
