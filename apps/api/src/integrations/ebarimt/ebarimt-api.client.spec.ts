import { EbarimtApiClient, EbarimtTokenCache } from './ebarimt-api.client';
import { parseExactJson } from './ebarimt-json';
import { EbarimtApiError, type EbarimtFetch } from './ebarimt.types';

/** Not a real connection: no test reaches the tax authority, every fetch here is scripted. */
const ACCOUNT = {
  environment: 'STAGING' as const,
  username: 'tester',
  password: 'not-a-real-password',
  apiKey: 'not-a-real-key',
  pin: '1234567',
};
const HOSTS = { api: 'https://api.test', auth: 'https://auth.test/auth/realms/Test' };

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

const json = (status: number, text: string) =>
  new Response(text, { status, headers: { 'Content-Type': 'application/json' } });

/** A small e-Barimt: the realm's token and the purchases list. */
function ebarimt(
  options: {
    password?: string;
    list?: (sent: Sent) => Response;
    expiresIn?: number;
  } = {},
) {
  const sent: Sent[] = [];
  let issued = 0;
  const answer = (url: string, init: RequestInit): Response => {
    const entry = {
      url,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    };
    sent.push(entry);
    if (url === `${HOSTS.auth}/protocol/openid-connect/token`) {
      const form = new URLSearchParams(entry.body);
      if (form.get('password') !== (options.password ?? ACCOUNT.password)) {
        return json(
          401,
          '{"error":"invalid_grant","error_description":"Invalid user credentials"}',
        );
      }
      issued += 1;
      return json(
        200,
        JSON.stringify({ access_token: `token-${issued}`, expires_in: options.expiresIn ?? 300 }),
      );
    }
    if (url === `${HOSTS.api}/api/tpi/receipt/getSaleListERP`) {
      return options.list ? options.list(entry) : json(200, ANSWER);
    }
    return new Response('not found', { status: 404 });
  };
  const fetchFn: EbarimtFetch = (url, init) => Promise.resolve(answer(url, init));
  return { sent, fetchFn, issued: () => issued };
}

const ANSWER = `{
  "msg": "Амжилттай", "status": 200, "code": null,
  "data": [{
    "startDate": "2026-10-01 00:00:00", "endDate": "2026-10-07 23:59:59", "regNo": "1234567",
    "receiptBuyModelList": [
      { "prPosRno": "000005743087000240101000001411087", "name": "ГУР*****МБА", "regNo": "57***85",
        "buyerRegNo": "1234567", "date": "2026-10-01 03:34:36", "amountVat": 252.272727,
        "amountCitytax": 0, "amountTotal": 2775, "amountNet": 2522.727273,
        "fromType": "INVOICE", "receiptType": "ТӨЛБӨРИЙН БАРИМТ" },
      { "prPosRno": "000000000000000000000000000000002", "name": "Хоёр ХХК", "regNo": "7000002",
        "buyerRegNo": "1234567", "date": "2026-10-02 10:00:00", "amountVat": 0.1,
        "amountCitytax": null, "amountTotal": 1.1, "amountNet": 1.000000000000000001,
        "fromType": "POS API", "receiptType": null }
    ]
  }]
}`;

describe('EbarimtApiClient', () => {
  it('signs in by the password grant and lists a span with the key, keeping the amounts exact', async () => {
    const server = ebarimt();
    const client = new EbarimtApiClient(ACCOUNT, HOSTS, server.fetchFn, new EbarimtTokenCache());
    const lines = await client.purchases('2026-10-01', '2026-10-07');

    const [token, list] = server.sent;
    expect(new URLSearchParams(token?.body)).toEqual(
      new URLSearchParams({
        grant_type: 'password',
        client_id: 'vatps',
        username: 'tester',
        password: 'not-a-real-password',
      }),
    );
    expect(list?.headers).toMatchObject({
      Authorization: 'Bearer token-1',
      'X-API-KEY': 'not-a-real-key',
    });
    expect(JSON.parse(list?.body ?? '')).toEqual({
      pin: '1234567',
      startDate: '2026-10-01',
      endDate: '2026-10-07',
      subPin: [],
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      ddtd: '000005743087000240101000001411087',
      sellerRegNo: '57***85',
      date: '2026-10-01 03:34:36',
      fromType: 'INVOICE',
      receiptType: 'ТӨЛБӨРИЙН БАРИМТ',
    });
    expect(lines[0]?.vat.toFixed()).toBe('252.272727');
    expect(lines[0]?.net.toFixed()).toBe('2522.727273');
    // A float would have lost this: 1.000000000000000001 is 1 as a double.
    expect(lines[1]?.net.toFixed()).toBe('1.000000000000000001');
    expect(lines[1]?.cityTax.toFixed()).toBe('0');
    expect(lines[1]?.receiptType).toBeNull();
  });

  it('keeps the token until it ends, and asks again once when the service refuses it', async () => {
    let refuse = false;
    const server = ebarimt({
      list: (sent) => {
        if (refuse && sent.headers.Authorization === 'Bearer token-1') {
          return json(401, '{"msg":"token expired"}');
        }
        return json(200, '{"msg":"ok","status":200,"data":[]}');
      },
    });
    const cache = new EbarimtTokenCache();
    const client = new EbarimtApiClient(ACCOUNT, HOSTS, server.fetchFn, cache);
    await client.purchases('2026-10-01', '2026-10-07');
    await client.purchases('2026-10-08', '2026-10-14');
    expect(server.issued()).toBe(1);
    refuse = true;
    await expect(client.purchases('2026-10-15', '2026-10-21')).resolves.toEqual([]);
    expect(server.issued()).toBe(2);
  });

  it('drops a token past its lifetime', async () => {
    let now = 1_000_000;
    const server = ebarimt({ expiresIn: 60 });
    const client = new EbarimtApiClient(
      ACCOUNT,
      HOSTS,
      server.fetchFn,
      new EbarimtTokenCache(() => now),
    );
    await client.token();
    now += 29_000;
    await client.token();
    expect(server.issued()).toBe(1);
    now += 2_000;
    await client.token();
    expect(server.issued()).toBe(2);
  });

  it('says why: a refused sign-in, the service’s own refusal, no answer, a broken answer', async () => {
    const reasonOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return null;
      } catch (error: unknown) {
        if (!(error instanceof EbarimtApiError)) throw error;
        return { reason: error.reason, detail: error.detail, message: error.message };
      }
    };
    const wrong = ebarimt({ password: 'another' });
    const refused = await reasonOf(
      new EbarimtApiClient(ACCOUNT, HOSTS, wrong.fetchFn, new EbarimtTokenCache()).purchases(
        '2026-10-01',
        '2026-10-07',
      ),
    );
    expect(refused).toMatchObject({
      reason: 'SIGN_IN_REFUSED',
      detail: 'Invalid user credentials',
    });
    // Nothing secret travels in what the page may show.
    expect(JSON.stringify(refused)).not.toContain(ACCOUNT.password);

    const own = ebarimt({
      list: () => json(200, '{"msg":"Зөвхөн 01:00-07:00 цагт","status":400,"code":"TIME"}'),
    });
    expect(
      await reasonOf(
        new EbarimtApiClient(ACCOUNT, HOSTS, own.fetchFn, new EbarimtTokenCache()).purchases(
          '2026-10-01',
          '2026-10-07',
        ),
      ),
    ).toMatchObject({ reason: 'REFUSED', detail: 'Зөвхөн 01:00-07:00 цагт' });

    const forbidden = ebarimt({ list: () => json(403, '{"msg":"Invalid API key"}') });
    expect(
      await reasonOf(
        new EbarimtApiClient(ACCOUNT, HOSTS, forbidden.fetchFn, new EbarimtTokenCache()).purchases(
          '2026-10-01',
          '2026-10-07',
        ),
      ),
    ).toMatchObject({ reason: 'REFUSED', detail: 'Invalid API key' });

    const down: EbarimtFetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(
      await reasonOf(
        new EbarimtApiClient(ACCOUNT, HOSTS, down, new EbarimtTokenCache()).purchases(
          '2026-10-01',
          '2026-10-07',
        ),
      ),
    ).toMatchObject({ reason: 'UNREACHABLE' });

    const broken = ebarimt({
      list: () =>
        json(200, '{"status":200,"data":[{"receiptBuyModelList":[{"amountTotal":"abc"}]}]}'),
    });
    expect(
      await reasonOf(
        new EbarimtApiClient(ACCOUNT, HOSTS, broken.fetchFn, new EbarimtTokenCache()).purchases(
          '2026-10-01',
          '2026-10-07',
        ),
      ),
    ).toMatchObject({ reason: 'BAD_RESPONSE' });
  });

  it('reads numbers from their text', () => {
    const parsed = parseExactJson('{"a":0.1,"b":[2522.727273,1e2],"c":"x"}') as {
      a: { text: string };
      b: { text: string }[];
      c: string;
    };
    expect(parsed.a.text).toBe('0.1');
    expect(parsed.b.map((value) => value.text)).toEqual(['2522.727273', '1e2']);
    expect(parsed.c).toBe('x');
  });
});
