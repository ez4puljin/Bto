import { ErkhetClient } from './erkhet.client';
import { ErkhetError, type ErkhetFetch } from './erkhet.types';

/** Not a real sign-in: every fetch here is scripted. */
const ACCOUNT = {
  baseUrl: 'https://erkhet.test',
  companyId: '1234567890',
  username: 'tester',
  password: 'not-a-real-password',
};

interface Sent {
  method: string;
  path: string;
  query: URLSearchParams;
  xhr: boolean;
}

/** A small Erkhet that signs anybody in and answers the journal's three addresses. */
function erkhet(actions: unknown = { status: 'ok' }) {
  const sent: Sent[] = [];
  const fetchFn: ErkhetFetch = (url, init) => {
    const parsed = new URL(url);
    const headers = init.headers as Record<string, string>;
    sent.push({
      method: init.method ?? 'GET',
      path: parsed.pathname,
      query: parsed.searchParams,
      xhr: headers['X-Requested-With'] === 'XMLHttpRequest',
    });
    const company = `/${ACCOUNT.companyId}/`;
    if (parsed.pathname === '/login/' && init.method === 'GET') {
      return Promise.resolve(
        new Response('<form>', { headers: { 'set-cookie': 'csrftoken=t1; Path=/' } }),
      );
    }
    if (parsed.pathname === '/login/') {
      const headersOut = new Headers({ location: company });
      headersOut.append('set-cookie', 'sessionid=s1; Path=/');
      return Promise.resolve(new Response(null, { status: 302, headers: headersOut }));
    }
    if (parsed.pathname === company) return Promise.resolve(new Response('<html>home</html>'));
    if (parsed.pathname === `${company}transactions/get-filter-form/`) {
      return Promise.resolve(
        Response.json({
          content:
            '<select name="account"><option value="9">120101 - Туршилтын авлага</option></select>',
        }),
      );
    }
    if (parsed.pathname === `${company}transactions/get-ptr-actions/`) {
      return Promise.resolve(Response.json(actions));
    }
    if (parsed.pathname === `${company}transactions/`) {
      return Promise.resolve(new Response('<script>var items = [];</script>'));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  };
  return { sent, fetchFn };
}

describe('ErkhetClient, the general journal', () => {
  it('asks for a page with the dates, the account id and the page number', async () => {
    const server = erkhet();
    const client = new ErkhetClient(ACCOUNT, server.fetchFn);
    const html = await client.journalPage({
      from: '2026-10-01',
      to: '2026-10-31',
      account: '9',
      page: 3,
    });
    expect(html).toContain('var items');
    const request = server.sent.at(-1);
    expect(request?.path).toBe('/1234567890/transactions/');
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      date1: '2026-10-01',
      date2: '2026-10-31',
      account: '9',
      page: '3',
    });
  });

  it('reads the account ids from the filter form as a background request', async () => {
    const server = erkhet();
    const ids = await new ErkhetClient(ACCOUNT, server.fetchFn).accountIds();
    expect(ids.get('120101')).toBe('9');
    expect(server.sent.at(-1)).toMatchObject({ xhr: true, method: 'GET' });
  });

  it('takes the update address of a transaction and never follows its delete address', async () => {
    const server = erkhet({
      status: 'ok',
      update_url: '/1234567890/debt/trs/update/77/',
      delete_url: '/1234567890/debt/trs/delete/77/',
    });
    const client = new ErkhetClient(ACCOUNT, server.fetchFn);
    expect(await client.transactionPath(77)).toBe('/1234567890/debt/trs/update/77/');
    expect(server.sent.some((request) => request.path.includes('delete'))).toBe(false);
    // Everything after the sign-in form is a GET.
    expect(
      server.sent.filter((request) => request.method !== 'GET').map((request) => request.path),
    ).toEqual(['/login/']);
  });

  it('gives no address when Erkhet names none', async () => {
    const server = erkhet({ status: 'error' });
    expect(await new ErkhetClient(ACCOUNT, server.fetchFn).transactionPath(77)).toBeNull();
  });

  it('fails clearly when an answer is not JSON', async () => {
    const server = erkhet();
    const fetchFn: ErkhetFetch = (url, init) =>
      url.includes('get-ptr-actions')
        ? Promise.resolve(new Response('<html>'))
        : server.fetchFn(url, init);
    await expect(new ErkhetClient(ACCOUNT, fetchFn).transactionPath(1)).rejects.toMatchObject({
      reason: 'UNEXPECTED_ANSWER',
    });
    await expect(new ErkhetClient(ACCOUNT, fetchFn).transactionPath(1)).rejects.toBeInstanceOf(
      ErkhetError,
    );
  });
});
