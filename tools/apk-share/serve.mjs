// The apps' download page on the local network (owner 2026-11-09: «3302»-д, where the phones already
// looked before): http://<this PC>:3302 lists the newest published APK of each app of
// apps/mobile/variants.json and serves it. It reads the same release folders the phones' own update
// reads (ADR-0166, `<STORAGE_LOCAL_DIR>/releases/<variant>/latest.json`), on every request, so
// `pnpm mobile:publish -- <apk>` is all it takes to offer a new build; nothing else is served.
// start.bat starts it, stop.bat stops it with the repo's other node processes. No dependency.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const port = Number.parseInt(process.env.APK_SHARE_PORT ?? '3302', 10);
const variants = JSON.parse(
  readFileSync(path.join(root, 'apps', 'mobile', 'variants.json'), 'utf8'),
);

/** The api's STORAGE_LOCAL_DIR as the api resolves it (it runs in apps/api); the value is never printed. */
function storageRoot() {
  const apiDir = path.join(root, 'apps', 'api');
  const fromEnv = process.env.STORAGE_LOCAL_DIR?.trim();
  if (fromEnv) return path.resolve(apiDir, fromEnv);
  const envFile = path.join(apiDir, '.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').match(/^STORAGE_LOCAL_DIR=(.*)$/m);
    const value = line?.[1].trim().replace(/^["']|["']$/g, '');
    if (value) return path.resolve(apiDir, value);
  }
  return path.join(root, '.data', 'storage');
}

const LABELS = {
  staff: { title: 'Bto — ажилтны апп', note: 'Худалдагч, нярав, жолооч, бүх ажилтан' },
  customer: { title: 'Bto300 — харилцагчийн апп', note: 'Дэлгүүр, харилцагч захиалга өгөх апп' },
};

/** Each app's newest release, or null when its folder holds none that can be downloaded whole. */
function releases() {
  const base = path.join(storageRoot(), 'releases');
  return Object.entries(variants).map(([variant, app]) => {
    const folder = path.join(base, variant);
    const entry = { variant, app, href: `/${app.apkPrefix}.apk`, release: null };
    try {
      const manifest = JSON.parse(readFileSync(path.join(folder, 'latest.json'), 'utf8'));
      if (
        typeof manifest.fileName !== 'string' ||
        !/^[A-Za-z0-9._-]+\.apk$/.test(manifest.fileName)
      ) {
        return entry;
      }
      const file = path.join(folder, manifest.fileName);
      const stat = statSync(file);
      if (stat.size !== manifest.sizeBytes) return entry;
      entry.release = { ...manifest, file, publishedAt: stat.mtime };
    } catch {
      // No release yet, or one being written: offer nothing rather than a broken download.
    }
    return entry;
  });
}

const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} МБ`;

const ulaanbaatar = new Intl.DateTimeFormat('mn-MN', {
  timeZone: 'Asia/Ulaanbaatar',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function page() {
  const cards = releases()
    .map(({ variant, app, href, release }) => {
      const label = LABELS[variant] ?? { title: app.name, note: '' };
      const body = release
        ? `<p class="meta">Хувилбар <b>${escape(release.version)}</b> · ${megabytes(release.sizeBytes)} · ${escape(ulaanbaatar.format(release.publishedAt))}</p>
           <a class="button" href="${href}" download>Татах</a>`
        : '<p class="meta">Одоогоор нийтэлсэн хувилбар алга.</p>';
      return `<section class="card"><h2>${escape(label.title)}</h2><p class="note">${escape(label.note)}</p>${body}</section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="mn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bto апп татах</title>
<style>
  :root { --bg: #f6f7f9; --card: #ffffff; --ink: #14181f; --muted: #5b6472; --line: #e3e6eb; --accent: #1f6feb; --on-accent: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f1216; --card: #171b21; --ink: #e8ebf0; --muted: #9aa3b0; --line: #2a3039; --accent: #4c8dff; --on-accent: #0b0d10; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 34rem; margin: 0 auto; padding: 24px 16px 40px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .lead { color: var(--muted); margin: 0 0 20px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
  .card h2 { font-size: 1.1rem; margin: 0; }
  .note, .meta { color: var(--muted); margin: 4px 0 0; font-size: 0.95rem; }
  .meta b { color: var(--ink); }
  .button { display: block; margin-top: 14px; padding: 12px; min-height: 48px; text-align: center; border-radius: 10px;
    background: var(--accent); color: var(--on-accent); font-weight: 600; text-decoration: none; }
  .help { color: var(--muted); font-size: 0.9rem; }
  .help li { margin-bottom: 4px; }
</style>
</head>
<body>
<main>
  <h1>Bto апп татах</h1>
  <p class="lead">Хамгийн сүүлийн хувилбар. Утас энэ компьютертэй нэг Wi-Fi-д байх ёстой.</p>
  ${cards}
  <ol class="help">
    <li>«Татах»-ыг дараад файлыг татна.</li>
    <li>Татсан файлыг нээж «Суулгах»-ыг дарна. Анх удаа бол утас «Тодорхойгүй эх сурвалжаас суулгах»-ыг зөвшөөрөхийг асууна.</li>
    <li>Хуучин хувилбар суусан бол шинэчлэгдэнэ, өгөгдөл хэвээр үлдэнэ.</li>
  </ol>
</main>
</body>
</html>`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const html = page();
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
    });
    response.end(request.method === 'HEAD' ? undefined : html);
    return;
  }
  const found = releases().find((entry) => entry.href === url.pathname && entry.release);
  if (!found) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Олдсонгүй');
    return;
  }
  const { release } = found;
  response.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': release.sizeBytes,
    'Content-Disposition': `attachment; filename="${release.fileName}"`,
    'Cache-Control': 'no-store',
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(release.file)
    .on('error', () => response.destroy())
    .pipe(response);
});

server.on('error', (error) => {
  console.error(
    `apk-share: ${error.code === 'EADDRINUSE' ? `port ${port} is already in use` : error.message}`,
  );
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${port}`);
  console.log(
    `apk-share: the apps' download page on ${['http://localhost:' + port, ...lan].join(', ')}`,
  );
});
