import {
  type ScannedPage,
  ScannerError,
  type ScannerFacts,
  type ScannerFetch,
  type ScanSource,
} from './scanner.types';

/** One exchange with the device; a sheet passing under the lamp takes ten to twenty seconds. */
export const SCANNER_TIMEOUT_MS = 60_000;
/** How long a started job may keep answering «not ready yet» before the first sheet. */
export const SCANNER_WARMUP_MS = 45_000;
/** Sheets taken from the feeder in one go; a delivery note is a few. */
export const MAX_FEEDER_PAGES = 20;
/** A sheet at 200 dpi in colour is about a megabyte; far beyond that it is not a sheet. */
const MAX_PAGE_BYTES = 12 * 1024 * 1024;
const RESOLUTION_DPI = 200;
const RETRY_MS = 1_000;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/**
 * A network scanner over eSCL (Apple AirScan / Mopria, the driverless protocol nearly every
 * multifunction printer with a network port speaks; plain HTTP and XML, so no driver and no SDK):
 * `GET /eSCL/ScannerCapabilities`, `POST /eSCL/ScanJobs` with the settings, then
 * `GET <job>/NextDocument` per sheet until 404. The job's address is taken from the device's
 * `Location` by its path only: the client never follows a host the device names.
 */
export class EsclClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly fetchFn: ScannerFetch,
    private readonly timeoutMs: number = SCANNER_TIMEOUT_MS,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly warmupMs: number = SCANNER_WARMUP_MS,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  /** What the device is and which sources it has; NOT_A_SCANNER when the address is something else. */
  async facts(): Promise<ScannerFacts> {
    const response = await this.send(`${this.base}/eSCL/ScannerCapabilities`, { method: 'GET' });
    if (!response.ok) {
      await discard(response);
      throw new ScannerError(
        response.status === 404 ? 'NOT_A_SCANNER' : 'HTTP',
        `the device answered HTTP ${response.status}`,
        response.status,
      );
    }
    const xml = await this.text(response);
    if (!/ScannerCapabilities/i.test(xml)) {
      throw new ScannerError('NOT_A_SCANNER', 'the address answers, but not as a scanner');
    }
    const model = /<(?:\w+:)?MakeAndModel>([^<]{1,120})</i.exec(xml)?.[1]?.trim() ?? null;
    return {
      model,
      glass: /<(?:\w+:)?Platen[\s/>]/i.test(xml),
      feeder: /<(?:\w+:)?Adf[\s/>]/i.test(xml),
    };
  }

  /**
   * Scans what lies on the source: one sheet from the glass, every sheet (up to MAX_FEEDER_PAGES)
   * from the feeder. The job is deleted afterwards whatever happened, so the device is free again.
   */
  async scan(source: ScanSource): Promise<ScannedPage[]> {
    const created = await this.send(`${this.base}/eSCL/ScanJobs`, {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: settings(source),
    });
    await discard(created);
    if (created.status !== 201) throw jobRefusal(created.status, source);
    const job = this.jobUrl(created.headers.get('location'));
    try {
      const pages: ScannedPage[] = [];
      const limit = source === 'FEEDER' ? MAX_FEEDER_PAGES : 1;
      while (pages.length < limit) {
        const page = await this.nextPage(job, pages.length === 0);
        if (page === null) break;
        pages.push(page);
      }
      if (pages.length === 0) {
        throw new ScannerError(
          source === 'FEEDER' ? 'NO_PAPER' : 'INVALID_RESPONSE',
          'the device gave no sheet',
        );
      }
      return pages;
    } finally {
      // Best effort: a finished job is already gone on most devices.
      await this.fetchFn(job, { method: 'DELETE', signal: AbortSignal.timeout(5_000) })
        .then(discard)
        .catch(() => undefined);
    }
  }

  /** The next sheet of a job, or null when the job has no more; waits while the lamp warms up. */
  private async nextPage(job: string, first: boolean): Promise<ScannedPage | null> {
    let waited = 0;
    for (;;) {
      const response = await this.send(`${job}/NextDocument`, { method: 'GET' });
      if (response.status === 200) return { jpeg: await this.jpeg(response) };
      await discard(response);
      // 404: no more sheets. 410: the job is over. Both end a job that already gave a sheet.
      if (response.status === 404 || response.status === 410) {
        if (first && response.status === 410) {
          throw new ScannerError('BUSY', 'the device ended the job before a sheet', 410);
        }
        return null;
      }
      if (response.status !== 503 || waited >= this.warmupMs) {
        throw new ScannerError(
          response.status === 503 ? 'BUSY' : 'HTTP',
          `the device answered HTTP ${response.status}`,
          response.status,
        );
      }
      await this.wait(RETRY_MS);
      waited += RETRY_MS;
    }
  }

  /** The job's address on the configured host, whatever host the device wrote into `Location`. */
  private jobUrl(location: string | null): string {
    const path = /\/eSCL\/ScanJobs\/[A-Za-z0-9._~-]{1,128}/.exec(location ?? '')?.[0];
    if (!path) throw new ScannerError('INVALID_RESPONSE', 'the device named no job');
    return `${this.base}${path}`;
  }

  private async jpeg(response: Response): Promise<Buffer> {
    const declared = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (declared > MAX_PAGE_BYTES) {
      await discard(response);
      throw new ScannerError('INVALID_RESPONSE', 'the sheet is larger than a sheet can be');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error: unknown) {
      throw transportError(error, this.timeoutMs);
    }
    if (bytes.length > MAX_PAGE_BYTES || !JPEG_MAGIC.every((byte, at) => bytes[at] === byte)) {
      throw new ScannerError('INVALID_RESPONSE', 'the device did not send a JPEG picture');
    }
    return bytes;
  }

  private async text(response: Response): Promise<string> {
    try {
      return (await response.text()).slice(0, 200_000);
    } catch (error: unknown) {
      throw transportError(error, this.timeoutMs);
    }
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      throw transportError(error, this.timeoutMs);
    }
  }
}

/** The scan settings eSCL takes: a document in colour at 200 dpi, as a JPEG. */
function settings(source: ScanSource): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"',
    ' xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">',
    '<pwg:Version>2.0</pwg:Version>',
    '<scan:Intent>Document</scan:Intent>',
    `<pwg:InputSource>${source === 'FEEDER' ? 'Feeder' : 'Platen'}</pwg:InputSource>`,
    '<scan:ColorMode>RGB24</scan:ColorMode>',
    `<scan:XResolution>${RESOLUTION_DPI}</scan:XResolution>`,
    `<scan:YResolution>${RESOLUTION_DPI}</scan:YResolution>`,
    '<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>',
    '<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>',
    '</scan:ScanSettings>',
  ].join('');
}

/** Why the device would not start: 503 busy, 409 the source cannot be used now, else its status. */
function jobRefusal(status: number, source: ScanSource): ScannerError {
  if (status === 503) return new ScannerError('BUSY', 'the device is busy', status);
  if (status === 409) {
    return new ScannerError(
      source === 'FEEDER' ? 'NO_PAPER' : 'NO_SOURCE',
      'the device cannot scan from that source now',
      status,
    );
  }
  if (status === 404) return new ScannerError('NOT_A_SCANNER', 'the address is not a scanner', 404);
  return new ScannerError('HTTP', `the device answered HTTP ${status}`, status);
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function transportError(error: unknown, timeoutMs: number): ScannerError {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : '';
  return name === 'TimeoutError' || name === 'AbortError'
    ? new ScannerError('TIMEOUT', `the device did not answer within ${timeoutMs} ms`)
    : new ScannerError('NETWORK', 'the device could not be reached');
}
