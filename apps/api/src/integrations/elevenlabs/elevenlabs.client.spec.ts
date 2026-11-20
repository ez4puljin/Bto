import { ElevenLabsClient } from './elevenlabs.client';
import { elevenLabsConfigFromEnv } from './elevenlabs.config';
import { ElevenLabsGateway } from './elevenlabs.gateway';
import { ElevenLabsError, type ElevenLabsFetch } from './elevenlabs.types';

/** Not a real key: the «ElevenLabs» here is scripted. */
const CONFIG = { apiKey: 'test-key-not-real', agentId: 'agent 1', baseUrl: 'https://el.test/' };

const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const codeOf = async (work: Promise<unknown>) => {
  try {
    await work;
    return 'no error';
  } catch (error) {
    return error instanceof ElevenLabsError ? `${error.code}:${error.status}` : 'other';
  }
};

describe('ElevenLabsClient', () => {
  it('asks a signed URL for the agent with the key in its header only', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn: ElevenLabsFetch = (url, init) => {
      calls.push({ url, init });
      return json(200, { signed_url: 'wss://el.test/convai?token=abc' });
    };
    const url = await new ElevenLabsClient(CONFIG, fetchFn).getSignedUrl(1_500);
    expect(url).toBe('wss://el.test/convai?token=abc');
    expect(calls[0]?.url).toBe(
      'https://el.test/v1/convai/conversation/get-signed-url?agent_id=agent%201',
    );
    expect(calls[0]?.url).not.toContain(CONFIG.apiKey);
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      headers: { 'xi-api-key': CONFIG.apiKey },
    });
  });

  it('reads a conversation’s spoken turns, its length and its cost', async () => {
    const fetchFn: ElevenLabsFetch = (url) => {
      expect(url).toBe('https://el.test/v1/convai/conversations/conv%2F1');
      return json(200, {
        conversation_id: 'conv/1',
        status: 'done',
        metadata: { call_duration_secs: 61, cost: 250 },
        transcript: [
          { role: 'agent', message: 'Сайн байна уу', time_in_call_secs: 0 },
          { role: 'user', message: 'Кола', time_in_call_secs: 3 },
          { role: 'agent', message: null, time_in_call_secs: 4, tool_calls: [{}] },
          { role: 'system', message: 'ignored', time_in_call_secs: 5 },
        ],
      });
    };
    expect(await new ElevenLabsClient(CONFIG, fetchFn).getConversation('conv/1')).toEqual({
      conversationId: 'conv/1',
      status: 'done',
      durationSecs: 61,
      cost: 250,
      transcript: [
        { role: 'agent', message: 'Сайн байна уу', timeInCallSecs: 0 },
        { role: 'user', message: 'Кола', timeInCallSecs: 3 },
        { role: 'agent', message: '', timeInCallSecs: 4 },
      ],
    });
  });

  it('names a failure by a code, never by the provider’s words', async () => {
    const client = (fetchFn: ElevenLabsFetch) => new ElevenLabsClient(CONFIG, fetchFn);
    expect(await codeOf(client(() => json(401, { detail: 'bad key' })).getSignedUrl(100))).toBe(
      'HTTP:401',
    );
    expect(await codeOf(client(() => json(200, { url: 'x' })).getSignedUrl(100))).toBe(
      'INVALID_RESPONSE:null',
    );
    expect(
      await codeOf(client(() => Promise.reject(new TypeError('fetch failed'))).getSignedUrl(100)),
    ).toBe('NETWORK:null');
    const hangs: ElevenLabsFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
      });
    expect(await codeOf(client(hangs).getSignedUrl(20))).toBe('TIMEOUT:null');
  });

  it('is off without both the key and the agent id', async () => {
    expect(elevenLabsConfigFromEnv({})).toBeNull();
    expect(
      elevenLabsConfigFromEnv({ ELEVENLABS_API_KEY: 'k', ELEVENLABS_AGENT_ID: ' ' }),
    ).toBeNull();
    expect(
      elevenLabsConfigFromEnv({ ELEVENLABS_API_KEY: ' k ', ELEVENLABS_AGENT_ID: 'a' }),
    ).toEqual({ apiKey: 'k', agentId: 'a', baseUrl: 'https://api.elevenlabs.io' });
    const off = new ElevenLabsGateway(null, () => json(200, {}));
    expect(off.configured).toBe(false);
    expect(await codeOf(Promise.resolve().then(() => off.getSignedUrl(100)))).toBe(
      'NOT_CONFIGURED:null',
    );
  });
});
