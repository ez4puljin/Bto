import {
  type ErkhetAccount,
  ErkhetError,
  type ErkhetFetch,
  type ErkhetListFile,
} from './erkhet.types';

/** The sign-in pages answer fast; a list of 13,000 items takes Erkhet a while to write. */
export const ERKHET_PAGE_TIMEOUT_MS = 60_000;
export const ERKHET_LIST_TIMEOUT_MS = 300_000;
/** A list larger than this is not one of ours (the item list is under 2 MiB). */
const MAX_LIST_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 6;
/** Erkhet refuses clients that do not look like a browser. */
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
/** An .xlsx is a zip. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

interface Answer {
  response: Response;
  /** Where the redirects ended. */
  url: URL;
}

/**
 * Erkhet over plain `fetch` (ADR-0203). Erkhet has no API: it is a web application with a session
 * cookie, and its lists come from the address its own «Excel» button opens. So this client signs
 * in as a browser would, keeps the cookies itself and follows the redirects by hand to see them.
 *
 * After the sign-in it sends GET requests only: nothing here can change Erkhet's books. One
 * client serves one check and is thrown away, so no session outlives it.
 */
export class ErkhetClient {
  private readonly origin: string;
  private readonly cookies = new Map<string, string>();
  private signedIn = false;

  constructor(
    private readonly account: ErkhetAccount,
    private readonly fetchFn: ErkhetFetch,
    private readonly timeouts: { page: number; list: number } = {
      page: ERKHET_PAGE_TIMEOUT_MS,
      list: ERKHET_LIST_TIMEOUT_MS,
    },
  ) {
    let url: URL;
    try {
      url = new URL(account.baseUrl);
    } catch {
      throw new ErkhetError('UNREACHABLE', 'the address is not a URL');
    }
    // The password goes only to an encrypted address.
    if (url.protocol !== 'https:') throw new ErkhetError('UNREACHABLE', 'the address is not https');
    this.origin = url.origin;
  }

  /** Signs in and enters the company; throws an `ErkhetError` saying which step failed. */
  async signIn(): Promise<void> {
    const loginUrl = `${this.origin}/login/`;
    await this.request('GET', loginUrl, this.timeouts.page);
    const token = this.cookies.get('csrftoken') ?? '';
    const form = new URLSearchParams({
      csrfmiddlewaretoken: token,
      login_with: this.account.username,
      password: this.account.password,
    });
    const signed = await this.request('POST', loginUrl, this.timeouts.page, form);
    if (isLoginPage(signed.url) || !signed.response.ok) {
      throw new ErkhetError(
        'LOGIN_FAILED',
        'Erkhet did not accept the sign-in',
        signed.response.status,
      );
    }
    // One sign-in may hold several companies: the one of the settings, never where the sign-in led.
    const home = await this.request('GET', this.companyUrl(''), this.timeouts.page);
    if (!home.response.ok || !this.insideCompany(home.url)) {
      throw new ErkhetError(
        'COMPANY_UNREACHABLE',
        'the sign-in cannot open the company',
        home.response.status,
      );
    }
    this.signedIn = true;
  }

  /** A list as an .xlsx: the address of the «Excel» button on the list's page. */
  async list(listPath: string): Promise<ErkhetListFile> {
    if (!this.signedIn) await this.signIn();
    const source = `/${this.account.companyId}/${listPath.replace(/^\/+/, '')}`;
    const url = `${this.companyUrl('transactions/trs/to-excel/')}?source=${encodeURIComponent(source).replace(/%2F/g, '/')}`;
    const answer = await this.request('GET', url, this.timeouts.list);
    if (isLoginPage(answer.url)) {
      throw new ErkhetError('LOGIN_FAILED', 'the session ended before the list came');
    }
    if (!answer.response.ok) {
      throw new ErkhetError(
        'UNEXPECTED_ANSWER',
        `the list answered HTTP ${answer.response.status}`,
        answer.response.status,
      );
    }
    let data: Buffer;
    try {
      data = Buffer.from(await answer.response.arrayBuffer());
    } catch (error: unknown) {
      throw transportError(error, this.timeouts.list);
    }
    if (data.length > MAX_LIST_BYTES || !ZIP_MAGIC.every((byte, at) => data[at] === byte)) {
      throw new ErkhetError('UNEXPECTED_ANSWER', 'the list did not come as an Excel file');
    }
    return { data, size: data.length };
  }

  private companyUrl(path: string): string {
    return `${this.origin}/${this.account.companyId}/${path}`;
  }

  private insideCompany(url: URL): boolean {
    return (
      url.origin === this.origin &&
      (url.pathname === `/${this.account.companyId}` ||
        url.pathname.startsWith(`/${this.account.companyId}/`))
    );
  }

  /**
   * One request with its redirects followed by hand, so every `Set-Cookie` on the way is kept
   * (the sign-in answers 302 with the session cookie). A redirect that leaves Erkhet's address is
   * refused: the cookies and the form go nowhere else.
   */
  private async request(
    method: 'GET' | 'POST',
    start: string,
    timeoutMs: number,
    form?: URLSearchParams,
  ): Promise<Answer> {
    let url = new URL(start);
    let verb = method;
    let body = form;
    const signal = AbortSignal.timeout(timeoutMs);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (url.origin !== this.origin) {
        throw new ErkhetError('UNEXPECTED_ANSWER', 'Erkhet redirected to another address');
      }
      const headers: Record<string, string> = {
        'User-Agent': USER_AGENT,
        Accept: '*/*',
      };
      if (this.cookies.size > 0) {
        headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
      }
      if (verb === 'POST' && body) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers.Referer = url.toString();
        headers.Origin = this.origin;
      }
      let response: Response;
      try {
        response = await this.fetchFn(url.toString(), {
          method: verb,
          headers,
          redirect: 'manual',
          signal,
          ...(verb === 'POST' && body ? { body: body.toString() } : {}),
        });
      } catch (error: unknown) {
        throw transportError(error, timeoutMs);
      }
      this.keepCookies(response);
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        // The body of a redirect is never read; free the connection.
        await response.body?.cancel().catch(() => undefined);
        try {
          url = new URL(location, url);
        } catch {
          throw new ErkhetError('UNEXPECTED_ANSWER', 'Erkhet redirected to a broken address');
        }
        // Erkhet sits behind a TLS proxy and writes its own redirects as http:// (seen 2026-11-16);
        // its HSTS header makes a browser go to https:// instead, and so does this client. Only
        // for the same host: another host is still refused below.
        if (url.protocol === 'http:' && url.host === new URL(this.origin).host) {
          url.protocol = 'https:';
        }
        verb = 'GET';
        body = undefined;
        continue;
      }
      return { response, url };
    }
    throw new ErkhetError('UNEXPECTED_ANSWER', 'Erkhet redirected too many times');
  }

  private keepCookies(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';', 1)[0] ?? '';
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === '' || value === '""') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

function isLoginPage(url: URL): boolean {
  return url.pathname.startsWith('/login');
}

/** By name: the abort reason is a DOMException, which may come from another realm than `Error`. */
function isAbort(error: unknown): boolean {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function transportError(error: unknown, timeoutMs: number): ErkhetError {
  if (error instanceof ErkhetError) return error;
  if (isAbort(error)) return new ErkhetError('TIMEOUT', `no answer within ${timeoutMs} ms`);
  return new ErkhetError('UNREACHABLE', 'Erkhet could not be reached');
}
