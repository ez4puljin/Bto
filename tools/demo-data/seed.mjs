#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATASET_ID, summary } from './dataset.mjs';
import { seedCore } from './core.mjs';

export const LOCAL_API = 'http://127.0.0.1:3300/api/v1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function operationHash(method, path, body) {
  return hash(`${method}\n${path}\n${canonical(body ?? null)}`);
}
export function idempotencyKey(key) {
  const bytes = hash(`${DATASET_ID}\n${key}`).slice(0, 32).split('');
  bytes[12] = '5';
  bytes[16] = '8';
  const s = bytes.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function parseArgs(args) {
  const result = {
    apply: false,
    phase: 'all',
    repo: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--apply') result.apply = true;
    else if (args[i] === '--help') result.help = true;
    else if (['--repo', '--phase', '--api'].includes(args[i])) {
      const key = args[i].slice(2),
        value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing --${key} value`);
      result[key] = key === 'repo' ? resolve(value) : value;
    } else throw new Error(`Unknown option ${args[i]}`);
  }
  if (!['core', 'all', 'extras'].includes(result.phase))
    throw new Error('--phase must be core, extras or all');
  if (result.api && result.api !== LOCAL_API) throw new Error(`Only ${LOCAL_API} is allowed`);
  return result;
}
export function parseEnv(source) {
  const entries = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    entries[match[1]] = value;
  }
  return entries;
}
/** Refuse every database except this owner's isolated local development database. */
export function verifyLocal(config, env = process.env) {
  const nodeEnv = env.NODE_ENV ?? config.NODE_ENV;
  if (nodeEnv !== 'development') throw new Error('NODE_ENV must be development');
  for (const value of [config.DATABASE_URL, env.DATABASE_URL].filter(
    (value) => value !== undefined,
  )) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Invalid DATABASE_URL (value suppressed)');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '15432' ||
      url.pathname !== '/bto_local_shiro' ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Refusing database: require 127.0.0.1:15432/bto_local_shiro without query overrides',
      );
    }
  }
  if (!config.DATABASE_URL)
    throw new Error('The installed checkout apps/api/.env must declare DATABASE_URL');
  if (String(config.API_PORT ?? '3300') !== '3300' || (env.API_PORT && env.API_PORT !== '3300'))
    throw new Error('API_PORT must be 3300');
  return hash('127.0.0.1:15432/bto_local_shiro');
}

const blocked =
  /(?:^|\/)(?:settings|imports|erkhet|erxes|ebarimt|ebarimt-check|sms|settlement-sms|phone-lines|password|pin|close|reopen|year-close|notifications|print-stations)(?:\/|$)/i;
export function apiUrl(path) {
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('#') ||
    /(?:^|\/)\.\.(?:\/|$)/.test(path)
  )
    throw new Error('API paths must stay inside the local /api/v1');
  const url = new URL(`${LOCAL_API}${path}`);
  if (url.origin !== 'http://127.0.0.1:3300' || !url.pathname.startsWith('/api/v1/'))
    throw new Error('API URL escaped the local prefix');
  if (blocked.test(decodeURIComponent(url.pathname)))
    throw new Error(`Provider, identity-secret and fiscal actions are blocked: ${path}`);
  return url;
}
export function routeOf(openapi, method, path) {
  const pathname = apiUrl(path).pathname;
  for (const [template, methods] of Object.entries(openapi.paths)) {
    const pattern = new RegExp(
      `^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`,
    );
    if (pattern.test(pathname) && methods[method.toLowerCase()])
      return methods[method.toLowerCase()];
  }
  throw new Error(`Unknown OpenAPI route: ${method} ${path}`);
}

export class LocalApi {
  constructor(openapi, fetcher = fetch) {
    this.openapi = openapi;
    this.fetcher = fetcher;
    this.token = undefined;
  }
  async request(method, path, body, key) {
    routeOf(this.openapi, method, path);
    const response = await this.fetcher(apiUrl(path), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(key ? { 'Idempotency-Key': idempotencyKey(key) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const raw = await response.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new Error(`Non-JSON response: ${method} ${path} (${response.status})`);
    }
    if (!response.ok) {
      const error = new Error(
        `${method} ${path}: HTTP ${response.status} ${data?.code ?? data?.title ?? 'request failed'}`,
      );
      error.status = response.status;
      // Validation paths contain no submitted values or credentials.
      error.validation = (data?.errors ?? []).map((item) => ({
        path: item.path,
        constraint: item.constraint,
      }));
      throw error;
    }
    return data;
  }
  get(path) {
    return this.request('GET', path);
  }
  async all(path) {
    const rows = [],
      seen = new Set();
    let cursor;
    do {
      const query = cursor
        ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
        : path;
      const page = await this.get(query);
      if (Array.isArray(page)) {
        rows.push(...page);
        break;
      }
      if (!Array.isArray(page?.data)) throw new Error(`Expected list response: ${path}`);
      rows.push(...page.data);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error(`Repeated pagination cursor: ${path}`);
      seen.add(cursor);
    } while (cursor);
    return rows;
  }
}

/** Journal successful responses and ambiguous requests before/after each HTTP mutation. */
export class Journal {
  constructor(state, save, api, log = console.log) {
    Object.assign(this, { state, save, api, log });
  }
  async mutate(key, method, path, body) {
    if (!/^(core|extras)\//.test(key))
      throw new Error('Operation keys need a stable core/ or extras/ prefix');
    const requestHash = operationHash(method, path, body);
    const before = this.state.operations[key];
    if (before && before.status !== 'rejected' && before.requestHash !== requestHash)
      throw new Error(`Operation changed since checkpoint: ${key}`);
    if (before?.status === 'done') return before.response;
    const route = routeOf(this.api.openapi, method, path);
    const replayable = route.parameters?.some(
      (parameter) =>
        parameter.in === 'header' && parameter.name.toLowerCase() === 'idempotency-key',
    );
    if (before?.status === 'pending' && !replayable)
      throw new Error(
        `Ambiguous non-idempotent write ${key}; inspect its DEMO record before resuming`,
      );
    this.state.operations[key] = { requestHash, status: 'pending', method, path };
    await this.save(this.state);
    try {
      const response = await this.api.request(method, path, body, key);
      this.state.operations[key] = { requestHash, status: 'done', response };
      await this.save(this.state);
      this.log(`DONE ${key}`);
      return response;
    } catch (error) {
      // A normal 4xx rejected the request; transport errors and 5xx stay ambiguous.
      if (error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status)) {
        this.state.operations[key].status = 'rejected';
        await this.save(this.state);
      }
      throw error;
    }
  }
  async create(key, path, body, { listPath = path, match } = {}) {
    if (!match) throw new Error(`Creation requires a DEMO identity matcher: ${key}`);
    const requestHash = operationHash('POST', path, body);
    const before = this.state.operations[key];
    if (before && before.status !== 'rejected' && before.requestHash !== requestHash)
      throw new Error(`Operation changed since checkpoint: ${key}`);
    if (before?.status === 'done') return before.response;
    const matches = (await this.api.all(listPath)).filter(match);
    if (matches.length > 1) throw new Error(`More than one matching DEMO record: ${key}`);
    if (matches.length === 1) {
      this.state.operations[key] = {
        requestHash,
        status: 'done',
        response: matches[0],
        recovered: true,
      };
      await this.save(this.state);
      this.log(`FOUND ${key}`);
      return matches[0];
    }
    return this.mutate(key, 'POST', path, body);
  }
}

async function saveJson(path, data) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(
      'node tools/demo-data/seed.mjs [--apply] [--repo <installed-checkout>] [--phase core|extras|all]',
    );
    return;
  }
  console.log(`Bto fictional demo dataset: ${DATASET_ID}; phase=${options.phase}`);
  console.log(JSON.stringify(summary, null, 2));
  if (!options.apply) {
    console.log(
      'PREVIEW ONLY. No HTTP requests, authentication, files or database writes. Add --apply to seed the guarded local development API.',
    );
    return;
  }
  const config = parseEnv(await readFile(join(options.repo, 'apps/api/.env'), 'utf8'));
  const databaseFingerprint = verifyLocal(config);
  const require = createRequire(join(options.repo, 'package.json'));
  const shared = Object.fromEntries(
    ['money', 'time', 'gtin', 'units', 'catalog', 'hr'].map((name) => [
      name,
      require(`@tugeel/shared/${name}`),
    ]),
  );
  const openapi = JSON.parse(
    await readFile(join(options.repo, 'packages/api-client/openapi.json'), 'utf8'),
  );
  const login = process.env.BTO_DEMO_LOGIN,
    password = process.env.BTO_DEMO_PASSWORD;
  if (!login || !password)
    throw new Error(
      'Set BTO_DEMO_LOGIN and BTO_DEMO_PASSWORD in this process; credentials are never saved',
    );
  const stateDir = join(options.repo, '.data/demo-data');
  await mkdir(stateDir, { recursive: true });
  const statePath = join(stateDir, `${DATASET_ID}.json`),
    lockPath = join(stateDir, `${DATASET_ID}.lock`);
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Another seed run owns the lock; after confirming it stopped, remove only the .data/demo-data/*.lock file',
        { cause: error },
      );
    throw error;
  }
  try {
    await lock.writeFile(String(process.pid));
    let state;
    try {
      state = JSON.parse(await readFile(statePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    state ??= {
      datasetId: DATASET_ID,
      api: LOCAL_API,
      databaseFingerprint,
      today: shared.time.businessDate(),
      operations: {},
      refs: {},
    };
    if (
      state.datasetId !== DATASET_ID ||
      state.api !== LOCAL_API ||
      state.databaseFingerprint !== databaseFingerprint
    )
      throw new Error('Manifest belongs to a different dataset or target');
    const api = new LocalApi(openapi);
    const session = await api.request('POST', '/auth/login', { login, password });
    api.token = session.accessToken;
    if (!api.token || !session.me?.id) throw new Error('Unexpected authentication response');
    if (state.userId && state.userId !== session.me.id)
      throw new Error(
        'Resume using the original seed user so server idempotency keys keep the same scope',
      );
    state.userId = session.me.id;
    await saveJson(statePath, state);
    const journal = new Journal(state, (value) => saveJson(statePath, value), api);
    const ctx = {
      today: state.today,
      refs: state.refs,
      shared,
      api,
      all: (path) => api.all(path),
      mutate: (...values) => journal.mutate(...values),
      create: (...values) => journal.create(...values),
      log: (message) => console.log(message),
    };
    if (options.phase !== 'extras') {
      await seedCore(ctx);
      state.refs = ctx.refs;
      state.coreComplete = true;
      await saveJson(statePath, state);
    }
    if (options.phase !== 'core') {
      if (!state.coreComplete) throw new Error('Run --phase core first before --phase extras');
      const { seedExtras } = await import('./extras.mjs');
      state.extras = await seedExtras(ctx);
      state.extrasComplete = true;
      await saveJson(statePath, state);
    }
    console.log(
      `Complete. ${Object.keys(state.operations).length} journalled operations. Manifest: ${statePath}`,
    );
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    if (error.validation?.length) console.error(JSON.stringify(error.validation));
    process.exitCode = 1;
  });
}
