import { SmsError, type SmsFetch } from './sms.types';
import { WesendClient } from './wesend.client';

/** Not a real key: the «WeSend» here is scripted. */
const KEY = 'test-key-not-real';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    }),
  );

describe('WesendClient', () => {
  it('posts the text with the key, the JSON body and the idempotency key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn: SmsFetch = (url, init) => {
      calls.push({ url, init });
      return json(200, { id: 'm1', status: 'sent', parts: 2, credits: 160, balance: 840 });
    };
    const sent = await new WesendClient(KEY, fetchFn).send({
      to: '99112233',
      text: 'Сайн байна уу',
      idempotencyKey: 'bto-sms-1',
    });
    expect(sent).toEqual({ id: 'm1', parts: 2, credits: 160, balance: 840 });
    expect(calls[0]?.url).toBe('https://api.wesend.mn/v1/sms');
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'bto-sms-1',
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      to: '99112233',
      text: 'Сайн байна уу',
    });
  });

  it("names WeSend's refusal by its code, with Retry-After", async () => {
    const refuse: SmsFetch = () =>
      json(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'retry-after': '3' });
    const error = await new WesendClient(KEY, refuse)
      .send({ to: '99112233', text: 'x', idempotencyKey: 'k' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SmsError);
    expect(error).toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 3 });
    expect(String((error as Error).message)).not.toContain(KEY);
  });

  it('tells a timeout from an unreachable server', async () => {
    const timeout: SmsFetch = () => Promise.reject(new DOMException('late', 'TimeoutError'));
    const down: SmsFetch = () => Promise.reject(new TypeError('fetch failed'));
    const send = (fetchFn: SmsFetch) =>
      new WesendClient(KEY, fetchFn)
        .send({ to: '99112233', text: 'x', idempotencyKey: 'k' })
        .catch((caught: unknown) => caught);
    expect(await send(timeout)).toMatchObject({ code: 'timeout' });
    expect(await send(down)).toMatchObject({ code: 'network_error' });
  });

  it('reads the balance', async () => {
    const fetchFn: SmsFetch = (url) =>
      url.endsWith('/v1/balance') ? json(200, { balance: 12000 }) : json(404, {});
    expect(await new WesendClient(KEY, fetchFn).balance()).toBe(12000);
    const nested: SmsFetch = () => json(200, { data: { credits: 50 } });
    expect(await new WesendClient(KEY, nested).balance()).toBe(50);
  });
});
