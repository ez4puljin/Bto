import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/** What a POST /rest/receipt does: answers SUCCESS, refuses, or takes it and never answers. */
export type FakeReceiptMode = 'ok' | 'error' | 'hang';

export interface FakePosapiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

/** Synthetic values only: never a real TIN, ДДТД, lottery or QR. */
export const FAKE_MERCHANT = { tin: '20000000002', name: 'Туршилтын худалдагч' } as const;
export const FAKE_BUYER = { regNo: '1234567', tin: '10000000001', name: 'Туршилт ХХК' } as const;

/**
 * A stand-in for the store PosAPI 3.0 and the tax office's taxpayer lookup (ADR-0065): tests never
 * reach a real one. It numbers receipts itself (a 33-digit id), answers a lottery and QR data
 * marked TEST-LOT- / TEST-QR- (so a test can look for them where they must never be), records
 * every call, and can be stopped and started again on the same port to play PosAPI being away.
 */
export class FakePosapi {
  readonly calls: FakePosapiCall[] = [];
  mode: FakeReceiptMode = 'ok';
  lookupOffline = false;
  private issued = 0;
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private port = 0;

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** The receipts POSTed so far, in order. */
  receiptPosts(): Record<string, unknown>[] {
    return this.calls
      .filter((call) => call.method === 'POST' && call.path === '/rest/receipt')
      .map((call) => call.body as Record<string, unknown>);
  }

  deletes(): Record<string, unknown>[] {
    return this.calls
      .filter((call) => call.method === 'DELETE' && call.path === '/rest/receipt')
      .map((call) => call.body as Record<string, unknown>);
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res));
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(this.port, '127.0.0.1', () => resolve()));
    this.port = (server.address() as AddressInfo).port;
    this.server = server;
  }

  /** PosAPI is away: the port refuses connections until `start()`. */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const body: unknown = text ? JSON.parse(text) : null;
    this.calls.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      body,
    });
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /rest/info') {
      send(200, {
        operatorName: 'TEST OPERATOR',
        posNo: '00000001',
        version: '3.2.50',
        lastSentDate: '2026-10-26 09:00:00',
        leftLotteries: 9000,
        merchants: [{ ...FAKE_MERCHANT, vatPayer: true, customers: [] }],
      });
      return;
    }
    if (route === 'POST /rest/receipt') {
      if (this.mode === 'hang') return; // taken, never answered: the edge times out
      if (this.mode === 'error') {
        send(200, { status: 'ERROR', message: 'TEST: the receipt was refused' });
        return;
      }
      this.issued += 1;
      const n = String(this.issued);
      send(200, {
        id: n.padStart(33, '0'),
        posId: 1,
        status: 'SUCCESS',
        message: '',
        qrData: `TEST-QR-${n}`,
        lottery: `TEST-LOT-${n}`,
        date: `2026-10-26 10:00:${n.padStart(2, '0')}`,
        easy: false,
        receipts: [{ id: `${n}`.padStart(33, '1') }],
      });
      return;
    }
    if (route === 'DELETE /rest/receipt') {
      send(200, {});
      return;
    }
    if (route === 'GET /rest/sendData') {
      send(200, {});
      return;
    }
    if (url.pathname.startsWith('/api/info/check/')) {
      if (this.lookupOffline) {
        req.socket.destroy();
        return;
      }
      if (url.pathname.endsWith('/getTinInfo')) {
        const found = url.searchParams.get('regNo') === FAKE_BUYER.regNo;
        send(200, found ? { status: 200, data: FAKE_BUYER.tin } : { status: 500, data: null });
        return;
      }
      if (url.pathname.endsWith('/getInfo')) {
        const found = url.searchParams.get('tin') === FAKE_BUYER.tin;
        send(
          200,
          found
            ? { status: 200, data: { name: FAKE_BUYER.name, vatPayer: true, found: true } }
            : { status: 500, data: null },
        );
        return;
      }
    }
    send(404, { message: 'not found' });
  }
}
