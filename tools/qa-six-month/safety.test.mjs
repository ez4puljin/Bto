import assert from 'node:assert/strict';
import test from 'node:test';
import { Socket } from 'node:net';
import { assertQaUrl, assertApiPath } from './safety.mjs';
import { QA_DATABASE } from './dataset.mjs';
import { installLoopbackFence } from './runtime.mjs';

test('database guard permits only exact isolated loopback target without URL overrides', () => {
  const valid = `postgresql://app:fake@127.0.0.1:15432/${QA_DATABASE}`;
  assert.equal(assertQaUrl(valid).hostname, '127.0.0.1');
  for (const value of [
    valid.replace(QA_DATABASE, 'bto_local_shiro'),
    valid.replace('127.0.0.1', 'localhost'),
    valid + '?host=external.example',
    valid.replace('15432', '5432'),
  ])
    assert.throws(() => assertQaUrl(value));
});

test('API routes cannot escape origin or invoke provider/fiscal/notification actions', () => {
  assert.equal(assertApiPath('/pos/sync/events'), '/pos/sync/events');
  for (const path of [
    'https://example.com',
    '//example.com',
    '/%2e%2e/products',
    '/pos/sync/ebarimt/claim',
    '/notifications',
    '/unknown-root',
    '/finance/close-year',
    '/finance/close-year?year=2026',
    '/pos/sync/ebarimt?x=1',
  ])
    assert.throws(() => assertApiPath(path));
});

test('network fence refuses external sockets and fetch synchronously and restores originals', () => {
  const connect = Socket.prototype.connect,
    fetch = globalThis.fetch;
  const restore = installLoopbackFence();
  try {
    const socket = new Socket();
    assert.throws(() => socket.connect({ host: 'example.com', port: 443 }), /blocks/);
    assert.throws(() => socket.connect({ host: '127.0.0.1', port: 3300 }), /blocks/);
    assert.throws(() => globalThis.fetch('https://example.com'), /blocks/);
    socket.destroy();
  } finally {
    restore();
    restore();
  }
  assert.equal(Socket.prototype.connect, connect);
  assert.equal(globalThis.fetch, fetch);
});
