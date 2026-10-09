import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import pino from 'pino';
import { genReqId, REDACT_PATHS } from './logger.config';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString('utf8'));
      done();
    },
  });
  const logger = pino({ redact: { paths: REDACT_PATHS, remove: true } }, stream);
  return { logger, output: () => lines.join('') };
}

describe('logger redaction', () => {
  it('removes credentials and e-Barimt lottery/qrData at depths 0 to 3', () => {
    const { logger, output } = capture();
    logger.info(
      {
        lottery: 'AB 12345678',
        qrData: 'qr-0',
        receipt: { lottery: 'L1', qrData: 'qr-1', ddtd: 'keep-me-1' },
        response: { body: { lottery: 'L2', qrData: 'qr-2', items: { lottery: 'L3' } } },
        req: { headers: { authorization: 'Bearer secret-token', cookie: 'sid=secret-cookie' } },
        password: 'p4ss',
      },
      'receipt issued',
    );
    const text = output();
    for (const secret of ['AB 12345678', 'L1', 'L2', 'L3', 'qr-0', 'qr-1', 'qr-2']) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('secret-cookie');
    expect(text).not.toContain('p4ss');
    expect(text).toContain('keep-me-1');
  });
});

describe('genReqId', () => {
  const run = (incoming?: string) => {
    const headers: Record<string, string> = {};
    const req = { headers: incoming ? { 'x-request-id': incoming } : {} } as IncomingMessage;
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as ServerResponse;
    return { id: genReqId(req, res), echoed: headers['x-request-id'] };
  };

  it('reuses a well-formed incoming id and echoes it', () => {
    expect(run('client-generated-id-1')).toEqual({
      id: 'client-generated-id-1',
      echoed: 'client-generated-id-1',
    });
  });

  it('replaces a malformed or missing id with a UUID', () => {
    for (const incoming of [undefined, 'short', 'bad id with spaces', 'x'.repeat(200)]) {
      const { id, echoed } = run(incoming);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(echoed).toBe(id);
    }
  });
});
