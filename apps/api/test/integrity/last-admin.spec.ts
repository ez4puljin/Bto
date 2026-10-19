import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import type { AuthContext } from '../../src/modules/identity';
import { UsersService } from '../../src/modules/identity/services/users.service';
import { connectAs, createHttpApp } from '../harness/apps';
import { seedUser } from '../harness/identity';

const adminContext = (userId: number): AuthContext => ({
  kind: 'STAFF',
  userId,
  sessionId: '00000000-0000-7000-8000-000000000000',
  username: `admin${userId}`,
  fullName: 'Админ',
  permissions: new Set(['identity.users.manage']),
  roleIds: [],
  writableWarehouseIds: null,
  companyPermissions: new Map(),
});

/**
 * The last active ADMIN survives two admins demoting each other at once (ADR-0027 #6). The
 * service is called directly so both transactions really overlap; over HTTP the second request
 * could already fail authentication, which would hide the race.
 */
describe('integrity: last active admin', () => {
  let app: NestExpressApplication;
  let sql: Client;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it.each(['status', 'roles'] as const)(
    'lets exactly one of two concurrent cross-demotions (%s) succeed',
    async (change) => {
      // Exactly two active admins in play (rows of earlier cases stay until the next file).
      await sql.query("UPDATE users SET status = 'DISABLED'");
      const a = await seedUser(app, { roles: ['ADMIN'] });
      const b = await seedUser(app, { roles: ['ADMIN'] });
      const users = app.get(UsersService);
      const patch = change === 'status' ? { status: 'DISABLED' as const } : { roleIds: [] };
      const results = await Promise.allSettled([
        users.update(adminContext(a.id), b.id, patch),
        users.update(adminContext(b.id), a.id, patch),
      ]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled');
      const rejected = results.filter((result) => result.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: 'LAST_ADMIN' });
      const { rows } = await sql.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM users u
           JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id AND r.code = 'ADMIN'
          WHERE u.status = 'ACTIVE' AND u.id IN ($1, $2)`,
        [a.id, b.id],
      );
      expect(rows[0]?.count).toBe(1);
    },
  );
});
