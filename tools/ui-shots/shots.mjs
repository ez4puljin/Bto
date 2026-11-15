#!/usr/bin/env node
// Screenshots of the web app at the screens it is built for (ADR-0066, ADR-0201). Signs a dev user
// in through the api, hands the refresh cookie to a headless browser and captures every route in
// `routes.mjs` at each size, with layout measurements, console errors and failed api calls, into
// `tmp/ui-shots/<name>/`: one PNG per route and size, `report.json` and `index.html`.
// No dependency: Node's WebSocket speaks the browser's own protocol — DevTools to Chrome or Edge,
// WebDriver BiDi to Firefox (the Ubuntu PC has only Firefox). The password comes from a gitignored
// file (`username password` per line) and is never printed.
//
//   pnpm ui:shots -- --out tmp/ui-shots/before [--only receipt] [--sizes 1024x768,1366x633] [--ids product=10885]
//                    [--user admin] [--logins tmp/dev-logins.txt] [--browser chrome|firefox] [--web …] [--api …]
//
// Needs `pnpm dev` (web on 5173, api on 3300). The browser: CHROME_PATH or FIREFOX_PATH, else the
// usual install paths, Chrome or Edge first.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { DISCOVER, PUBLIC_ROUTES, ROUTES } from './routes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// The screens the web is built for (ADR-0201): a tablet upright (a finger: the `t`), a till PC or
// a tablet on its side, the two laptops, a monitor. Chrome leaves about these for the page.
const DEFAULT_SIZES = '768x1024t,1024x640,1366x633,1536x730,1920x969';
// A printable page prints itself once loaded; a headless Firefox would wait on the dialog forever.
const NO_PRINT = 'window.print = () => {};';
const COOKIE = 'tugeel_rt';
const COOKIE_PATH = '/api/v1/auth';

const args = parseArgs(process.argv.slice(2));
const web = args.web ?? 'http://localhost:5173';
const api = args.api ?? 'http://127.0.0.1:3300';
const user = args.user ?? 'admin';
const out = resolve(ROOT, args.out ?? join('tmp', 'ui-shots', stamp()));
const sizes = (args.sizes ?? DEFAULT_SIZES).split(',').map((size) => {
  const match = /^(\d+)x(\d+)(t?)$/.exec(size.trim());
  if (!match) throw new Error(`bad size ${size}`);
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10),
    touch: match[3] === 't',
    label: size.trim(),
  };
});
const only = args.only ? new RegExp(args.only) : null;
const host = new URL(web).hostname;

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

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const FIREFOX_PATHS = [
  process.env.FIREFOX_PATH,
  '/usr/bin/firefox',
  '/snap/bin/firefox',
  'C:/Program Files/Mozilla Firefox/firefox.exe',
  '/Applications/Firefox.app/Contents/MacOS/firefox',
];

/** The browser to drive: the one asked for (`--browser`), else Chrome or Edge, else Firefox. */
function findBrowser() {
  const first = (paths) => paths.find((path) => path && existsSync(path));
  const chrome = args.browser === 'firefox' ? undefined : first(CHROME_PATHS);
  if (chrome) return { kind: 'chrome', path: chrome };
  const firefox = args.browser === 'chrome' ? undefined : first(FIREFOX_PATHS);
  if (firefox) return { kind: 'firefox', path: firefox };
  throw new Error('no Chrome, Edge or Firefox found; set CHROME_PATH or FIREFOX_PATH');
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
  // ADR-0128: `login` is the phone, or the login name of a dev user without one.
  const response = await post(`${api}/api/v1/auth/login`, {
    login: user,
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

/**
 * A browser's JSON protocol over Node's WebSocket, DevTools or WebDriver BiDi: `send` answers by
 * id, `on` gets events.
 */
class Wire {
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
      if (message.id !== undefined && message.id !== null) {
        const waiting = this.pending.get(message.id);
        if (!waiting) return;
        this.pending.delete(message.id);
        if (message.error) {
          // DevTools answers `{ error: { message } }`, BiDi `{ error: 'code', message }`.
          const text = typeof message.error === 'string' ? message.message : message.error.message;
          waiting.reject(new Error(`${waiting.method}: ${text}`));
        } else waiting.resolve(message.result);
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

/** Requests in flight and the problems of the page being captured. */
function newState() {
  return { inflight: new Map(), last: Date.now(), errors: [], failed: [] };
}

const shortUrl = (url) => url.replace(web, '').replace(api, '').slice(0, 160);
const viteInternal = (url) => /\/@vite\/|\/@fs\/|\.hot-update\.|\/node_modules\/\.vite\//.test(url);
const firstLine = (text) => String(text).split('\n')[0].slice(0, 300);

/** An api call that was refused; a signed-out page asking for a session first is expected. */
function noteResponse(state, status, url) {
  if (status === 401 && url.includes('/auth/refresh')) return;
  if (status >= 400 && url.includes('/api/')) state.failed.push(`${status} ${shortUrl(url)}`);
}

/** The address a browser prints on its error stream once it listens. */
function listening(browser, pattern) {
  return new Promise((resolveUrl, rejectUrl) => {
    let text = '';
    let found = false;
    const timer = setTimeout(() => rejectUrl(new Error('the browser did not start')), 30_000);
    browser.stderr.on('data', (chunk) => {
      if (found) return;
      text += String(chunk);
      const match = pattern.exec(text);
      if (match) {
        found = true;
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    browser.on('exit', (code) => rejectUrl(new Error(`the browser exited (${code})`)));
  });
}

function stopBrowser(wire, browser, profile) {
  try {
    wire.close();
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
}

/*
 * A driver is what the capture needs from a browser, whichever protocol it speaks: `state` (the
 * requests in flight and the page's problems), `viewport(width, height)`, `cookie(value)` (the
 * refresh cookie for the web's host), `navigate(url)` (back once the page has loaded, or after
 * LOAD_TIMEOUT), `evaluate(expression)` (its value, promises awaited), `screenshot()` (a PNG of
 * the viewport) and `stop()`.
 */
const LOAD_TIMEOUT = 20_000;

async function launchChrome(path, touch) {
  const profile = mkdtempSync(join(tmpdir(), 'ui-shots-'));
  const browser = spawn(
    path,
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
  const endpoint = await listening(browser, /DevTools listening on (ws:\/\/\S+)/);
  const port = new URL(endpoint).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((target) => target.type === 'page');
  if (!page) throw new Error('no page target');
  const cdp = new Wire(page.webSocketDebuggerUrl);
  await cdp.open();
  const state = newState();
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
    if (url && !params.canceled && !viteInternal(url))
      state.failed.push(`${params.errorText} ${shortUrl(url)}`);
  });
  cdp.on('Network.responseReceived', (params) => {
    noteResponse(state, params.response.status, params.response.url);
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails;
    state.errors.push(firstLine(details.exception?.description ?? details.text ?? 'exception'));
  });
  cdp.on('Runtime.consoleAPICalled', (params) => {
    if (params.type !== 'error') return;
    state.errors.push(
      firstLine(params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')),
    );
  });
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: NO_PRINT });
  // DevTools' touch emulation also makes the pointer coarse and takes hover away.
  if (touch) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  return {
    state,
    viewport: (width, height) =>
      cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    cookie: (value) =>
      cdp.send('Network.setCookie', {
        name: COOKIE,
        value,
        domain: host,
        path: COOKIE_PATH,
        httpOnly: true,
        sameSite: 'Strict',
      }),
    async navigate(url) {
      let off = () => {};
      const loaded = new Promise((resolveLoad) => {
        const timer = setTimeout(resolveLoad, LOAD_TIMEOUT);
        off = cdp.on('Page.loadEventFired', () => {
          clearTimeout(timer);
          resolveLoad();
        });
      });
      await cdp.send('Page.navigate', { url });
      await loaded;
      off();
    },
    async evaluate(expression) {
      const answer = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (answer.exceptionDetails)
        throw new Error(answer.exceptionDetails.text ?? 'evaluate failed');
      return answer.result.value;
    },
    async screenshot() {
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(shot.data, 'base64');
    },
    stop: () => stopBrowser(cdp, browser, profile),
  };
}

/** A throwaway Firefox profile: no first-run pages, no calls home, one device pixel per CSS pixel. */
const FIREFOX_PREFS = [
  ['browser.shell.checkDefaultBrowser', false],
  ['browser.aboutwelcome.enabled', false],
  ['browser.startup.homepage_override.mstone', 'ignore'],
  ['browser.startup.page', 0],
  ['datareporting.policy.dataSubmissionEnabled', false],
  ['datareporting.healthreport.uploadEnabled', false],
  ['toolkit.telemetry.reportingpolicy.firstRun', false],
  ['app.update.auto', false],
  ['app.normandy.enabled', false],
  ['extensions.update.enabled', false],
  ['network.captive-portal-service.enabled', false],
  ['network.connectivity-service.enabled', false],
  ['browser.safebrowsing.malware.enabled', false],
  ['browser.safebrowsing.phishing.enabled', false],
  ['services.settings.server', 'data:,#remote-settings-dummy/v1'],
  ['layout.css.devPixelsPerPx', '1.0'],
]
  .map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
  .join('\n');

async function launchFirefox(path, touch) {
  // The profile lives under the repository's tmp/: a snap's Firefox sees the home folder, not the
  // system's /tmp.
  mkdirSync(join(ROOT, 'tmp'), { recursive: true });
  const profile = mkdtempSync(join(ROOT, 'tmp', 'ui-shots-profile-'));
  // A finger: the primary pointer and every pointer coarse, nothing that hovers.
  const pointer = touch
    ? '\nuser_pref("ui.primaryPointerCapabilities", 1);\nuser_pref("ui.allPointerCapabilities", 1);'
    : '';
  writeFileSync(join(profile, 'user.js'), `${FIREFOX_PREFS}${pointer}\n`);
  const browser = spawn(
    path,
    [
      '--headless',
      '--no-remote',
      '--profile',
      profile,
      '--remote-debugging-port',
      '0',
      '--width',
      '1920',
      '--height',
      '1080',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await listening(browser, /WebDriver BiDi listening on (ws:\/\/\S+)/);
  const bidi = new Wire(`${endpoint}/session`);
  await bidi.open();
  await bidi.send('session.new', { capabilities: {} });
  const tree = await bidi.send('browsingContext.getTree', { maxDepth: 0 });
  const context = tree.contexts[0]?.context;
  if (!context) throw new Error('no page target');
  const state = newState();
  bidi.on('network.beforeRequestSent', (params) => {
    if (params.request.url.startsWith('data:')) return;
    state.inflight.set(params.request.request, params.request.url);
    state.last = Date.now();
  });
  bidi.on('network.responseCompleted', (params) => {
    state.inflight.delete(params.request.request);
    state.last = Date.now();
    noteResponse(state, params.response.status, params.response.url);
  });
  bidi.on('network.fetchError', (params) => {
    const url = state.inflight.get(params.request.request);
    state.inflight.delete(params.request.request);
    state.last = Date.now();
    // A navigation ends the requests of the page before it: that is not a failure.
    if (url && !/ABORT/.test(params.errorText) && !viteInternal(url))
      state.failed.push(`${params.errorText} ${shortUrl(url)}`);
  });
  bidi.on('log.entryAdded', (params) => {
    if (params.level === 'error') state.errors.push(firstLine(params.text ?? 'error'));
  });
  await bidi.send('script.addPreloadScript', {
    functionDeclaration: `() => { ${NO_PRINT} }`,
  });
  await bidi.send('session.subscribe', {
    events: [
      'network.beforeRequestSent',
      'network.responseCompleted',
      'network.fetchError',
      'log.entryAdded',
    ],
  });
  return {
    state,
    viewport: (width, height) =>
      bidi.send('browsingContext.setViewport', {
        context,
        viewport: { width, height },
        devicePixelRatio: 1,
      }),
    cookie: (value) =>
      bidi.send('storage.setCookie', {
        cookie: {
          name: COOKIE,
          value: { type: 'string', value },
          domain: host,
          path: COOKIE_PATH,
          httpOnly: true,
          sameSite: 'strict',
        },
      }),
    async navigate(url) {
      const giveUp = new AbortController();
      await Promise.race([
        bidi
          .send('browsingContext.navigate', { context, url, wait: 'complete' })
          .catch(() => undefined),
        sleep(LOAD_TIMEOUT, undefined, { signal: giveUp.signal }).catch(() => undefined),
      ]);
      giveUp.abort();
    },
    async evaluate(expression) {
      // The value travels as JSON text: BiDi's own serialization is a tree of typed nodes.
      const answer = await bidi.send('script.evaluate', {
        expression: `Promise.resolve(${expression}).then((value) => JSON.stringify(value ?? null))`,
        target: { context },
        awaitPromise: true,
        resultOwnership: 'none',
      });
      if (answer.type !== 'success')
        throw new Error(answer.exceptionDetails?.text ?? 'evaluate failed');
      return JSON.parse(answer.result.value);
    },
    async screenshot() {
      const shot = await bidi.send('browsingContext.captureScreenshot', {
        context,
        origin: 'viewport',
      });
      return Buffer.from(shot.data, 'base64');
    },
    stop: () => stopBrowser(bidi, browser, profile),
  };
}

async function idle(state, { quiet = 600, timeout = 15_000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (state.inflight.size === 0 && Date.now() - state.last >= quiet) return true;
    await sleep(100);
  }
  return false;
}

/**
 * Whether the page still shows that it is loading: a list's skeleton rows, a button whose request
 * runs, «Ачаалж байна…». A picture of a skeleton says nothing of the list (ADR-0201: the first
 * sweep at the tablet's size photographed a third of the lists before their rows).
 */
const LOADING = String.raw`(() => {
  const scopes = [document.querySelector('[role=dialog],[role=alertdialog]'), document.querySelector('main')];
  return scopes.some((scope) => scope && (scope.querySelector('.animate-pulse, [aria-busy="true"]') || /Ачаалж байна…|Уншиж байна…/.test(scope.textContent || '')));
})()`;

/** Resolves once what moves has come to rest (the page's rise, a dialog's zoom), 1.5 s at most. */
const AT_REST = String.raw`Promise.race([
  Promise.all(document.getAnimations().filter((animation) => animation.effect && animation.effect.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => null))),
  new Promise((done) => setTimeout(done, 1500)),
]).then(() => true)`;

async function load(driver, url, { dialog = false, then = null } = {}) {
  await driver.navigate(url);
  await idle(driver.state);
  await driver.evaluate('document.fonts.ready.then(() => true)');
  if (dialog) {
    for (let i = 0; i < 40; i += 1) {
      const open = await driver.evaluate(
        `Boolean(document.querySelector('[role=dialog],[role=alertdialog]'))`,
      );
      if (open) break;
      await sleep(125);
    }
  }
  await sleep(Number.parseInt(args.settle ?? '450', 10));
  await idle(driver.state, { quiet: 300, timeout: 5_000 });
  // The rows themselves, not their skeleton: 10 s at most, and the picture says so if it gave up.
  for (let i = 0; i < 80 && (await driver.evaluate(LOADING)); i += 1) await sleep(125);
  await driver.evaluate(AT_REST);
  if (then) {
    // A route's step after the load (a double click that opens a report row's detail, a form
    // typed into); it may await.
    await driver.evaluate(`(async () => { ${then}; return true; })()`);
    await sleep(450);
    await idle(driver.state, { quiet: 300, timeout: 5_000 });
  }
}

/** Runs in the page: the layout facts the review reads beside each picture. */
const MEASURE = String.raw`(() => {
  const scopeLoading = () => [document.querySelector('[role=dialog],[role=alertdialog]'), document.querySelector('main')].some((box) => box && (box.querySelector('.animate-pulse, [aria-busy="true"]') || /Ачаалж байна…|Уншиж байна…/.test(box.textContent || '')));
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
  // How much of the page box the content really uses: the rightmost visible edge inside it.
  let contentWidth = null;
  if (frame && frameBox) {
    let right = frameBox.left;
    for (const el of frame.querySelectorAll('*')) {
      if (el.offsetParent === null) continue;
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0 && box.right <= frameBox.right + 0.5) right = Math.max(right, box.right);
    }
    contentWidth = Math.round(right - frameBox.left);
  }
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
      // A centred dialog that reaches the window's side has lost its margin (ADR-0201).
      edge: box.width < vw - 1 ? false : getComputedStyle(dialog).borderTopLeftRadius !== '0px',
      overflowX: Math.max(0, dialog.scrollWidth - dialog.clientWidth),
    };
  }
  // What a finger and a narrow window meet (ADR-0201): things to press under 32px on a side,
  // labels of buttons and tabs broken over two lines, boxes that cut their content without «…»,
  // and items of the top bar lying over one another.
  const inView = (el) => {
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < vh && box.right > 0 && box.left < vw;
  };
  const sized = (el) => {
    const box = el.getBoundingClientRect();
    return describe(el) + ' ' + Math.round(box.width) + '×' + Math.round(box.height) + ' "' + (el.textContent || '').trim().slice(0, 24) + '"';
  };
  const pressable = Array.from(
    scope.querySelectorAll('button,[role=button],[role=tab],[role=switch],[role=combobox],select,[data-slot=button],input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea'),
  ).filter(inView);
  // What a press lands on: the thing itself, or the unseen area a finger is given around it.
  const reach = (el) => {
    const box = el.getBoundingClientRect();
    const around = getComputedStyle(el, '::after');
    if (around.content === 'none' || around.position !== 'absolute') return Math.min(box.width, box.height);
    return Math.min(Math.max(box.width, parseFloat(around.width) || 0), Math.max(box.height, parseFloat(around.height) || 0));
  };
  const small = pressable.filter((el) => reach(el) < 31.5);
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 1 && rect.height > 1)
      .map((rect) => rect.top)
      .sort((a, b) => a - b);
    let count = 0;
    let last = -Infinity;
    for (const top of tops) {
      if (top - last > 8) count += 1;
      last = top;
    }
    return count;
  };
  const wrapped = Array.from(document.querySelectorAll('header button, header a'))
    .concat(Array.from(scope.querySelectorAll('button,[role=tab],[role=radio],[data-slot=button],th')))
    .filter((el) => inView(el) && el.children.length <= 2 && lineCount(el) > 1);
  const clipped = Array.from(scope.querySelectorAll('*')).filter((el) => {
    if (!inView(el) || el.childElementCount > 3) return false;
    const style = getComputedStyle(el);
    if (style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none') return false;
    const cutX = (style.overflowX === 'hidden' || style.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2;
    const cutY = (style.overflowY === 'hidden' || style.overflowY === 'clip') && el.scrollHeight > el.clientHeight + 2;
    return (cutX || cutY) && (el.textContent || '').trim() !== '';
  });
  const barItems = Array.from(document.querySelectorAll('header a, header button'))
    .filter((el) => inView(el) && !el.closest('[inert]'))
    .map((el) => ({ el, box: el.getBoundingClientRect() }));
  let barOverlaps = 0;
  for (let i = 0; i < barItems.length; i += 1) {
    for (let j = i + 1; j < barItems.length; j += 1) {
      const a = barItems[i];
      const b = barItems[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const y = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (x > 2 && y > 2) barOverlaps += 1;
    }
  }
  return {
    url: location.pathname + location.search,
    loading: Boolean(scopeLoading()),
    pointer: matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    title: document.title,
    h1: (document.querySelector('main h1') || document.querySelector('h1'))?.textContent?.trim() ?? null,
    viteError: Boolean(document.querySelector('vite-error-overlay')),
    pageOverflowX: Math.max(0, doc.scrollWidth - vw),
    pageHeight: doc.scrollHeight,
    frame: frameBox ? { left: Math.round(frameBox.left), width: Math.round(frameBox.width) } : null,
    contentWidth,
    firstRowTop: firstRow ? Math.round(firstRow.getBoundingClientRect().top) : null,
    rows: rows.length,
    visibleRows: rows.filter(visible).length,
    scrollers,
    truncated,
    dialog: dialogFacts,
    smallTargets: { count: small.length, examples: small.slice(0, 5).map(sized) },
    wrapped: { count: wrapped.length, examples: wrapped.slice(0, 5).map(sized) },
    clipped: { count: clipped.length, examples: clipped.slice(0, 5).map(sized) },
    barOverlaps,
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
      m.loading ? '<b class="bad">still loading</b>' : '',
      m.pageOverflowX > 0 ? `<b class="bad">page +${m.pageOverflowX}px →</b>` : '',
      m.frame && m.contentWidth !== null
        ? m.contentWidth < m.frame.width * 0.75
          ? `<b class="bad">uses ${m.contentWidth}/${m.frame.width}px</b>`
          : `uses ${m.contentWidth}/${m.frame.width}px`
        : '',
      m.firstRowTop !== null ? `row 1 at ${m.firstRowTop}px` : '',
      m.rows ? `${m.visibleRows}/${m.rows} rows seen` : '',
      m.scrollers.length
        ? `scrollers: ${m.scrollers.map((s) => `${s.el} +${s.overflow}`).join(', ')}`
        : '',
      m.truncated ? `${m.truncated} truncated` : '',
      m.dialog
        ? `dialog ${m.dialog.width}×${m.dialog.height}${m.dialog.footerVisible === false ? ' <b class="bad">footer hidden</b>' : ''}${m.dialog.edge ? ' <b class="bad">no margin</b>' : ''}`
        : '',
      m.barOverlaps ? `<b class="bad">top bar overlaps ×${m.barOverlaps}</b>` : '',
      m.wrapped?.count ? `<b class="bad">${m.wrapped.count} wrapped</b>` : '',
      m.clipped?.count ? `<b class="bad">${m.clipped.count} clipped</b>` : '',
      m.smallTargets?.count ? `${m.smallTargets.count} small targets` : '',
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
  const first = await signIn();
  const ids = await discover(first.accessToken);
  // --ids product=10885,supplier=5: the records to open instead of the first ones found.
  for (const pair of String(args.ids ?? '')
    .split(',')
    .filter(Boolean)) {
    const [name, id] = pair.split('=');
    if (name && id) ids[name] = id;
  }
  console.log(`ids found: ${Object.keys(ids).join(', ') || 'none'}`);
  const browser = findBrowser();
  console.log(`browser: ${browser.kind}`);
  const report = {
    name: relative(join(ROOT, 'tmp', 'ui-shots'), out),
    at: new Date().toISOString(),
    sizes: sizes.map((s) => s.label),
    routes: [],
  };
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
  // A screen a finger works (a size ending in `t`) gets a browser of its own: a browser learns
  // what points at it when it starts.
  const groups = [false, true]
    .map((touch) => sizes.filter((size) => size.touch === touch))
    .filter((group) => group.length > 0);
  let stopCurrent = () => {};
  process.on('SIGINT', () => {
    stopCurrent();
    process.exit(130);
  });
  try {
    for (const [index, group] of groups.entries()) {
      // The app rotates the refresh cookie on every load, so each browser signs in for itself.
      const session = index === 0 ? first : await signIn();
      const driver = await (browser.kind === 'chrome' ? launchChrome : launchFirefox)(
        browser.path,
        group[0].touch,
      );
      stopCurrent = driver.stop;
      try {
        await captureAll(driver, session, group);
      } finally {
        driver.stop();
        stopCurrent = () => {};
      }
    }
  } finally {
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, 'index.html'), gallery(report));
  }
  const skipped = report.routes.filter((route) => route.skipped);
  console.log(
    `done: ${report.routes.length - skipped.length} routes × ${sizes.length} sizes in ${relative(ROOT, out)}` +
      (skipped.length ? `; skipped ${skipped.map((route) => route.name).join(', ')}` : ''),
  );

  async function captureAll(driver, session, group) {
    const { state } = driver;
    // Signed out first (sign-in, password set-up) at every size, then signed in once: the app
    // rotates the refresh cookie on every load and the browser keeps the latest one.
    const passes = [
      { signedIn: false, routes: PUBLIC_ROUTES.filter(wanted) },
      { signedIn: true, routes: ROUTES.filter(wanted) },
    ];
    let cookieSet = false;
    for (const { signedIn, routes } of passes) {
      for (const size of group) {
        await driver.viewport(size.width, size.height);
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
        await driver.cookie(session.refresh);
        cookieSet = true;
      }
      state.errors = [];
      state.failed = [];
      await load(driver, `${web}${path}`, { dialog: route.dialog, then: route.then });
      let metrics = await driver.evaluate(MEASURE);
      if (signedIn && metrics.url.startsWith('/login')) {
        // The session was lost (a rotated cookie): sign in again once and retry.
        const again = await signIn();
        session.refresh = again.refresh;
        await driver.cookie(session.refresh);
        state.errors = [];
        state.failed = [];
        await load(driver, `${web}${path}`, { dialog: route.dialog, then: route.then });
        metrics = await driver.evaluate(MEASURE);
      }
      const file = `${route.area}--${route.name}@${size.label}.png`;
      writeFileSync(join(out, file), await driver.screenshot());
      entry.shots.push({ size: size.label, file, metrics });
      for (const error of state.errors) if (!entry.errors.includes(error)) entry.errors.push(error);
      for (const failed of state.failed)
        if (!entry.failed.includes(failed)) entry.failed.push(failed);
      const flags = [
        metrics.pageOverflowX > 0 ? `page+${metrics.pageOverflowX}` : '',
        metrics.firstRowTop !== null ? `row1@${metrics.firstRowTop}` : '',
        metrics.rows ? `${metrics.visibleRows}/${metrics.rows}rows` : '',
        metrics.dialog?.footerVisible === false ? 'FOOTER-HIDDEN' : '',
        metrics.dialog?.edge ? 'DIALOG-NO-MARGIN' : '',
        metrics.barOverlaps ? `BAR-OVERLAP×${metrics.barOverlaps}` : '',
        metrics.wrapped.count ? `wrapped×${metrics.wrapped.count}` : '',
        metrics.clipped.count ? `clipped×${metrics.clipped.count}` : '',
        metrics.smallTargets.count ? `small×${metrics.smallTargets.count}` : '',
        metrics.viteError ? 'VITE-ERROR' : '',
        metrics.loading ? 'STILL-LOADING' : '',
        state.errors.length ? `${state.errors.length}err` : '',
        state.failed.length ? `${state.failed.length}failed` : '',
      ].filter(Boolean);
      console.log(`${size.label} ${route.name} ${flags.join(' ')}`);
    }
  }
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? `${error.message}${error.cause ? ` (${error.cause.code ?? error.cause.message})` : ''}`
      : error,
  );
  process.exit(1);
});
