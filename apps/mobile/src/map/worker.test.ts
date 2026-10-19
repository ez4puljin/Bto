import maplibrePackage from 'maplibre-gl/package.json';
import workerText from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
import { describe, expect, it } from 'vitest';
import mobilePackage from '../../package.json';
import { base64Of, isTrustedWorker, MAPLIBRE_VERSION, WORKER_SHA384, WORKER_URL } from './worker';

describe('the MapLibre worker the store map fetches', () => {
  it('is the installed version', () => {
    expect(maplibrePackage.version).toBe(MAPLIBRE_VERSION);
    expect(mobilePackage.dependencies['maplibre-gl']).toBe(MAPLIBRE_VERSION);
    expect(WORKER_URL).toContain(`/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl-worker.mjs`);
  });

  it('carries the installed file’s hash', async () => {
    const bytes = new TextEncoder().encode(workerText);
    expect(base64Of(await crypto.subtle.digest('SHA-384', bytes))).toBe(WORKER_SHA384);
    expect(await isTrustedWorker(bytes.buffer, crypto.subtle)).toBe(true);
  });

  it('refuses any other file', async () => {
    const tampered = new TextEncoder().encode(`${workerText};`);
    expect(await isTrustedWorker(tampered.buffer, crypto.subtle)).toBe(false);
  });
});

describe('base64Of', () => {
  it('encodes bytes', () => {
    expect(base64Of(new Uint8Array([77, 97, 110]).buffer)).toBe('TWFu');
    expect(base64Of(new Uint8Array([]).buffer)).toBe('');
  });
});
