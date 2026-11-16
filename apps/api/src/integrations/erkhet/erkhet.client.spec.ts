import { ErkhetClient } from './erkhet.client';
import { ErkhetError, type ErkhetFetch } from './erkhet.types';

/** Not a real sign-in: no test reaches Erkhet, every fetch here is scripted. */
const ACCOUNT = {
  baseUrl: 'https://erkhet.test',
  companyId: '1234567890',
  username: 'tester',
  password: 'not-a-real-password',
};
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

interface Sent {
  url: string;
  method: string;
  cookie: string | undefined;
  body: string | undefined;
  referer: string | undefined;
}

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
};

/** A small Erkhet: the sign-in form, the session cookie, the company's home and the lists. */
function erkhet(options: { password?: string; company?: string; list?: () => Response } = {}) {
  const sent: Sent[] = [];
  const fetchFn: ErkhetFetch = (url, init) => {
    const headers = init.headers as Record<string, string>;
    const body = typeof init.body === 'string' ? init.body : undefined;
    sent.push({
      url,
      method: init.method ?? 'GET',
      cookie: headers.Cookie,
      body,
      referer: headers.Referer,
    });
    const { pathname } = new URL(url);
    const signedIn = headers.Cookie?.includes('sessionid=s1') ?? false;
    if (pathname === '/login/' && init.method === 'GET') {
      return Promise.resolve(
        new Response('<form>', { headers: { 'set-cookie': 'csrftoken=t1; Path=/' } }),
      );
    }
    if (pathname === '/login/') {
      const form = new URLSearchParams(body);
      const ok =
        form.get('csrfmiddlewaretoken') === 't1' &&
        form.get('login_with') === ACCOUNT.username &&
        form.get('password') === (options.password ?? ACCOUNT.password);
      return Promise.resolve(
        ok
          ? redirect('/999/', ['sessionid=s1; HttpOnly; Path=/', 'csrftoken=t2; Path=/'])
          : new Response('<form>wrong</form>'),
      );
    }
    if (!signedIn) return Promise.resolve(redirect('/login/?next=' + pathname));
    // The account's own company, and «999», where every sign-in lands first.
    if (pathname === `/${options.company ?? ACCOUNT.companyId}/` || pathname === '/999/') {
      return Promise.resolve(new Response('home'));
    }
    if (pathname.endsWith('/transactions/trs/to-excel/')) {
      return Promise.resolve(
        options.list?.() ??
          new Response(new Uint8Array(XLSX), {
            headers: {
              'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          }),
      );
    }
    return Promise.resolve(redirect('/999/'));
  };
  return { sent, client: new ErkhetClient(ACCOUNT, fetchFn, { page: 1_000, list: 1_000 }) };
}

const failure = async (promise: Promise<unknown>): Promise<ErkhetError> => {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ErkhetError) return error;
    throw error;
  }
  throw new Error('expected an ErkhetError');
};

describe('Erkhet client (ADR-0203)', () => {
  it('signs in with the form token and enters the company of the settings', async () => {
    const { sent, client } = erkhet();
    await client.signIn();
    expect(sent.map((one) => `${one.method} ${new URL(one.url).pathname}`)).toEqual([
      'GET /login/',
      'POST /login/',
      'GET /999/',
      `GET /${ACCOUNT.companyId}/`,
    ]);
    expect(sent[1]?.cookie).toBe('csrftoken=t1');
    expect(sent[1]?.referer).toBe('https://erkhet.test/login/');
    // The cookies of the redirect are kept: the session, and the token it replaced.
    expect(sent[3]?.cookie).toBe('csrftoken=t2; sessionid=s1');
  });

  it('downloads a list from the address of its «Excel» button, with GET only after the sign-in', async () => {
    const { sent, client } = erkhet();
    const file = await client.list('inventory/item/list/');
    expect(file.data.equals(XLSX)).toBe(true);
    const last = sent[sent.length - 1];
    expect(last?.url).toBe(
      `https://erkhet.test/${ACCOUNT.companyId}/transactions/trs/to-excel/?source=/${ACCOUNT.companyId}/inventory/item/list/`,
    );
    expect(sent.filter((one) => one.method !== 'GET').map((one) => one.url)).toEqual([
      'https://erkhet.test/login/',
    ]);
  });

  it('says LOGIN_FAILED when Erkhet shows the form again', async () => {
    const { client } = erkhet({ password: 'another' });
    expect((await failure(client.signIn())).reason).toBe('LOGIN_FAILED');
  });

  it('says COMPANY_UNREACHABLE when the sign-in cannot open the company', async () => {
    const { client } = erkhet({ company: '999' });
    expect((await failure(client.signIn())).reason).toBe('COMPANY_UNREACHABLE');
  });

  it('refuses an answer that is not an Excel file', async () => {
    const { client } = erkhet({ list: () => new Response('<html>report</html>') });
    expect((await failure(client.list('customers/list/'))).reason).toBe('UNEXPECTED_ANSWER');
  });

  it('never follows a redirect to another address, and never sends the password over http', async () => {
    const away: ErkhetFetch = () => Promise.resolve(redirect('https://elsewhere.test/login/'));
    const client = new ErkhetClient(ACCOUNT, away, { page: 1_000, list: 1_000 });
    expect((await failure(client.signIn())).reason).toBe('UNEXPECTED_ANSWER');
    expect(() => new ErkhetClient({ ...ACCOUNT, baseUrl: 'http://erkhet.test' }, away)).toThrow(
      ErkhetError,
    );
  });

  it('tells a timeout from an unreachable address', async () => {
    const timeout: ErkhetFetch = () =>
      Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const down: ErkhetFetch = () => Promise.reject(new TypeError('fetch failed'));
    const timeouts = { page: 1_000, list: 1_000 };
    expect((await failure(new ErkhetClient(ACCOUNT, timeout, timeouts).signIn())).reason).toBe(
      'TIMEOUT',
    );
    expect((await failure(new ErkhetClient(ACCOUNT, down, timeouts).signIn())).reason).toBe(
      'UNREACHABLE',
    );
  });
});
