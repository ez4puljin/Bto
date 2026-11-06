import { checkLlm } from './llm-check';
import type { FetchFn, LlmConfig } from './llm.types';

function respond(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchFn: FetchFn = (url, init) => {
    seen.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetchFn, seen };
}

const config = (overrides: Partial<LlmConfig>): LlmConfig => ({
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  apiKey: 'test-key-not-real',
  timeoutMs: 1000,
  ...overrides,
});

describe('checkLlm (ADR-0162)', () => {
  it('asks Anthropic about the model with a GET that spends nothing', async () => {
    const { fetchFn, seen } = respond(200, { id: 'claude-opus-5-5' });
    expect(await checkLlm(config({}), fetchFn)).toEqual({ ok: true });
    expect(seen[0]?.url).toBe('https://api.anthropic.com/v1/models/claude-opus-5-5');
    expect(seen[0]?.init.method).toBe('GET');
    expect(seen[0]?.init.body).toBeUndefined();
    expect(seen[0]?.init.headers).toMatchObject({ 'x-api-key': 'test-key-not-real' });
  });

  it('asks OpenAI with its bearer header', async () => {
    const { fetchFn, seen } = respond(200, { id: 'gpt' });
    const result = await checkLlm(config({ provider: 'openai', model: 'gpt' }), fetchFn);
    expect(result).toEqual({ ok: true });
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/models/gpt');
    expect(seen[0]?.init.headers).toMatchObject({ authorization: 'Bearer test-key-not-real' });
  });

  it('finds an Ollama model with or without its tag, and sends no key', async () => {
    const { fetchFn, seen } = respond(200, { models: [{ name: 'llama4:latest' }] });
    const ollama = config({ provider: 'ollama', model: 'llama4', apiKey: undefined });
    expect(await checkLlm(ollama, fetchFn)).toEqual({ ok: true });
    expect(seen[0]?.url).toBe('http://127.0.0.1:11434/api/tags');
    expect(await checkLlm({ ...ollama, model: 'other' }, fetchFn)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it('says why: a wrong key, an unknown model, an empty account', async () => {
    expect(
      await checkLlm(config({}), respond(401, { error: { type: 'authentication_error' } }).fetchFn),
    ).toEqual({ ok: false, reason: 'HTTP', status: 401, providerCode: 'authentication_error' });
    expect(
      await checkLlm(config({}), respond(404, { error: { type: 'not_found_error' } }).fetchFn),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await checkLlm(
        config({}),
        respond(400, {
          error: { type: 'invalid_request_error', message: 'Your credit balance is too low' },
        }).fetchFn,
      ),
    ).toEqual({ ok: false, reason: 'HTTP', status: 400, providerCode: 'credit_balance_too_low' });
  });

  it('turns an unreachable host into a reason, not an exception', async () => {
    const down: FetchFn = () => Promise.reject(new Error('connect ECONNREFUSED'));
    expect(await checkLlm(config({}), down)).toEqual({ ok: false, reason: 'NETWORK' });
  });
});
