import { EsclClient } from './escl.client';
import { ScannerError, type ScannerFetch } from './scanner.types';

const BASE = 'http://192.168.1.60';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const CAPABILITIES = `<?xml version="1.0"?>
<scan:ScannerCapabilities xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03"
  xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
  <pwg:Version>2.63</pwg:Version>
  <pwg:MakeAndModel>Acme OfficeJet 9000</pwg:MakeAndModel>
  <scan:Platen><scan:PlatenInputCaps/></scan:Platen>
  <scan:Adf><scan:AdfSimplexInputCaps/></scan:Adf>
</scan:ScannerCapabilities>`;

interface Call {
  method: string;
  url: string;
  body: string | null;
}

type Step = (call: Call) => Response;

/** A device scripted step by step; a call beyond the script fails the test. */
function device(steps: Step[]): { fetchFn: ScannerFetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn: ScannerFetch = (url, init) => {
    const call = {
      method: init.method ?? 'GET',
      url,
      body: typeof init.body === 'string' ? init.body : null,
    };
    calls.push(call);
    const step = steps[calls.length - 1];
    if (!step) return Promise.reject(new Error(`unexpected call ${call.method} ${url}`));
    return Promise.resolve(step(call));
  };
  return { fetchFn, calls };
}

const created =
  (location = `${BASE}/eSCL/ScanJobs/abc-123`) =>
  () =>
    new Response(null, { status: 201, headers: { location } });
const sheet = () => () =>
  new Response(new Uint8Array(JPEG), { status: 200, headers: { 'content-type': 'image/jpeg' } });
const status = (code: number) => () => new Response(null, { status: code });

const client = (fetchFn: ScannerFetch) =>
  new EsclClient(`${BASE}/`, fetchFn, 1_000, () => Promise.resolve(), 3_000);

async function failure(promise: Promise<unknown>): Promise<ScannerError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof ScannerError) return error;
    throw error;
  }
  throw new Error('expected a ScannerError');
}

describe('eSCL scanner client', () => {
  it('reads what the device is and which sources it has', async () => {
    const { fetchFn, calls } = device([() => new Response(CAPABILITIES, { status: 200 })]);
    expect(await client(fetchFn).facts()).toEqual({
      model: 'Acme OfficeJet 9000',
      glass: true,
      feeder: true,
    });
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${BASE}/eSCL/ScannerCapabilities` });
  });

  it('says an address that is something else is not a scanner', async () => {
    const page = device([() => new Response('<html>404 File Not Found</html>', { status: 200 })]);
    expect((await failure(client(page.fetchFn).facts())).reason).toBe('NOT_A_SCANNER');
    const missing = device([status(404)]);
    expect((await failure(client(missing.fetchFn).facts())).reason).toBe('NOT_A_SCANNER');
  });

  it('scans one sheet from the glass and frees the device', async () => {
    const { fetchFn, calls } = device([created(), sheet(), status(404)]);
    const pages = await client(fetchFn).scan('GLASS');
    expect(pages).toHaveLength(1);
    expect(pages[0]?.jpeg.equals(JPEG)).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${BASE}/eSCL/ScanJobs`,
      `GET ${BASE}/eSCL/ScanJobs/abc-123/NextDocument`,
      `DELETE ${BASE}/eSCL/ScanJobs/abc-123`,
    ]);
    expect(calls[0]?.body).toContain('<pwg:InputSource>Platen</pwg:InputSource>');
    expect(calls[0]?.body).toContain('<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>');
  });

  it('takes every sheet of the feeder until the device has no more', async () => {
    const { fetchFn, calls } = device([created(), sheet(), sheet(), status(404), status(404)]);
    const pages = await client(fetchFn).scan('FEEDER');
    expect(pages).toHaveLength(2);
    expect(calls[0]?.body).toContain('<pwg:InputSource>Feeder</pwg:InputSource>');
  });

  it('waits while the lamp warms up', async () => {
    const { fetchFn } = device([created(), status(503), status(503), sheet(), status(200)]);
    expect(await client(fetchFn).scan('GLASS')).toHaveLength(1);
  });

  it('keeps to the configured host whatever host the device names', async () => {
    const { fetchFn, calls } = device([
      created('http://printer.local:8080/eSCL/ScanJobs/job_9'),
      sheet(),
      status(200),
    ]);
    await client(fetchFn).scan('GLASS');
    expect(calls[1]?.url).toBe(`${BASE}/eSCL/ScanJobs/job_9/NextDocument`);
  });

  it('names a busy device, an empty feeder and a wrong address', async () => {
    const busy = device([status(503)]);
    expect((await failure(client(busy.fetchFn).scan('GLASS'))).reason).toBe('BUSY');
    const empty = device([status(409)]);
    expect((await failure(client(empty.fetchFn).scan('FEEDER'))).reason).toBe('NO_PAPER');
    const none = device([created(), status(404), status(404)]);
    expect((await failure(client(none.fetchFn).scan('FEEDER'))).reason).toBe('NO_PAPER');
    const other = device([status(404)]);
    expect((await failure(client(other.fetchFn).scan('GLASS'))).reason).toBe('NOT_A_SCANNER');
  });

  it('refuses a sheet that is not a JPEG picture', async () => {
    const { fetchFn } = device([
      created(),
      () => new Response('<html>error</html>', { status: 200 }),
      status(200),
    ]);
    expect((await failure(client(fetchFn).scan('GLASS'))).reason).toBe('INVALID_RESPONSE');
  });

  it('reports a device that does not answer, without its details', async () => {
    const down: ScannerFetch = () => Promise.reject(new TypeError('fetch failed'));
    expect((await failure(client(down).facts())).reason).toBe('NETWORK');
    const slow: ScannerFetch = () =>
      Promise.reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    expect((await failure(client(slow).scan('GLASS'))).reason).toBe('TIMEOUT');
  });
});
