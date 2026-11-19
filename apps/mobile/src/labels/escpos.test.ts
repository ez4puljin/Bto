import { describe, expect, it } from 'vitest';
import { binaryString, bytesOfBase64, CHUNK_BYTES, chunksOf } from './escpos';
import { waitForJob } from './job';

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A plain base64 encoder, independent of the code under test. */
function encode(bytes: Uint8Array): string {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[at], bytes[at + 1], bytes[at + 2]];
    const word = (a << 16) | (b << 8) | c;
    const left = bytes.length - at;
    out += DIGITS[(word >> 18) & 63];
    out += DIGITS[(word >> 12) & 63];
    out += left > 1 ? DIGITS[(word >> 6) & 63] : '=';
    out += left > 2 ? DIGITS[word & 63] : '=';
  }
  return out;
}

describe('the printer bytes', () => {
  it('decodes base64, with and without padding', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, at) => (at * 7) % 256);
    const text = encode(bytes);
    expect([...(bytesOfBase64(text) ?? [])]).toEqual([...bytes]);
    expect([...(bytesOfBase64(text.replace(/=+$/, '')) ?? [])]).toEqual([...bytes]);
    expect([...(bytesOfBase64('G0A=') ?? [])]).toEqual([0x1b, 0x40]);
    expect(bytesOfBase64('')).toEqual(new Uint8Array(0));
    expect(bytesOfBase64('not base64!')).toBeNull();
  });

  it('cuts the bytes into ordered pieces that join back whole', () => {
    const bytes = Uint8Array.from({ length: CHUNK_BYTES * 2 + 5 }, (_, at) => at % 251);
    const pieces = chunksOf(bytes);
    expect(pieces.map((piece) => piece.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 5]);
    expect([...pieces.flatMap((piece) => [...piece])]).toEqual([...bytes]);
    expect(chunksOf(new Uint8Array(0))).toEqual([]);
    expect(chunksOf(new Uint8Array(10), 4).map((piece) => piece.length)).toEqual([4, 4, 2]);
  });

  it('writes one character per byte for the bridge', () => {
    expect(binaryString(Uint8Array.of(0x1b, 0x40, 0xff, 0x00)).length).toBe(4);
    expect(binaryString(Uint8Array.of(0xff)).charCodeAt(0)).toBe(255);
  });
});

describe('a PC printer job', () => {
  const clockOf = () => {
    let now = 0;
    return {
      sleep: (ms: number) => Promise.resolve().then(() => void (now += ms)),
      now: () => now,
    };
  };

  it('is asked every second until it is done', async () => {
    const answers = ['queued', 'printing', 'done'] as const;
    let asked = 0;
    const outcome = await waitForJob(
      () => Promise.resolve({ status: answers[asked++] ?? 'done', error: null }),
      clockOf(),
    );
    expect(outcome).toEqual({ ok: true });
    expect(asked).toBe(3);
  });

  it('reports a failed job with its code and the printer’s words', async () => {
    const outcome = await waitForJob(
      () =>
        Promise.resolve({
          status: 'failed' as const,
          error: 'PRINTER_OFFLINE',
          detail: 'paper out',
        }),
      clockOf(),
    );
    expect(outcome).toEqual({
      ok: false,
      reason: 'failed',
      error: 'PRINTER_OFFLINE',
      detail: 'paper out',
    });
  });

  it('keeps asking through a dropped connection and gives up after the time', async () => {
    let asked = 0;
    const outcome = await waitForJob(
      () => {
        asked += 1;
        return Promise.reject(new Error('network'));
      },
      clockOf(),
      { maxMs: 5_000 },
    );
    expect(outcome).toEqual({ ok: false, reason: 'timeout', error: null, detail: null });
    expect(asked).toBe(6);
  });
});
