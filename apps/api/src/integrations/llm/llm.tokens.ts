/** The client of the environment's configuration, or null while LLM_PROVIDER is unset. */
export const LLM_CLIENT = Symbol('LLM_CLIENT');

/** `fetch` as the gateway's clients use it; tests give a scripted one, never the network. */
export const LLM_FETCH = Symbol('LLM_FETCH');
