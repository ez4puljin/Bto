import type { ApiClient } from '@tugeel/api-client';
import { createApiClient } from '@tugeel/api-client';
import { describe, expect, it, vi } from 'vitest';
import { layoutDigit } from '@/lib/barcode-keys';
import { fitWithin, resizeToJpeg, UnsupportedImageError } from '@/lib/image-resize';
import { ApiProblem } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';

const press = (key: string, code: string, modifiers: Partial<Record<string, boolean>> = {}) => ({
  key,
  code,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...modifiers,
});

describe('layoutDigit', () => {
  it('reads number-row digits from the physical key when the layout typed a symbol', () => {
    // Mongolian Cyrillic layout: the unshifted number row types symbols.
    expect(layoutDigit(press('№', 'Digit1'))).toBe('1');
    expect(layoutDigit(press('₮', 'Digit4'))).toBe('4');
    expect(layoutDigit(press('?', 'Digit0'))).toBe('0');
  });

  it('leaves digits, letters, shifted and shortcut keys alone', () => {
    expect(layoutDigit(press('7', 'Digit7'))).toBeNull();
    expect(layoutDigit(press('7', 'Numpad7'))).toBeNull();
    expect(layoutDigit(press('End', 'Numpad1'))).toBeNull();
    expect(layoutDigit(press('у', 'KeyE'))).toBeNull();
    expect(layoutDigit(press('!', 'Digit1', { shiftKey: true }))).toBeNull();
    expect(layoutDigit(press('c', 'Digit1', { ctrlKey: true }))).toBeNull();
  });
});

describe('fitWithin', () => {
  it('scales the longest side down to the limit and keeps the aspect ratio', () => {
    expect(fitWithin(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(3024, 4032, 256)).toEqual({ width: 192, height: 256 });
    expect(fitWithin(5000, 10, 256)).toEqual({ width: 256, height: 1 });
  });

  it('never enlarges a small photo', () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ width: 640, height: 480 });
  });
});

describe('resizeToJpeg', () => {
  it('refuses files the browser cannot turn into a JPEG before decoding them', async () => {
    const heic = new Blob([new Uint8Array([0, 0, 0, 24])], { type: 'image/heic' });
    await expect(resizeToJpeg(heic, 1280)).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});

describe('uploadFile', () => {
  const issued = {
    fileId: 41,
    uploadUrl: '/api/v1/files/local/abc.jpg?exp=1&sig=xyz',
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    expiresAt: '2026-10-11T00:15:00.000Z',
  };
  const client = (presign: (request: Request) => Promise<Response>): ApiClient =>
    createApiClient({
      baseUrl: 'http://tugeel.test',
      getToken: () => 'access-token',
      fetch: presign,
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    });

  it('presigns with the blob type and size, then PUTs the bytes without the token', async () => {
    let presigned: unknown;
    const api = client(async (request) => {
      presigned = await request.json();
      return new Response(JSON.stringify(issued), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const put = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1])], { type: 'image/jpeg' });

    const fileId = await uploadFile(api, 'catalog.product_image', blob, {
      origin: 'http://tugeel.test',
      fetch: put,
    });

    expect(fileId).toBe(41);
    expect(presigned).toEqual({
      kind: 'catalog.product_image',
      contentType: 'image/jpeg',
      sizeBytes: 4,
    });
    expect(put).toHaveBeenCalledWith(
      'http://tugeel.test/api/v1/files/local/abc.jpg?exp=1&sig=xyz',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      },
    );
  });

  it('turns a refused upload into the API problem', async () => {
    const api = client(() =>
      Promise.resolve(
        new Response(JSON.stringify(issued), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const put = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'x',
            status: 413,
            code: 'PAYLOAD_TOO_LARGE',
          }),
          { status: 413, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    const failure = uploadFile(api, 'catalog.product_thumb', blob, {
      origin: 'http://x',
      fetch: put,
    });
    await expect(failure).rejects.toBeInstanceOf(ApiProblem);
    await expect(failure).rejects.toMatchObject({ problem: { code: 'PAYLOAD_TOO_LARGE' } });
  });
});
