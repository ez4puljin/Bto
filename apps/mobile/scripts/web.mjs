// `pnpm mobile:web`: the staff app (or «Bto300» with `--variant customer`) in a browser, to look at
// its screens from a laptop without building an APK. Expo's dev server bundles the app for the web
// and reloads it on every saved change; in front of it a small proxy on PORT (default 8090) passes
// `/api/…` and `/health` to the development api, so the page and its api share one origin (no
// CORS) and the app's server is the page's own address (`src/config/app.web.ts`).
//
// Open it as http://localhost:<PORT>: a browser gives crypto.randomUUID and the position only to a
// secure page, and localhost is one. From the laptop, through SSH:
//   ssh -N -L 8090:127.0.0.1:8090 nvme-server@192.168.1.250
//
// Env: PORT (8090), METRO_PORT (8081), BTO_WEB_API (http://127.0.0.1:3300, the development api;
// never the real system's).
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXPO_ENV } from './expo.mjs';

const appRoot = path.resolve(import.meta.dirname, '..');
const port = Number.parseInt(process.env.PORT ?? '8090', 10);
const metroPort = Number.parseInt(process.env.METRO_PORT ?? '8081', 10);
const api = new URL(process.env.BTO_WEB_API ?? 'http://127.0.0.1:3300');
// Only a development api on this PC: the real system answers on port 80 (and 443) here.
if (!['127.0.0.1', 'localhost'].includes(api.hostname) || ['', '80', '443'].includes(api.port)) {
  console.error(`BTO_WEB_API must be a development api on this PC, not ${api.origin}`);
  process.exit(1);
}
const variantAt = process.argv.indexOf('--variant');
const variant = variantAt >= 0 ? process.argv[variantAt + 1] : 'staff';

const cli = createRequire(path.join(appRoot, 'package.json')).resolve('expo/bin/cli');
const expo = spawn(
  process.execPath,
  [cli, 'start', '--web', '--port', String(metroPort), '--host', 'localhost'],
  {
    cwd: appRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    // EXPO_OFFLINE: no version check or sign-in prompt from Expo's own servers.
    env: { ...process.env, ...EXPO_ENV, EXPO_OFFLINE: '1', APP_VARIANT: variant, BROWSER: 'none' },
  },
);
expo.on('exit', (code) => process.exit(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    expo.kill(signal);
    process.exit(0);
  });
}

const toApi = (pathname) => pathname.startsWith('/api/') || pathname === '/health';

function pass(req, res, target) {
  const headers = { ...req.headers, host: target.host };
  // The api refuses a browser on the phones' sign-in routes (ADR-0061 #4: a browser always sends
  // Origin). This page stands in for a phone, so its own same-origin calls go on without it; a call
  // from any other page keeps its Origin and is refused as before.
  if (target === api && headers.origin === `http://localhost:${port}`) delete headers.origin;
  const upstream = http.request(
    {
      host: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('upstream is not answering');
  });
  req.pipe(upstream);
}

const metro = new URL(`http://127.0.0.1:${metroPort}`);
const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://x');
  pass(req, res, toApi(pathname) ? api : metro);
});

// The dev server's reload channel is a WebSocket: hand the upgraded socket to Metro as it is.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(metroPort, '127.0.0.1', () => {
    const headers = Object.entries(req.headers)
      .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\r\n');
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Bto web (${variant}): http://localhost:${port}  (api ${api.origin})`);
});
