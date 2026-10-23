// A small client of the local Bto api for the migration scripts (ADR-0098): signs in with a dev
// login from the gitignored logins file (never printed), signs in again when the 15-minute token
// expires, waits out an api that restarts, and uploads files through the presigned flow.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

export function readLogin(file, user) {
  if (!existsSync(file)) throw new Error(`no logins file at ${file}`);
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [name, secret] = line.trim().split(/\s+/);
    if (name === user && secret) return secret;
  }
  throw new Error(`no dev login for ${user}`);
}

export class BtoApi {
  constructor({ base, user, password }) {
    this.base = base.replace(/\/$/, '');
    this.user = user;
    this.password = password;
    this.token = null;
  }

  async signIn() {
    const response = await this.raw('POST', '/api/v1/auth/login', {
      username: this.user,
      password: this.password,
    });
    if (!response.ok) throw new Error(`sign-in failed: HTTP ${response.status}`);
    this.token = (await response.json()).accessToken;
  }

  async raw(method, path, body, headers = {}) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await fetch(`${this.base}${path}`, {
          method,
          headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...headers,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (response.status < 500 || attempt >= 30) return response;
      } catch (error) {
        if (attempt >= 30) throw error;
      }
      await sleep(2_000);
    }
  }

  /** JSON in and out; `idempotent` adds an Idempotency-Key; an error throws with the problem code. */
  async call(method, path, body, { idempotent = false } = {}) {
    if (!this.token) await this.signIn();
    const headers = idempotent ? { 'idempotency-key': randomUUID() } : {};
    let response = await this.raw(method, path, body, headers);
    if (response.status === 401) {
      await this.signIn();
      response = await this.raw(method, path, body, headers);
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(`${method} ${path}: HTTP ${response.status} ${json?.code ?? ''}`);
      error.status = response.status;
      error.problem = json;
      throw error;
    }
    return json;
  }

  get(path) {
    return this.call('GET', path);
  }

  /** Every row of a keyset list. */
  async all(path) {
    const rows = [];
    let cursor = null;
    do {
      const glue = path.includes('?') ? '&' : '?';
      const page = await this.get(
        `${path}${glue}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      rows.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  }

  /** Presigned upload of a file kind; returns the file id. */
  async upload(kind, contentType, bytes) {
    const presign = await this.call('POST', '/api/v1/files/presign', {
      kind,
      contentType,
      sizeBytes: bytes.length,
    });
    const response = await fetch(`${this.base}${presign.uploadUrl}`, {
      method: presign.method ?? 'PUT',
      // The presign names the exact Content-Type; a second spelling of the header would be joined.
      headers: presign.headers ?? { 'Content-Type': contentType },
      body: bytes,
    });
    if (!response.ok) throw new Error(`upload of ${kind} failed: HTTP ${response.status}`);
    return presign.fileId;
  }
}
