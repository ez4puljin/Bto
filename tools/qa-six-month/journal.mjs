import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertApiPath, QA_API_PORT } from './safety.mjs';
import { DATASET_ID, DAYS, FIRST_DAY, LAST_DAY, summary } from './dataset.mjs';

export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function uuid(key) {
  const h = hash([DATASET_ID, key]).slice(0, 32).split('');
  h[12] = '4';
  h[16] = '8';
  return `${h.slice(0, 8).join('')}-${h.slice(8, 12).join('')}-${h.slice(12, 16).join('')}-${h.slice(16, 20).join('')}-${h.slice(20).join('')}`;
}
export const rows = (response) =>
  Array.isArray(response) ? response : (response.data ?? response.rows ?? response.items ?? []);

export function exactlyOne(matches, label) {
  if (matches.length > 1)
    throw new Error(`Ambiguous recovery for ${label}: ${matches.length} records`);
  return matches[0];
}

export async function allPages(get, path) {
  const collected = [],
    seen = new Set();
  let cursor;
  do {
    const page = await get(
      cursor
        ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
        : path,
    );
    if (!Array.isArray(page) && !Array.isArray(page?.data))
      throw new Error(`Expected paginated list: ${path}`);
    collected.push(...rows(page));
    cursor = Array.isArray(page) ? null : page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error(`Repeated pagination cursor: ${path}`);
    seen.add(cursor);
  } while (cursor);
  return collected;
}

const sanitized = (value) =>
  value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(value, (key, entry) =>
          /^(?:password|newPassword|passwordHash|pin|pinHash|accessToken|refreshToken|token|secret|setupCode)$/i.test(
            key,
          )
            ? '[REDACTED]'
            : entry,
        ),
      );

/** Persist before every business write; an interrupted pending write must be replayable or recovered. */
export async function createJournal(runtime) {
  const lockPath = join(runtime.directory, 'run.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString(),
        dataset: DATASET_ID,
      }),
    );
    return await initializeJournal(runtime, lock, lockPath);
  } catch (error) {
    try {
      await lock.close();
    } finally {
      await unlink(lockPath);
    }
    throw error;
  }
}

async function initializeJournal(runtime, lock, lockPath) {
  const path = join(runtime.directory, 'run.json');
  const logPath = join(runtime.directory, 'operations.ndjson');
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    state = {
      dataset: DATASET_ID,
      specificationHash: hash(summary()),
      createdAt: new Date().toISOString(),
      window: { from: FIRST_DAY, through: LAST_DAY, novemberPartial: true },
      clock:
        'Process-only logical business date; immutable database/audit createdAt is actual generation time',
      operations: {},
      refs: {},
      checks: {},
      completedDays: [],
    };
  }
  if (state.dataset !== DATASET_ID || state.specificationHash !== hash(summary())) {
    throw new Error('Checkpoint does not match deterministic dataset');
  }
  try {
    const source = await readFile(logPath, 'utf8');
    // A torn last record is never ignored: inspect the attempted operation before resuming.
    for (const line of source.split('\n').filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.dataset !== DATASET_ID) throw new Error('Wrong operation-log dataset');
      state.operations[event.key] = event.operation;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const logicalFloors = new Map();
  const rememberLogicalInstant = (operation) => {
    if (operation.logicalInstant === undefined) return;
    const chosen = new Date(operation.logicalInstant);
    if (
      !DAYS.includes(operation.logicalDay) ||
      !Number.isFinite(chosen.getTime()) ||
      chosen.toISOString() !== operation.logicalInstant
    )
      throw new Error('Invalid durable logical operation instant');
    const previous = logicalFloors.get(operation.logicalDay);
    if (!previous || operation.logicalInstant > previous)
      logicalFloors.set(operation.logicalDay, operation.logicalInstant);
  };
  for (const operation of Object.values(state.operations)) rememberLogicalInstant(operation);
  const save = async () => {
    await writeFile(`${path}.tmp`, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  };
  await save();
  const persistOperation = async (key, operation) => {
    const file = await open(logPath, 'a', 0o600);
    try {
      await file.writeFile(JSON.stringify({ dataset: DATASET_ID, key, operation }) + '\n');
      await file.sync();
    } finally {
      await file.close();
    }
    state.operations[key] = operation;
    rememberLogicalInstant(operation);
  };
  let token;
  const raw = async (method, path, body, { edgeToken, key, anonymous = false } = {}) => {
    assertApiPath(path);
    const response = await fetch(`http://127.0.0.1:${QA_API_PORT}/api/v1${path}`, {
      method,
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(edgeToken || (!anonymous && token)
          ? { Authorization: `Bearer ${edgeToken ?? token}` }
          : {}),
        ...(key ? { 'Idempotency-Key': uuid(key) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const source = await response.text();
    let result;
    try {
      result = source ? JSON.parse(source) : null;
    } catch {
      throw new Error(`QA API ${method} ${path}: non-JSON response (${response.status})`);
    }
    return { status: response.status, ok: response.ok, body: result };
  };
  const login = async () => {
    const result = runtime.setupCode
      ? await raw(
          'POST',
          '/auth/password/setup',
          { login: 'shiro', code: runtime.setupCode, newPassword: runtime.password },
          { anonymous: true },
        )
      : await raw(
          'POST',
          '/auth/login',
          { login: 'shiro', password: runtime.password },
          { anonymous: true },
        );
    if (!result.ok || !result.body.accessToken)
      throw new Error(`QA administrator authentication failed (${result.status})`);
    token = result.body.accessToken;
    runtime.setupCode = undefined;
    if (!Number.isSafeInteger(result.body.me?.id) || result.body.me.id <= 0)
      throw new Error('QA login is missing administrator identity');
    state.refs.admin = result.body.me;
  };
  const request = async (method, path, body, options = {}) => {
    let response = await raw(method, path, body, options);
    if (response.status === 401 && !options.edgeToken) {
      await login();
      response = await raw(method, path, body, options);
    }
    if (!response.ok)
      throw new Error(
        `QA API ${method} ${path} failed (${response.status}): ${JSON.stringify(response.body).slice(0, 1800)}`,
      );
    return response.body;
  };
  const operation = async (key, specification, execute, recover) => {
    const old = state.operations[key],
      fingerprint = hash(specification);
    const authorizedReplacement =
      old?.status === 'REJECTED' && old.allowedReplacementHash === fingerprint;
    if (old?.status === 'REJECTED' && !authorizedReplacement)
      throw new Error(`Rejected operation ${key} requires its explicitly authorized replacement`);
    if (old && old.hash !== fingerprint && !authorizedReplacement)
      throw new Error(`Changed payload for checkpointed operation ${key}`);
    const floor = logicalFloors.get(runtime.clock.day);
    if (floor) runtime.clock.advanceFloor(floor);
    if (old?.status === 'DONE') return old.result;
    if (old?.status === 'PENDING' && !specification.idempotent) {
      if (!recover)
        throw new Error(`Interrupted non-idempotent operation ${key} needs explicit recovery`);
      const found = await recover();
      if (found) {
        await persistOperation(key, {
          ...old,
          status: 'DONE',
          result: sanitized(found),
          recovered: true,
        });
        return found;
      }
    }
    runtime.clock.tick();
    const chosen = runtime.clock.instant;
    await persistOperation(key, {
      hash: fingerprint,
      status: 'PENDING',
      specification: {
        method: specification.method,
        path: specification.path,
        description: specification.description,
        payloadHash: hash(specification.body ?? null),
        idempotent: specification.idempotent,
      },
      attemptedAt: new Date().toISOString(),
      requestKey: authorizedReplacement
        ? `${key}/replacement/${fingerprint}`
        : (old?.requestKey ?? key),
      ...(authorizedReplacement || old?.rejectedAttempt
        ? { rejectedAttempt: authorizedReplacement ? old : old.rejectedAttempt }
        : {}),
      ...(chosen instanceof Date
        ? { logicalDay: runtime.clock.day, logicalInstant: chosen.toISOString() }
        : {}),
    });
    const result = await execute();
    await persistOperation(key, {
      ...state.operations[key],
      status: 'DONE',
      result: sanitized(result),
      completedAt: new Date().toISOString(),
    });
    return result;
  };
  await login();
  return {
    runtime,
    state,
    refs: state.refs,
    save,
    request,
    get: (path, options) => request('GET', path, undefined, options),
    all: (path) => allPages((page) => request('GET', page), path),
    write: (key, method, path, body, options = {}) =>
      operation(
        key,
        { method, path, body, idempotent: options.idempotent === true },
        () => request(method, path, body, { ...options, key: state.operations[key].requestKey }),
        options.recover,
      ),
    service: (key, description, execute, recover) =>
      operation(key, { description, idempotent: false }, execute, recover),
    memo: (key, description, execute) => operation(key, { description, idempotent: true }, execute),
    create: async (key, path, body, { listPath = path, match } = {}) => {
      if (!match) throw new Error(`Creation ${key} needs deterministic recovery match`);
      const recover = async () =>
        exactlyOne((await allPages((page) => request('GET', page), listPath)).filter(match), key);
      return operation(
        key,
        { method: 'POST', path, body, idempotent: false },
        async () => (await recover()) ?? request('POST', path, body, { key }),
        recover,
      );
    },
    close: async () => {
      try {
        await save();
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    },
  };
}
