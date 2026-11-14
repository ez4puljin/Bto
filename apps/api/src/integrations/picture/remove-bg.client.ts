import { z } from 'zod';
import {
  type BackgroundRemover,
  type CutOut,
  type PictureAccount,
  PictureError,
  type PictureFetch,
  type PicturePhoto,
} from './picture.types';

/** remove.bg's API (https://www.remove.bg/api): the key travels in `X-Api-Key`, to this host only. */
export const REMOVE_BG_BASE_URL = 'https://api.remove.bg/v1.0';
/** One exchange, the picture's download included. No retry: the person presses the button again. */
export const PICTURE_TIMEOUT_MS = 60_000;
/** A cut-out larger than this is not a product photo of ours (ours are 1280 px at most). */
const MAX_RESULT_BYTES = 20 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PROVIDER_CODE = /^[A-Za-z0-9_.-]{1,64}$/;
const CREDITS = /^\d{1,9}(\.\d{1,4})?$/;

const Account = z.object({
  data: z.object({
    attributes: z.object({
      credits: z.object({ total: z.number().nonnegative() }).partial().optional(),
      api: z.object({ free_calls: z.number().int().nonnegative() }).partial().optional(),
    }),
  }),
});

/**
 * remove.bg over plain `fetch` (no SDK, like the model providers of ADR-0045). The photo goes as a
 * multipart file and the answer is the PNG itself; an error answers JSON
 * `{ errors: [{ title, code }] }`, of which only the code is kept.
 */
export class RemoveBgClient implements BackgroundRemover {
  readonly provider = 'removebg' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: PictureFetch,
    private readonly timeoutMs: number = PICTURE_TIMEOUT_MS,
    private readonly baseUrl: string = REMOVE_BG_BASE_URL,
  ) {}

  async cutOut(photo: PicturePhoto): Promise<CutOut> {
    const form = new FormData();
    form.set('size', 'auto');
    form.set('format', 'png');
    form.set(
      'image_file',
      new Blob([new Uint8Array(photo.data)], { type: photo.mediaType }),
      'photo',
    );
    const response = await this.send('removebg', { method: 'POST', body: form });
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error: unknown) {
      throw transportError(error, this.timeoutMs);
    }
    if (bytes.length > MAX_RESULT_BYTES || !PNG_MAGIC.every((byte, at) => bytes[at] === byte)) {
      throw new PictureError('INVALID_RESPONSE', 'the service did not answer with a PNG');
    }
    const charged = response.headers.get('x-credits-charged');
    return {
      png: bytes,
      creditsCharged: charged !== null && CREDITS.test(charged) ? charged : null,
    };
  }

  async account(): Promise<PictureAccount> {
    const response = await this.send('account', { method: 'GET' });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error: unknown) {
      if (isAbort(error)) throw transportError(error, this.timeoutMs);
      throw new PictureError('INVALID_RESPONSE', 'the service did not answer with JSON');
    }
    const parsed = Account.safeParse(payload);
    if (!parsed.success) {
      throw new PictureError('INVALID_RESPONSE', 'the account answer has an unexpected shape');
    }
    const { credits, api } = parsed.data.data.attributes;
    return {
      credits: credits?.total === undefined ? null : String(credits.total),
      freeCalls: api?.free_calls ?? null,
    };
  }

  /** Sends one request and returns an OK response, or throws a `PictureError`. */
  private async send(name: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchFn(`${this.baseUrl.replace(/\/+$/, '')}/${name}`, {
        ...init,
        headers: { 'X-Api-Key': this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw transportError(error, this.timeoutMs);
    }
    if (response.ok) return response;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined; // not JSON
    }
    throw new PictureError('HTTP', `the service answered HTTP ${response.status}`, {
      status: response.status,
      providerCode: providerCodeOf(payload),
    });
  }
}

/** By name: the abort reason is a DOMException, which may come from another realm than `Error`. */
function isAbort(error: unknown): boolean {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

function transportError(error: unknown, timeoutMs: number): PictureError {
  if (isAbort(error)) return new PictureError('TIMEOUT', `no answer within ${timeoutMs} ms`);
  return new PictureError('NETWORK', 'the service could not be reached');
}

/** `{ errors: [{ code }] }`: the first code, when it looks like one; the titles are dropped. */
function providerCodeOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const { errors } = payload as { errors?: unknown };
  if (!Array.isArray(errors)) return undefined;
  const first: unknown = errors[0];
  if (typeof first !== 'object' || first === null) return undefined;
  const { code } = first as { code?: unknown };
  return typeof code === 'string' && PROVIDER_CODE.test(code) ? code : undefined;
}
