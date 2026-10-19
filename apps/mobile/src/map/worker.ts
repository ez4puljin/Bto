// MapLibre GL JS parses tiles in a web worker, shipped as its own file (maplibre-gl 6). Metro
// cannot bundle that file (it holds a dynamic `import(url)`), so the store map fetches it from
// jsDelivr for exactly the installed version, checks it against the installed file's SHA-384
// (worker.test.ts keeps both in step with package.json) and runs it from a blob. The map needs the
// internet for its tiles anyway.

/** The maplibre-gl version of apps/mobile/package.json. */
export const MAPLIBRE_VERSION = '6.14.0';

export const WORKER_URL = `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl-worker.mjs`;

/** SHA-384 (base64) of node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs. */
export const WORKER_SHA384 = 'UypSNoJZ4tYsc7nmPnmU5gGsPGXXYlrvWSQ8eky5h0HO3mNOGgB05Q53v4OJRHzl';

export function base64Of(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** True when the fetched worker is the installed one, byte for byte. */
export async function isTrustedWorker(bytes: ArrayBuffer, subtle: SubtleCrypto): Promise<boolean> {
  return base64Of(await subtle.digest('SHA-384', bytes)) === WORKER_SHA384;
}
