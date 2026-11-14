import { PictureError, type PictureFetch } from './picture.types';
import { REMOVE_BG_BASE_URL, RemoveBgClient } from './remove-bg.client';

/** Not a real key: no test reaches the service, every fetch here is scripted. */
const KEY = 'test-key-not-real-abcd';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PHOTO = { data: Buffer.from('jpeg-bytes'), mediaType: 'image/jpeg' as const };

interface Sent {
  url: string;
  init: RequestInit;
}

function scripted(answer: () => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetchFn: PictureFetch = (url, init) => {
    sent.push({ url, init });
    return Promise.resolve(answer());
  };
  return { sent, client: new RemoveBgClient(KEY, fetchFn, 1_000) };
}

const failure = async (promise: Promise<unknown>): Promise<PictureError> => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof PictureError) return error;
    throw error;
  }
  throw new Error('expected a PictureError');
};

describe('remove.bg client (ADR-0198)', () => {
  it('sends the photo as a file with the key in its header and returns the PNG', async () => {
    const { sent, client } = scripted(
      () =>
        new Response(new Uint8Array(PNG), {
          status: 200,
          headers: { 'content-type': 'image/png', 'x-credits-charged': '1' },
        }),
    );
    const result = await client.cutOut(PHOTO);
    expect(result.png.equals(PNG)).toBe(true);
    expect(result.creditsCharged).toBe('1');

    const [call] = sent;
    expect(call?.url).toBe(`${REMOVE_BG_BASE_URL}/removebg`);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({ 'X-Api-Key': KEY });
    const form = call?.init.body as FormData;
    expect(form.get('size')).toBe('auto');
    expect(form.get('format')).toBe('png');
    const file = form.get('image_file') as File;
    expect(file.type).toBe('image/jpeg');
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('jpeg-bytes');
  });

  it('refuses an answer that is no PNG', async () => {
    const { client } = scripted(() => new Response('<html>', { status: 200 }));
    expect((await failure(client.cutOut(PHOTO))).reason).toBe('INVALID_RESPONSE');
  });

  it('keeps the code of a refusal, never its words or the key', async () => {
    const { client } = scripted(
      () =>
        new Response(
          JSON.stringify({
            errors: [
              { title: 'Insufficient credits for the secret plan', code: 'insufficient_credits' },
            ],
          }),
          { status: 402, headers: { 'content-type': 'application/json' } },
        ),
    );
    const error = await failure(client.cutOut(PHOTO));
    expect(error).toMatchObject({
      reason: 'HTTP',
      status: 402,
      providerCode: 'insufficient_credits',
    });
    expect(error.message).not.toContain('secret plan');
    expect(error.message).not.toContain(KEY);
  });

  it('a refusal without a readable code keeps the status alone', async () => {
    const { client } = scripted(() => new Response('Bad gateway', { status: 502 }));
    const error = await failure(client.cutOut(PHOTO));
    expect(error).toMatchObject({ reason: 'HTTP', status: 502 });
    expect(error.providerCode).toBeUndefined();
  });

  it('tells a timeout from an unreachable service', async () => {
    const timeout = new RemoveBgClient(
      KEY,
      () => Promise.reject(Object.assign(new Error('late'), { name: 'TimeoutError' })),
      5,
    );
    expect((await failure(timeout.cutOut(PHOTO))).reason).toBe('TIMEOUT');
    const down = new RemoveBgClient(KEY, () => Promise.reject(new TypeError('fetch failed')), 5);
    expect((await failure(down.account())).reason).toBe('NETWORK');
  });

  it('reads the credit left from the account, for free', async () => {
    const { sent, client } = scripted(
      () =>
        new Response(
          JSON.stringify({
            data: {
              attributes: {
                credits: { total: 196.5, subscription: 150, payg: 46.5, enterprise: 0 },
                api: { free_calls: 48, sizes: 'all' },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    expect(await client.account()).toEqual({ credits: '196.5', freeCalls: 48 });
    expect(sent[0]?.url).toBe(`${REMOVE_BG_BASE_URL}/account`);
    expect(sent[0]?.init.method).toBe('GET');
  });

  it('an account answer without figures still says the key works', async () => {
    const { client } = scripted(
      () => new Response(JSON.stringify({ data: { attributes: {} } }), { status: 200 }),
    );
    expect(await client.account()).toEqual({ credits: null, freeCalls: null });
  });

  it('a wrong key is a refusal with the service code', async () => {
    const { client } = scripted(
      () =>
        new Response(
          JSON.stringify({ errors: [{ title: 'API Key invalid', code: 'auth_failed' }] }),
          { status: 403 },
        ),
    );
    expect(await failure(client.account())).toMatchObject({
      reason: 'HTTP',
      status: 403,
      providerCode: 'auth_failed',
    });
  });
});
