import type { AppConfig } from '../../common/config/app-config';
import { LlmGateway, type LlmCallFacts, type LlmConnectionStore } from './llm-gateway';
import { LlmError, type FetchFn, type LlmClient, type LlmConfig } from './llm.types';

const REQUEST = { instructions: 'x', messages: [], maxOutputTokens: 10 };
const SAVED: LlmConfig = {
  provider: 'anthropic',
  model: 'saved-model',
  apiKey: 'test-key-not-real',
  timeoutMs: 1000,
};

function environmentClient(complete: LlmClient['complete']): LlmClient {
  return { provider: 'openai', model: 'env-model', complete };
}

const noEnv = { get: () => undefined } as unknown as AppConfig;

function storeWith(overrides: Partial<LlmConnectionStore> = {}) {
  const calls: LlmCallFacts[] = [];
  const store: LlmConnectionStore = {
    saved: () => Promise.resolve({ off: false, config: null }),
    assertWithinLimits: () => Promise.resolve(),
    recordCall: (facts) => {
      calls.push(facts);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { store, calls };
}

const answered = () =>
  Promise.resolve({ text: 'hi', model: 'answered', usage: { inputTokens: 5, outputTokens: 2 } });
const unusedFetch: FetchFn = () => Promise.reject(new Error('no network in this test'));
const WORK = { purpose: 'INVOICE_CHECK', userId: 3 } as const;

describe('LlmGateway (ADR-0162)', () => {
  it('uses the environment while nothing is saved, and is off without either', async () => {
    const env = environmentClient(answered);
    const withEnv = new LlmGateway(env, unusedFetch, noEnv);
    withEnv.attach(storeWith().store);
    expect(await withEnv.current()).toBe(env);
    const without = new LlmGateway(null, unusedFetch, noEnv);
    without.attach(storeWith().store);
    expect(await without.current()).toBeNull();
    expect(await without.forWork(WORK)).toBeNull();
  });

  it('a saved connection overrides the environment, and the switch stops both', async () => {
    const gateway = new LlmGateway(environmentClient(answered), unusedFetch, noEnv);
    gateway.attach(
      storeWith({ saved: () => Promise.resolve({ off: false, config: SAVED }) }).store,
    );
    expect(await gateway.current()).toMatchObject({ provider: 'anthropic', model: 'saved-model' });
    gateway.attach(storeWith({ saved: () => Promise.resolve({ off: true, config: null }) }).store);
    expect(await gateway.current()).toBeNull();
  });

  it('counts each answered call for the work it belongs to', async () => {
    const { store, calls } = storeWith();
    const gateway = new LlmGateway(environmentClient(answered), unusedFetch, noEnv);
    gateway.attach(store);
    const client = await gateway.forWork(WORK);
    await client?.complete(REQUEST);
    expect(calls).toEqual([
      {
        purpose: 'INVOICE_CHECK',
        userId: 3,
        provider: 'openai',
        model: 'env-model',
        answeredModel: 'answered',
        inputTokens: 5,
        outputTokens: 2,
      },
    ]);
  });

  it('refuses new work past the limit before any call', async () => {
    const complete = jest.fn(answered);
    const gateway = new LlmGateway(environmentClient(complete), unusedFetch, noEnv);
    gateway.attach(
      storeWith({ assertWithinLimits: () => Promise.reject(new Error('limit reached')) }).store,
    );
    await expect(gateway.forWork(WORK)).rejects.toThrow('limit reached');
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps the last failure until a call succeeds; a failed call is not counted', async () => {
    const complete = jest
      .fn<ReturnType<LlmClient['complete']>, []>()
      .mockRejectedValueOnce(
        new LlmError('HTTP', 'no', { status: 402, providerCode: 'billing_error' }),
      )
      .mockImplementationOnce(answered);
    const { store, calls } = storeWith();
    const gateway = new LlmGateway(environmentClient(complete), unusedFetch, noEnv);
    gateway.attach(store);
    const client = await gateway.forWork(WORK);
    await expect(client?.complete(REQUEST)).rejects.toThrow('no');
    expect(gateway.lastFailure).toMatchObject({ status: 402, providerCode: 'billing_error' });
    expect(calls).toHaveLength(0);
    await client?.complete(REQUEST);
    expect(gateway.lastFailure).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('a paid answer survives a usage row that could not be written', async () => {
    const gateway = new LlmGateway(environmentClient(answered), unusedFetch, noEnv);
    gateway.attach(
      storeWith({ recordCall: () => Promise.reject(new Error('database down')) }).store,
    );
    const client = await gateway.forWork(WORK);
    await expect(client?.complete(REQUEST)).resolves.toMatchObject({ text: 'hi' });
  });
});
