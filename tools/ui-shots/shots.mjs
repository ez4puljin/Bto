#!/usr/bin/env node
// Desktop screenshots of the web app (ADR-0066). Signs a dev user in through the api, hands the
// refresh cookie to a headless Chrome (or Edge) and captures every route in `routes.mjs` at the
// desktop sizes, with layout measurements, console errors and failed api calls, into
// `tmp/ui-shots/<name>/`: one PNG per route and size, `report.json` and `index.html`.
// No dependency: Node's WebSocket speaks the DevTools protocol. The password comes from a
// gitignored file (`username password` per line) and is never printed.
//
//   pnpm ui:shots -- --out tmp/ui-shots/before [--only receipt] [--sizes 1366x633,1920x969]
//                    [--user admin] [--logins tmp/dev-logins.txt] [--web …] [--api …]
//
// Needs `pnpm dev` (web on 5173, api on 3300). Chrome: CHROME_PATH, else the usual install paths.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { DISCOVER, PUBLIC_ROUTES, ROUTES } from './routes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SIZES = '1366x633,1536x730,1920x969';
const COOKIE = 'tugeel_rt';
const COOKIE_PATH = '/api/v1/auth';

const args = parseArgs(process.argv.slice(2));
const web = args.web ?? 'http://localhost:5173';
const api = args.api ?? 'http://127.0.0.1:3300';
const user = args.user ?? 'admin';
const out = resolve(ROOT, args.out ?? join('tmp', 'ui-shots', stamp()));
const sizes = (args.sizes ?? DEFAULT_SIZES).split(',').map((size) => {
  const [width, height] = size.split('x').map((n) => Number.parseInt(n, 10));
  if (!width || !height) throw new Error(`bad size ${size}`);
  return { width, height, label: `${width}x${height}` };
});
const only = args.only ? new RegExp(args.only) : null;

function parseArgs(list) {
  const parsed = {};
  for (let i = 0; i < list.length; i += 1) {
    const key = list[i];
    if (key === '--') continue;
    if (!key.startsWith('--')) throw new Error(`unexpected argument ${key}`);
    parsed[key.slice(2)] = list[i + 1];
    i += 1;
  }
  return parsed;
}

function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const found = candidates.find((path) => path && existsSync(path));
  if (!found) throw new Error('no Chrome or Edge found; set CHROME_PATH');
  return found;
}

function readSecret() {
  const file = resolve(ROOT, args.logins ?? join('tmp', 'dev-logins.txt'));
  if (!existsSync(file)) throw new Error(`no logins file at ${relative(ROOT, file)}`);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [name, secret] = line.trim().split(/\s+/);
    if (name === user && secret) return secret;
  }
  throw new Error(`no dev login for ${user}`);
}

/** Waits out a dev api that restarts (`pnpm dev` rebuilds it when a shared package changes). */
async function post(url, body) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.status < 500 || attempt >= 30) return response;
    } catch (error) {
      if (attempt >= 30) throw error;
    }
    await sleep(2_000);
  }
}

async function signIn() {
  const response = await post(`${api}/api/v1/auth/login`, {
    username: user,
    password: readSecret(),
  });
  if (!response.ok) throw new Error(`sign-in failed: HTTP ${response.status}`);
  const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
  const body = await response.json();
  if (!cookie || typeof body.accessToken !== 'string') throw new Error('sign-in gave no session');
  return { refresh: cookie.split(';')[0].slice(COOKIE.length + 1), accessToken: body.accessToken };
}

async function discover(accessToken) {
  const ids = {};
  for (const [name, [path, pick]] of Object.entries(DISCOVER)) {
    try {
      const response = await fetch(`${api}${path}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) continue;
      const body = await response.json();
      const rows = Array.isArray(body) ? body : Array.isArray(body.data) ? body.data : [];
      const id = rows.length > 0 ? pick(rows[0]) : undefined;
      if (id !== undefined && id !== null) ids[name] = String(id);
    } catch {
      // a list that fails only skips its routes
    }
  }
  return ids;
}

/** The DevTools protocol over Node's WebSocket: `send` answers by id, `on` gets events. */
class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message}`));
        else waiting.resolve(message.result);
        return;
      }
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    });
  }

  send(method, params = {}) {
    this.nextId += 1;
    const id = this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend, method });
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
    return () => {
      const current = this.listeners.get(method) ?? [];
      this.listeners.set(
        method,
        current.filter((entry) => entry !== listener),
      );
    };
  }

  close() {
    this.socket.close();
  }
}

async function launch() {
  const profile = mkdtempSync(join(tmpdir(), 'ui-shots-'));
  const browser = spawn(
    chromePath(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--force-device-scale-factor=1',
      '--window-size=1920,1080',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise((resolveUrl, rejectUrl) => {
    let text = '';
    const timer = setTimeout(() => rejectUrl(new Error('the browser did not start')), 30_000);
    browser.stderr.on('data', (chunk) => {
      text += String(chunk);
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    browser.on('exit', (code) => rejectUrl(new Error(`the browser exited (${code})`)));
  });
  const port = new URL(endpoint).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no page target');
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  const stop = () => {
    try {
      cdp.close();
    } catch {
      // already closed
    }
    browser.kill();
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Windows may still hold the profile for a moment
      }
    }, 500);
  };
  return { cdp, stop };
}

/** Requests in flight and the problems of the page being captured. */
function watch(cdp) {
  const state = { inflight: new Map(), last: Date.now(), errors: [], failed: [] };
  const short = (url) => url.replace(web, '').replace(api, '').slice(0, 160);
  const ignored = (url) => /\/@vite\/|\/@fs\/|\.hot-update\.|\/node_modules\/\.vite\//.test(url);
  cdp.on('Network.requestWillBeSent', (params) => {
    if (params.request.url.startsWith('data:')) return;
    state.inflight.set(params.requestId, params.request.url);
    state.last = Date.now();
  });
  cdp.on('Network.loadingFinished', (params) => {
    state.inflight.delete(params.requestId);
    state.last = Date.now();
  });
  cdp.on('Network.loadingFailed', (params) => {
    const url = state.inflight.get(params.requestId);
    state.inflight.delete(params.requestId);
    state.last = Date.now();
    if (url && !params.canceled && !ignored(url))
      state.failed.push(`${params.errorText} ${short(url)}`);
  });
  cdp.on('Network.responseReceived', (params) => {
    const { status, url } = params.response;
    // A signed-out page asks for a session first; that 401 is expected.
    if (status === 401 && url.includes('/auth/refresh')) return;
    if (status >= 400 && url.includes('/api/')) state.failed.push(`${status} ${short(url)}`);
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails;
    state.errors.push(
      (details.exception?.description ?? details.text ?? 'exception').split('\n')[0].slice(0, 300),
    );
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    const text = params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
    state.errors.push(text.split('\n')[0].slice(0, 300));
  });
  return state;
}

async function idle(state, { quiet = 600, timeout = 15_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (state.inflight.size === 0 && Date.now() - state.last >= quiet) return true;
    await sleep(100);
  }
  return false;
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'evaluate failed');
  return result.result.value;
}

async function load(cdp, state, url, { dialog = false } = {}) {
  let off = () => {};
  const loaded = new Promise((resolveLoad) => {
    const timer = setTimeout(resolveLoad, 20_000);
    off = cdp.on('Page.loadEventFired', () => {
      clearTimeout(timer);
      resolveLoad();
    });
  });
  await cdp.send('Page.navigate', { url });
  await loaded;
  off();
  await idle(state);
  await evaluate(cdp, 'document.fonts.ready.then(() => true)');
  if (dialog) {
    for (let i = 0; i < 40; i += 1) {
      const open = await evaluate(
        cdp,
        `Boolean(document.querySelector('[role=dialog],[role=alertdialog]'))`,
      );
      if (open) break;
      await sleep(125);
    }
  }
  await sleep(450);
  await idle(state, { quiet: 300, timeout: 5_000 });
}

/** Runs in the page: the layout facts the review reads beside each picture. */
const MEASURE = String.raw`(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const doc = document.documentElement;
  const describe = (el) => {
    const slot = el.getAttribute('data-slot');
    const name = el.getAttribute('aria-label');
    return el.tagName.toLowerCase() + (slot ? '[' + slot + ']' : '') + (name ? '"' + name + '"' : '');
  };
  const clippers = (el) => {
    const list = [];
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') list.push(node);
    }
    return list;
  };
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    if (box.height === 0 || box.top < 0 || box.bottom > vh + 0.5) return false;
    return clippers(el).every((node) => {
      const clip = node.getBoundingClientRect();
      return box.top >= clip.top - 0.5 && box.bottom <= clip.bottom + 0.5;
    });
  };
  const main = document.querySelector('main');
  const frame = main ? main.firstElementChild : null;
  const frameBox = frame ? frame.getBoundingClientRect() : null;
  const dialog = document.querySelector('[role=dialog],[role=alertdialog]');
  const scope = dialog || main || document.body;
  const rows = Array.from(scope.querySelectorAll('tbody tr')).filter((row) => row.offsetParent !== null);
  const firstRow = rows.find((row) => row.getBoundingClientRect().height > 0);
  const scrollers = Array.from(document.querySelectorAll('body *'))
    .filter((el) => {
      const style = getComputedStyle(el);
      return (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
    })
    .slice(0, 6)
    .map((el) => ({ el: describe(el), width: el.clientWidth, overflow: el.scrollWidth - el.clientWidth }));
  const truncated = Array.from(scope.querySelectorAll('*')).filter((el) => {
    const style = getComputedStyle(el);
    return style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
  }).length;
  let dialogFacts = null;
  if (dialog) {
    const box = dialog.getBoundingClientRect();
    const footer =
      dialog.querySelector('[data-slot=dialog-footer],[data-slot=sheet-footer]') ||
      Array.from(dialog.querySelectorAll('button[type=submit]')).pop() ||
      null;
    dialogFacts = {
      width: Math.round(box.width),
      height: Math.round(box.height),
      scrolls: dialog.scrollHeight > dialog.clientHeight + 1,
      footerVisible: footer ? visible(footer) : null,
    };
  }
  return {
    url: location.pathname + location.search,
    title: document.title,
    h1: (document.querySelector('main h1') || document.querySelector('h1'))?.textContent?.trim() ?? null,
    viteError: Boolean(document.querySelector('vite-error-overlay')),
    pageOverflowX: Math.max(0, doc.scrollWidth - vw),
    pageHeight: doc.scrollHeight,
    frame: frameBox ? { left: Math.round(frameBox.left), width: Math.round(frameBox.width) } : null,
    firstRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
    rows: rows.length,
    visibleRows: rows.filter(visible).length,
    scrollers,
    truncated,
    dialog: dialogFacts,
  };
})()`;

function fill(path, ids) {
  let missing = null;
  const filled = path.replace(/\{(\w+)\}/g, (_, name) => {
    if (ids[name] === undefined) missing = name;
    return ids[name] ?? '';
  });
  return { path: filled, missing };
}

function gallery(report) {
  const esc = (text) =>
    String(text).replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const facts = (m) => {
    if (!m) return '';
    const parts = [
      m.pageOverflowX > 0 ? `<b class="bad">page +${m.pageOverflowX}px →</b>` : '',
      m.firstRowTop !== null ? `row 1 at ${m.firstRowTop}px` : '',
      m.rows ? `${m.visibleRows}/${m.rows} rows seen` : '',
      m.scrollers.length
        ? `scrollers: ${m.scrollers.map((s) => `${s.el} +${s.overflow}`).join(', ')}`
        : '',
      m.truncated ? `${m.truncated} truncated` : '',
      m.dialog
        ? `dialog ${m.dialog.width}×${m.dialog.height}${m.dialog.footerVisible === false ? ' <b class="bad">footer hidden</b>' : ''}`
        : '',
    ];
    return parts.filter(Boolean).join(' · ');
  };
  const sections = report.routes
    .map((route) => {
      const problems = [...route.errors, ...route.failed];
      const shots = route.shots
        .map(
          (shot) =>
            `<figure><a href="${esc(shot.file)}"><img loading="lazy" src="${esc(shot.file)}" alt=""></a><figcaption><b>${shot.size}</b> ${facts(shot.metrics)}</figcaption></figure>`,
        )
        .join('');
      return `<section id="${esc(route.name)}"><h2>${esc(route.area)} · ${esc(route.name)} <code>${esc(route.path)}</code></h2>${
        route.skipped ? `<p class="bad">skipped: ${esc(route.skipped)}</p>` : ''
      }${problems.length ? `<ul class="bad">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}<div class="row">${shots}</div></section>`;
    })
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ui-shots ${esc(report.name)}</title>
<style>body{font:13px/1.4 system-ui,sans-serif;margin:16px;background:#f2f2f7;color:#1d1d1f}section{background:#fff;border-radius:10px;padding:10px 12px;margin:0 0 12px}h2{font-size:14px;margin:0 0 8px}code{color:#6e6e73;font-weight:400}.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}figure{margin:0}img{width:100%;border:1px solid #e5e5ea;border-radius:6px}figcaption{color:#6e6e73;margin-top:4px}.bad{color:#c62828}</style>
</head><body><h1>ui-shots · ${esc(report.name)} · ${esc(report.at)}</h1>${sections}</body></html>`;
}

async function main() {
  mkdirSync(out, { recursive: true });
  const session = await signIn();
  const ids = await discover(session.accessToken);
  console.log(`ids found: ${Object.keys(ids).join(', ') || 'none'}`);
  const { cdp, stop } = await launch();
  const state = watch(cdp);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });
  const report = {
    name: relative(join(ROOT, 'tmp', 'ui-shots'), out),
    at: new Date().toISOString(),
    sizes: sizes.map((s) => s.label),
    routes: [],
  };
  try {
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    const host = new URL(web).hostname;
    const wanted = (route) => !only || only.test(route.name) || only.test(route.area);
    const entries = new Map();
    const entryOf = (route, path, skipped) => {
      let entry = entries.get(route.name);
      if (!entry) {
        entry = {
          area: route.area,
          name: route.name,
          path,
          skipped,
          errors: [],
          failed: [],
          shots: [],
        };
        entries.set(route.name, entry);
        report.routes.push(entry);
      }
      return entry;
    };
    // Signed out first (sign-in, password set-up) at every size, then signed in once: the app
    // rotates the refresh cookie on every load and the browser keeps the latest one.
    const passes = [
      { signedIn: false, routes: PUBLIC_ROUTES.filter(wanted) },
      { signedIn: true, routes: ROUTES.filter(wanted) },
    ];
    let cookieSet = false;
    for (const { signedIn, routes } of passes) {
      for (const size of sizes) {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 1,
          mobile: false,
        });
        for (const route of routes) {
          await capture(route, size, signedIn);
        }
      }
    }

    async function capture(route, size, signedIn) {
      const { path, missing } = fill(route.path, ids);
      const entry = entryOf(route, path, missing ? `no ${missing} in the dev data` : undefined);
      if (missing) return;
      if (signedIn && !cookieSet) {
        await cdp.send('Network.setCookie', {
          name: COOKIE,
          value: session.refresh,
          domain: host,
          path: COOKIE_PATH,
          httpOnly: true,
          sameSite: 'Strict',
        });
        cookieSet = true;
      }
      state.errors = [];
      state.failed = [];
      await load(cdp, state, `${web}${path}`, { dialog: route.dialog });
      let metrics = await evaluate(cdp, MEASURE);
      if (signedIn && metrics.url.startsWith('/login')) {
        // The session was lost (a rotated cookie): sign in again once and retry.
        const again = await signIn();
        session.refresh = again.refresh;
        await cdp.send('Network.setCookie', {
          name: COOKIE,
          value: session.refresh,
          domain: host,
          path: COOKIE_PATH,
          httpOnly: true,
          sameSite: 'Strict',
        });
        state.errors = [];
        state.failed = [];
        await load(cdp, state, `${web}${path}`, { dialog: route.dialog });
        metrics = await evaluate(cdp, MEASURE);
      }
      const file = `${route.area}--${route.name}@${size.label}.png`;
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(out, file), Buffer.from(shot.data, 'base64'));
      entry.shots.push({ size: size.label, file, metrics });
      for (const error of state.errors) if (!entry.errors.includes(error)) entry.errors.push(error);
      for (const failed of state.failed)
        if (!entry.failed.includes(failed)) entry.failed.push(failed);
      const flags = [
        metrics.pageOverflowX > 0 ? `page+${metrics.pageOverflowX}` : '',
        metrics.firstRowTop !== null ? `row1@${metrics.firstRowTop}` : '',
        metrics.rows ? `${metrics.visibleRows}/${metrics.rows}rows` : '',
        metrics.dialog?.footerVisible === false ? 'FOOTER-HIDDEN' : '',
        metrics.viteError ? 'VITE-ERROR' : '',
        state.errors.length ? `${state.errors.length}err` : '',
        state.failed.length ? `${state.failed.length}failed` : '',
      ].filter(Boolean);
      console.log(`${size.label} ${route.name} ${flags.join(' ')}`);
    }
  } finally {
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, 'index.html'), gallery(report));
    stop();
  }
  const skipped = report.routes.filter((route) => route.skipped);
  console.log(
    `done: ${report.routes.length - skipped.length} routes × ${sizes.length} sizes in ${relative(ROOT, out)}` +
      (skipped.length ? `; skipped ${skipped.map((route) => route.name).join(', ')}` : ''),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? `${error.message}${error.cause ? ` (${error.cause.code ?? error.cause.message})` : ''}`
      : error,
  );
  process.exit(1);
});
