import { describe, expect, it } from 'vitest';
import { requestBodyOf, requestCanonical, requestPendingFor, requestSendKey } from './request-send';

const draft = {
  storeId: 149,
  lines: [
    { productId: 9, productUnitId: 90, qty: '1' },
    { productId: 5, productUnitId: 50, qty: '2' },
  ],
  note: '  Маргааш өглөө  ',
};

describe('the request’s send (ADR-0116 #1)', () => {
  it('builds the body with the lines by product and the note trimmed; none without lines', () => {
    expect(requestBodyOf(draft)).toEqual({
      destWarehouseId: 149,
      note: 'Маргааш өглөө',
      lines: [
        { productId: 5, productUnitId: 50, qty: '2' },
        { productId: 9, productUnitId: 90, qty: '1' },
      ],
    });
    expect(requestBodyOf({ ...draft, note: '' })).not.toHaveProperty('note');
    expect(requestBodyOf({ ...draft, lines: [] })).toBeNull();
  });

  it('keeps one Idempotency-Key for one body, stored per user and server', () => {
    const body = requestBodyOf(draft);
    if (!body) throw new Error('a body');
    const reordered = requestBodyOf({ ...draft, lines: [...draft.lines].reverse() });
    expect(requestCanonical(body)).toBe(requestCanonical(reordered ?? body));
    const now = new Date('2026-10-29T03:00:00Z');
    const first = requestPendingFor(null, body, () => 'key-1', now);
    expect(first).toEqual({
      key: 'key-1',
      body: requestCanonical(body),
      startedAt: now.toISOString(),
    });
    expect(requestPendingFor(first, body, () => 'key-2', now)).toBe(first);
    const changed = { ...body, lines: body.lines.slice(1) };
    expect(requestPendingFor(first, changed, () => 'key-2', now).key).toBe('key-2');
    expect(requestSendKey('http://pc:3300', 9)).toBe('bto.transferSend.v1:http://pc:3300:9');
  });
});
