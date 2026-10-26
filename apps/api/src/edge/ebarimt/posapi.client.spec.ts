import { createServer, type Server } from 'node:http';
import {
  type AddressInfo,
  createServer as createTcpServer,
  type Server as TcpServer,
} from 'node:net';
import { buildPosapiReceipt } from '@tugeel/shared/mn';
import type { EdgeConfig } from '../config/edge-env';
import { PosapiClient } from './posapi.client';
import { PrintableCache } from './printable.cache';

const request = buildPosapiReceipt({
  type: 'B2C',
  merchantTin: '20000000002',
  districtCode: '1234',
  branchNo: null,
  posNo: null,
  customerTin: null,
  consumerNo: null,
  inactiveId: null,
  lines: [
    {
      name: 'Кола',
      barCode: null,
      barCodeType: 'UNDEFINED',
      classificationCode: '1234567',
      taxType: 'VAT_ABLE',
      taxProductCode: null,
      measureUnit: 'ш',
      qty: '1',
      total: '1300',
      vat: '118.18',
      cityTax: '0',
    },
  ],
  payments: [{ code: 'CASH', amount: '1300' }],
});

function clientFor(url: string, timeoutMs = 500): PosapiClient {
  const values: Record<string, unknown> = { POSAPI_URL: url, POSAPI_TIMEOUT_MS: timeoutMs };
  return new PosapiClient({ get: (key: string) => values[key] } as unknown as EdgeConfig);
}

async function listen<T extends Server | TcpServer>(server: T): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function close(server: Server | TcpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

/**
 * How the PosAPI client tells a call that never left from one PosAPI may have acted on
 * (ADR-0065): only the first may be sent again without a supervisor.
 */
describe('PosapiClient', () => {
  it('reports a refused connection as NOT_SENT', async () => {
    const server = createTcpServer();
    const url = await listen(server);
    await close(server);
    const result = await clientFor(url).issue(request);
    expect(result.kind).toBe('NOT_SENT');
  });

  it('reports a connection that never answers as INDETERMINATE', async () => {
    const sockets: { destroy(): void }[] = [];
    const server = createTcpServer((socket) => {
      sockets.push(socket);
      socket.on('data', () => undefined);
    });
    const url = await listen(server);
    const result = await clientFor(url, 300).issue(request);
    expect(result.kind).toBe('INDETERMINATE');
    for (const socket of sockets) socket.destroy();
    await close(server);
  });

  it('reads SUCCESS into the facts and the secrets, and ERROR into a refusal', async () => {
    let answer: object = {};
    let received = '';
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer));
      });
    });
    const url = await listen(server);
    const client = clientFor(url);
    answer = {
      id: '1'.padStart(33, '0'),
      status: 'SUCCESS',
      date: '2026-10-26 10:00:01',
      lottery: 'TEST-LOT-1',
      qrData: 'TEST-QR-1',
    };
    const issued = await client.issue(request);
    expect(issued).toEqual({
      kind: 'ISSUED',
      ddtd: '1'.padStart(33, '0'),
      posapiDate: '2026-10-26 10:00:01',
      secrets: { lottery: 'TEST-LOT-1', qrData: 'TEST-QR-1' },
    });
    expect(JSON.parse(received)).toMatchObject({ totalAmount: 1300, type: 'B2C_RECEIPT' });

    answer = { status: 'ERROR', message: 'TEST refused', lottery: 'TEST-LOT-2' };
    const refused = await client.issue(request);
    expect(refused).toEqual({ kind: 'REFUSED', status: 'ERROR', message: 'TEST refused' });
    expect(JSON.stringify(refused)).not.toContain('TEST-LOT');

    answer = { status: 'SUCCESS' };
    expect((await client.issue(request)).kind).toBe('INDETERMINATE');
    await close(server);
  });
});

describe('PrintableCache', () => {
  const secrets = { lottery: 'TEST-LOT-1', qrData: 'TEST-QR-1' };

  it('reprints a till’s last receipt until its next sale', () => {
    const cache = new PrintableCache();
    cache.rememberLast('К1', 'a', secrets);
    expect(cache.take('К1', 'a')).toEqual(secrets);
    expect(cache.take('К1', 'a')).toEqual(secrets);
    expect(cache.take('К2', 'a')).toBeNull();
    cache.newSale('К1');
    expect(cache.take('К1', 'a')).toBeNull();
  });

  it('gives a late receipt once and drops it with its till’s shift', () => {
    const cache = new PrintableCache();
    cache.rememberLate('К1', 'b', secrets);
    cache.rememberLate('К2', 'c', secrets);
    expect(cache.ready()).toEqual([
      { clientId: 'b', tillCode: 'К1' },
      { clientId: 'c', tillCode: 'К2' },
    ]);
    expect(cache.take('К2', 'b')).toEqual(secrets);
    expect(cache.take('К1', 'b')).toBeNull();
    cache.forgetTill('К2');
    expect(cache.ready()).toEqual([]);
  });
});
