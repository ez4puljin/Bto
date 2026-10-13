import type { NestExpressApplication } from '@nestjs/platform-express';
import { inArray } from 'drizzle-orm';
import request, { type Response } from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { roles, userRoles, userScopes, users } from '../../src/modules/identity/schema';
import { issuePasswordCode } from '../../src/modules/identity/services/password-codes';
import { PasswordHasher } from '../../src/modules/identity/services/password-hasher.service';

/** Host and Origin the cookie routes accept in tests (they must match, ADR-0027 #8). */
export const TEST_HOST = 'tugeel.test';
export const SAME_ORIGIN = { Host: TEST_HOST, Origin: `http://${TEST_HOST}` };
export const DEFAULT_PASSWORD = 'correct-horse-9';
export const TEST_PEPPER = 'test-auth-pepper-0123456789abcdefghijklmnop';

let usernames = 0;
/** A username that is unique within this Jest worker (tables are truncated per file only). */
export function uniqueUsername(prefix = 'user'): string {
  usernames += 1;
  return `${prefix}.${process.env.JEST_WORKER_ID ?? '1'}.${usernames}`.slice(0, 32);
}

let addresses = 0;
/** A fresh documentation-range client address (RFC 5737), so limiter buckets never collide. */
export function testIp(): string {
  addresses += 1;
  const host = (addresses % 250) + 1;
  const prefixes = ['203.0.113', '198.51.100', '192.0.2'];
  return `${prefixes[Math.floor(addresses / 250) % prefixes.length] ?? '203.0.113'}.${host}`;
}

export interface SeededUser {
  id: number;
  username: string;
  password: string;
}

/** Inserts a staff user directly (with roles by system code and optional write scopes). */
export async function seedUser(
  app: NestExpressApplication,
  options: {
    roles?: string[];
    password?: string | null;
    status?: 'ACTIVE' | 'DISABLED';
    warehouseIds?: number[];
    branchIds?: number[];
    username?: string;
  } = {},
): Promise<SeededUser> {
  const db = app.get<Db>(DB);
  const hasher = app.get(PasswordHasher);
  const username = options.username ?? uniqueUsername();
  const password = options.password === undefined ? DEFAULT_PASSWORD : options.password;
  const [user] = await db
    .insert(users)
    .values({
      username,
      fullName: 'Тест хэрэглэгч',
      passwordHash: password ? await hasher.hash(password) : null,
      status: options.status ?? 'ACTIVE',
    })
    .returning({ id: users.id });
  if (!user) throw new Error('seedUser: no row');
  if (options.roles?.length) {
    const found = await db
      .select({ id: roles.id })
      .from(roles)
      .where(inArray(roles.code, options.roles));
    await db.insert(userRoles).values(found.map((role) => ({ userId: user.id, roleId: role.id })));
  }
  for (const warehouseId of options.warehouseIds ?? []) {
    await db.insert(userScopes).values({ userId: user.id, warehouseId });
  }
  for (const branchId of options.branchIds ?? []) {
    await db.insert(userScopes).values({ userId: user.id, branchId });
  }
  return { id: user.id, username, password: password ?? '' };
}

/** A one-time password code as an admin would issue it. */
export async function issueCode(app: NestExpressApplication, userId: number): Promise<string> {
  const issued = await inTransaction(app.get<Db>(DB), (tx) =>
    issuePasswordCode(tx, { userId, createdBy: null, pepper: TEST_PEPPER }),
  );
  return issued.code;
}

/** `tugeel_rt=<value>` from a Set-Cookie header, ready to send back in a Cookie header. */
export function refreshCookieOf(response: Response): string {
  const header: unknown = response.headers['set-cookie'];
  const list = Array.isArray(header) ? (header as string[]) : [];
  const cookie = list.find((value) => value.startsWith('tugeel_rt='));
  return cookie?.split(';')[0] ?? '';
}

export interface LoggedIn {
  accessToken: string;
  cookie: string;
  ip: string;
  response: Response;
}

export async function login(
  app: NestExpressApplication,
  user: { username: string; password: string },
  ip = testIp(),
): Promise<LoggedIn> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ username: user.username, password: user.password })
    .expect(200);
  const body = response.body as { accessToken: string };
  return { accessToken: body.accessToken, cookie: refreshCookieOf(response), ip, response };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A user holding only a custom role with these permissions, signed in (ADR-0027 #4). */
export async function customRoleUser(
  app: NestExpressApplication,
  adminToken: string,
  permissions: readonly string[],
): Promise<string> {
  const http = () => request(app.getHttpServer());
  const role = await http()
    .post('/api/v1/roles')
    .set(bearer(adminToken))
    .send({ name: `Дүр ${uniqueUsername('role')}`, permissions })
    .expect(201);
  const user = await seedUser(app);
  await http()
    .patch(`/api/v1/users/${user.id}`)
    .set(bearer(adminToken))
    .send({ roleIds: [(role.body as { id: number }).id] })
    .expect(200);
  return (await login(app, user)).accessToken;
}
