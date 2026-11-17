import { describe, expect, it, vi } from 'vitest';
import {
  KHAN_TERMINAL_URL,
  KHAN_TERMINAL_URL_KEY,
  KhanTerminal,
  TerminalUnavailable,
  khanTerminalUrl,
} from './khan-terminal';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** `get-status-info` exactly as the service on the till PC answered (2026-11-13). */
const STATUS = {
  status_code: 'ok',
  ret: {
    goconn_version: '2.1.5.199',
    init_date: '2026-11-13 17:19:25',
    init_mode: 'NORMAL',
    port_num: 'COM7',
    reader_id: '0800755030',
    terminal_id: '70107480',
    terminal_name: 'Orgil buunii tuv 1',
    terminal_version: '584',
  },
  msg: {},
};

function terminalWith(answer: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));
  return { terminal: new KhanTerminal({ url: 'http://till.test:27028', fetch }), fetch };
}

const SALE = { refNo: '202611170003', amount: '12500.00', billType: '1' as const };

/** The JSON a call sent (the client always sends a string). */
const sentBy = (init: RequestInit | undefined): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : null;

describe('khan terminal: the status question', () => {
  it('reads the terminal the service names', async () => {
    const { terminal, fetch } = terminalWith(() => json(STATUS));
    await expect(terminal.checkStatus()).resolves.toEqual({
      terminalId: '70107480',
      terminalName: 'Orgil buunii tuv 1',
      port: 'COM7',
      version: '2.1.5.199',
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://till.test:27028/ajax/get-status-info');
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('GET');
  });

  it('is unavailable when the service is not there or does not say ok', async () => {
    const down = terminalWith(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(down.terminal.checkStatus()).rejects.toBeInstanceOf(TerminalUnavailable);
    const notOk = terminalWith(() => json({ status_code: 'error', ret: {}, msg: {} }));
    await expect(notOk.terminal.checkStatus()).rejects.toBeInstanceOf(TerminalUnavailable);
    const notJson = terminalWith(() => new Response('<html>', { status: 200 }));
    await expect(notJson.terminal.checkStatus()).rejects.toBeInstanceOf(TerminalUnavailable);
  });

  it('takes its address from this browser’s setting, the installed one by default', () => {
    expect(khanTerminalUrl()).toBe(KHAN_TERMINAL_URL);
    localStorage.setItem(KHAN_TERMINAL_URL_KEY, ' http://127.0.0.1:27999/ ');
    expect(khanTerminalUrl()).toBe('http://127.0.0.1:27999');
    localStorage.removeItem(KHAN_TERMINAL_URL_KEY);
  });
});

describe('khan terminal: a sale (always a mocked fetch — a real one moves real money)', () => {
  it('sends the amount in tögrög as a string, once, and approves only on "000"', async () => {
    const approved = { status: true, response: { response_code: '000', response_msg: 'Approved' } };
    const { terminal, fetch } = terminalWith(() => json(approved));
    await expect(terminal.sale(SALE)).resolves.toEqual({ outcome: 'APPROVED', response: approved });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('http://till.test:27028');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    // No timeout of ours: the answer comes when the card and the PIN are done.
    expect(init?.signal).toBeUndefined();
    expect(sentBy(init)).toEqual({
      service_name: 'doSaleTransaction',
      service_params: { db_ref_no: '202611170003', amount: '12500', vatps_bill_type: '1' },
    });
  });

  it('keeps a fraction of a tögrög as it is and never multiplies', async () => {
    const { terminal, fetch } = terminalWith(() =>
      json({ status: true, response: { response_code: '000' } }),
    );
    await terminal.sale({ ...SALE, amount: '4284.50', billType: '3' });
    expect(sentBy(fetch.mock.calls[0]?.[1])).toMatchObject({
      service_params: { amount: '4284.5', vatps_bill_type: '3' },
    });
  });

  it('is declined on any other code, with the terminal’s message', async () => {
    const declined = {
      status: true,
      response: { response_code: '051', response_msg: 'Үлдэгдэл хүрэлцэхгүй' },
    };
    const { terminal } = terminalWith(() => json(declined));
    await expect(terminal.sale(SALE)).resolves.toEqual({
      outcome: 'DECLINED',
      response: declined,
      message: 'Үлдэгдэл хүрэлцэхгүй',
    });
    // A number 0 or the settlement's `true` is not a sale's success.
    const odd = terminalWith(() => json({ status: true, response: { response_code: true } }));
    await expect(odd.terminal.sale(SALE)).resolves.toMatchObject({ outcome: 'DECLINED' });
  });

  it('is failed on the service’s own Exception', async () => {
    const failed = {
      status: false,
      response: { Exception: { ErrorCode: 'E01', ErrorMessage: 'Терминал холбогдоогүй' } },
    };
    const { terminal } = terminalWith(() => json(failed));
    await expect(terminal.sale(SALE)).resolves.toEqual({
      outcome: 'FAILED',
      response: failed,
      message: 'Терминал холбогдоогүй',
    });
  });

  it('is unknown — never approved, never sent again — when no usable answer came back', async () => {
    const broken = terminalWith(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(broken.terminal.sale(SALE)).resolves.toEqual({
      outcome: 'UNKNOWN',
      response: null,
      message: 'Failed to fetch',
    });
    expect(broken.fetch).toHaveBeenCalledTimes(1);
    const notJson = terminalWith(() => new Response('', { status: 502 }));
    await expect(notJson.terminal.sale(SALE)).resolves.toMatchObject({ outcome: 'UNKNOWN' });
    const noResponse = terminalWith(() => json({ status: true }));
    await expect(noResponse.terminal.sale(SALE)).resolves.toEqual({
      outcome: 'UNKNOWN',
      response: { status: true },
      message: null,
    });
  });
});

describe('khan terminal: the settlement', () => {
  it('succeeds on response_code true, not on "000"', async () => {
    const done = { status: true, response: { response_code: true } };
    const { terminal, fetch } = terminalWith(() => json(done));
    await expect(terminal.settlement('202611170009')).resolves.toEqual({
      outcome: 'APPROVED',
      response: done,
    });
    expect(sentBy(fetch.mock.calls[0]?.[1])).toEqual({
      service_name: 'doSettlement',
      service_params: { db_ref_no: '202611170009' },
    });
    const sale = terminalWith(() =>
      json({ status: true, response: { response_code: '000', response_msg: 'Хаагдсангүй' } }),
    );
    await expect(sale.terminal.settlement('1')).resolves.toMatchObject({
      outcome: 'DECLINED',
      message: 'Хаагдсангүй',
    });
  });
});

describe('khan terminal: asking about a reference (getLastTransaction)', () => {
  /** The real terminal's answer for Erxes' order 20261117_0087 (2026-11-17). */
  const FOUND = {
    status: true,
    response: {
      aid: '37303130373438305F323032363131313730303837',
      amount: '300',
      app_name: 'PASS',
      bank_mb_code: '05',
      batch_no: '000000001529',
      card_holder_name: '',
      date: '11/17',
      db_ref_no: '202611170087',
      entry_mode: 'Qr',
      merchant_id: '000000010174585',
      merchant_name: 'Orgil buunii tuv 1',
      model: 'Q80',
      pan: '438054XXXXXX5538',
      pos_firmware: '2.6.102',
      reader_id: '0800755030',
      response_code: '000',
      response_msg: 'Гүйлгээ зөвшөөрөгдсөн.',
      rrn: '008209672971',
      term_app_name: 'DtbProlin',
      terminal_date: '20261117115559',
      terminal_id: '70107480',
      time: '11:55:05',
      trace_no: '183607',
    },
  };

  it('finds the approved transaction of the reference, with its amount', async () => {
    const { terminal, fetch } = terminalWith(() => json(FOUND));
    await expect(terminal.lookup('202611170087')).resolves.toEqual({
      found: 'APPROVED',
      response: FOUND,
      amount: '300',
    });
    expect(sentBy(fetch.mock.calls[0]?.[1])).toEqual({
      service_name: 'getLastTransaction',
      service_params: { db_ref_no: '202611170087' },
    });
  });

  it('says none on 38B, and decides nothing on anything else', async () => {
    const none = {
      status: true,
      response: { response_code: '38B', response_msg: 'Гүйлгээ олдсонгүй' },
    };
    await expect(terminalWith(() => json(none)).terminal.lookup('1')).resolves.toEqual({
      found: 'NONE',
      response: none,
    });
    // The service's Exception (an empty reference), an unknown service, another code.
    const exception = { status: false, response: { Exception: { ErrorCode: '003' } } };
    await expect(terminalWith(() => json(exception)).terminal.lookup('')).resolves.toMatchObject({
      found: 'OTHER',
    });
    const other = {
      status: true,
      response: { response_code: 'D09', response_msg: 'Not support command' },
    };
    await expect(terminalWith(() => json(other)).terminal.lookup('1')).resolves.toMatchObject({
      found: 'OTHER',
      message: 'Not support command',
    });
    // An approved answer about another reference is not this charge's.
    await expect(
      terminalWith(() => json(FOUND)).terminal.lookup('20261117900087'),
    ).resolves.toMatchObject({
      found: 'OTHER',
    });
    const broken = terminalWith(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(broken.terminal.lookup('1')).resolves.toEqual({
      found: 'UNKNOWN',
      message: 'Failed to fetch',
    });
  });
});
