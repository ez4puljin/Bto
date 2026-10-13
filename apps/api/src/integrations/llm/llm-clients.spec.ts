import { createLlmClient, llmConfigFromEnv } from './create-llm-client';
import { type FetchFn, type LlmConfig, LlmError, type LlmRequest } from './llm.types';

const KEY = 'sk-test-not-a-real-key';

const REQUEST: LlmRequest = {
  instructions: 'Answer with SQL.',
  messages: [
    { role: 'user', content: 'first question' },
    { role: 'assistant', content: 'first answer' },
    { role: 'user', content: 'second question' },
  ],
  output: {
    name: 'answer',
    schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
      additionalProperties: false,
    },
  },
  maxOutputTokens: 4000,
};

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** A fetch that records the request and answers with `payload` (JSON unless a string). */
function fakeFetch(payload: unknown, status = 200): { fetchFn: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: FetchFn = (url, init) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(init.body as string) as Record<string, unknown>,
    });
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return Promise.resolve(new Response(text, { status }));
  };
  return { fetchFn, calls };
}

function config(provider: LlmConfig['provider'], extra: Partial<LlmConfig> = {}): LlmConfig {
  return { provider, model: 'test-model', apiKey: KEY, timeoutMs: 1_000, ...extra };
}

async function failure(promise: Promise<unknown>): Promise<LlmError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof LlmError) return error;
    throw error;
  }
  throw new Error('expected an LlmError');
}

function client(provider: LlmConfig['provider'], fetchFn: FetchFn, extra?: Partial<LlmConfig>) {
  const created = createLlmClient(config(provider, extra), fetchFn);
  if (!created) throw new Error('no client');
  return created;
}

const openAiAnswer = (overrides: Record<string, unknown> = {}) => ({
  id: 'resp_1',
  object: 'response',
  model: 'test-model-2026',
  status: 'completed',
  output: [
    { type: 'reasoning', summary: [] },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: '{"sql":"SELECT 1"}', annotations: [] }],
    },
  ],
  usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
  ...overrides,
});

describe('OpenAI Responses client', () => {
  it('sends the instructions, the turns and a strict schema without storing them', async () => {
    const { fetchFn, calls } = fakeFetch(openAiAnswer());
    const result = await client('openai', fetchFn).complete(REQUEST);

    expect(result).toEqual({
      text: '{"sql":"SELECT 1"}',
      model: 'test-model-2026',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0]?.headers).toMatchObject({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
    });
    expect(calls[0]?.body).toEqual({
      model: 'test-model',
      instructions: 'Answer with SQL.',
      input: REQUEST.messages,
      max_output_tokens: 4000,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'answer',
          schema: REQUEST.output?.schema,
          strict: true,
        },
      },
    });
  });

  it('asks for plain text without a schema and honours a base URL', async () => {
    const { fetchFn, calls } = fakeFetch(openAiAnswer());
    await client('openai', fetchFn, { baseUrl: 'https://proxy.example/v1/' }).complete({
      ...REQUEST,
      output: undefined,
    });
    expect(calls[0]?.url).toBe('https://proxy.example/v1/responses');
    expect(calls[0]?.body).not.toHaveProperty('text');
  });

  it('turns a refusal, an incomplete or a failed response into errors', async () => {
    const refusal = openAiAnswer({
      output: [
        { type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] },
      ],
    });
    expect(
      (await failure(client('openai', fakeFetch(refusal).fetchFn).complete(REQUEST))).reason,
    ).toBe('REFUSED');
    const incomplete = openAiAnswer({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
    });
    const stopped = await failure(
      client('openai', fakeFetch(incomplete).fetchFn).complete(REQUEST),
    );
    expect(stopped.reason).toBe('INCOMPLETE');
    expect(stopped.message).toContain('max_output_tokens');
    const failed = openAiAnswer({ status: 'failed' });
    expect(
      (await failure(client('openai', fakeFetch(failed).fetchFn).complete(REQUEST))).reason,
    ).toBe('INVALID_RESPONSE');
    const empty = openAiAnswer({ output: [{ type: 'reasoning' }] });
    expect(
      (await failure(client('openai', fakeFetch(empty).fetchFn).complete(REQUEST))).reason,
    ).toBe('INVALID_RESPONSE');
  });

  it('reports the HTTP status and the provider code, never the body', async () => {
    const body = {
      error: {
        message: `Incorrect API key provided: ${KEY}.`,
        type: 'invalid_request_error',
        code: 'invalid_api_key',
      },
    };
    const error = await failure(client('openai', fakeFetch(body, 401).fetchFn).complete(REQUEST));
    expect(error).toMatchObject({ reason: 'HTTP', status: 401, providerCode: 'invalid_api_key' });
    expect(`${error.message} ${JSON.stringify(error)}`).not.toContain(KEY);

    const gateway = await failure(
      client('openai', fakeFetch('<html>Bad gateway</html>', 502).fetchFn).complete(REQUEST),
    );
    expect(gateway).toMatchObject({ reason: 'HTTP', status: 502, providerCode: undefined });
  });

  it('refuses a body that is not the expected JSON', async () => {
    const notJson = await failure(
      client('openai', fakeFetch('not json').fetchFn).complete(REQUEST),
    );
    expect(notJson.reason).toBe('INVALID_RESPONSE');
    const wrongShape = await failure(
      client('openai', fakeFetch({ hello: 'world' }).fetchFn).complete(REQUEST),
    );
    expect(wrongShape.reason).toBe('INVALID_RESPONSE');
  });
});

const anthropicAnswer = (overrides: Record<string, unknown> = {}) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'test-model-2026',
  content: [{ type: 'text', text: '{"sql":"SELECT 1"}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 90, output_tokens: 20 },
  ...overrides,
});

describe('Anthropic Messages client', () => {
  it('sends the key, the version, the system prompt and the output format', async () => {
    const { fetchFn, calls } = fakeFetch(anthropicAnswer());
    const result = await client('anthropic', fetchFn).complete(REQUEST);

    expect(result).toEqual({
      text: '{"sql":"SELECT 1"}',
      model: 'test-model-2026',
      usage: { inputTokens: 90, outputTokens: 20 },
    });
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.headers).toMatchObject({
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
    });
    expect(calls[0]?.body).toEqual({
      model: 'test-model',
      system: 'Answer with SQL.',
      messages: REQUEST.messages,
      max_tokens: 4000,
      output_config: { format: { type: 'json_schema', schema: REQUEST.output?.schema } },
    });
  });

  it('turns a refusal or a cut answer into errors and reads the error type', async () => {
    const refused = anthropicAnswer({ stop_reason: 'refusal', content: [] });
    expect(
      (await failure(client('anthropic', fakeFetch(refused).fetchFn).complete(REQUEST))).reason,
    ).toBe('REFUSED');
    const cut = anthropicAnswer({ stop_reason: 'max_tokens' });
    expect(
      (await failure(client('anthropic', fakeFetch(cut).fetchFn).complete(REQUEST))).reason,
    ).toBe('INCOMPLETE');
    const overloaded = {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    };
    expect(
      await failure(client('anthropic', fakeFetch(overloaded, 529).fetchFn).complete(REQUEST)),
    ).toMatchObject({ reason: 'HTTP', status: 529, providerCode: 'overloaded_error' });
  });
});

const ollamaAnswer = (overrides: Record<string, unknown> = {}) => ({
  model: 'test-model',
  created_at: '2026-10-13T00:00:00Z',
  message: { role: 'assistant', content: '{"sql":"SELECT 1"}' },
  done: true,
  done_reason: 'stop',
  prompt_eval_count: 70,
  eval_count: 15,
  ...overrides,
});

describe('Ollama chat client', () => {
  it('sends one non-streaming chat with the schema as format and no key by default', async () => {
    const { fetchFn, calls } = fakeFetch(ollamaAnswer());
    const result = await client('ollama', fetchFn, { apiKey: undefined }).complete(REQUEST);

    expect(result).toEqual({
      text: '{"sql":"SELECT 1"}',
      model: 'test-model',
      usage: { inputTokens: 70, outputTokens: 15 },
    });
    expect(calls[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(calls[0]?.headers).not.toHaveProperty('authorization');
    expect(calls[0]?.body).toEqual({
      model: 'test-model',
      messages: [{ role: 'system', content: 'Answer with SQL.' }, ...REQUEST.messages],
      stream: false,
      options: { num_predict: 4000 },
      format: REQUEST.output?.schema,
    });
  });

  it('sends a configured key as a bearer token and reports a cut answer', async () => {
    const { fetchFn, calls } = fakeFetch(ollamaAnswer({ done_reason: 'length' }));
    const error = await failure(client('ollama', fetchFn).complete(REQUEST));
    expect(error.reason).toBe('INCOMPLETE');
    expect(calls[0]?.headers).toMatchObject({ authorization: `Bearer ${KEY}` });
  });
});

describe('transport', () => {
  it('stops waiting after the timeout', async () => {
    const hanging: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      });
    const error = await failure(
      client('openai', hanging, { timeoutMs: 20 }).complete({ ...REQUEST, output: undefined }),
    );
    expect(error.reason).toBe('TIMEOUT');
  });

  it('reports an unreachable provider without its details', async () => {
    const refused: FetchFn = () =>
      Promise.reject(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') }));
    const error = await failure(client('ollama', refused).complete(REQUEST));
    expect(error).toMatchObject({ reason: 'NETWORK' });
    expect(error.message).not.toContain('ECONNREFUSED');
  });
});

describe('configuration', () => {
  it('builds no client while the provider is unset', () => {
    expect(llmConfigFromEnv({ LLM_TIMEOUT_MS: 60_000 })).toBeNull();
    expect(createLlmClient(null)).toBeNull();
  });

  it('builds the client of the configured provider', () => {
    const env = {
      LLM_PROVIDER: 'anthropic' as const,
      LLM_MODEL: 'test-model',
      LLM_API_KEY: KEY,
      LLM_TIMEOUT_MS: 45_000,
    };
    expect(llmConfigFromEnv(env)).toEqual({
      provider: 'anthropic',
      model: 'test-model',
      apiKey: KEY,
      baseUrl: undefined,
      timeoutMs: 45_000,
    });
    expect(createLlmClient(llmConfigFromEnv(env))).toMatchObject({
      provider: 'anthropic',
      model: 'test-model',
    });
  });
});
