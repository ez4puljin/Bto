import { Inject, Injectable } from '@nestjs/common';
import { isPermission, type Permission } from '@tugeel/shared/auth';
import { inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { AuthContext } from '../auth-context';
import { roles } from '../schema';

export interface ResolvedAccess extends AuthContext {
  /** When the session signed in; a refresh rotates its token, never this. */
  readonly sessionStartedAt: Date;
  readonly sessionExpiresAt: Date;
}

export interface RoleRef {
  id: number;
  code: string | null;
  name: string | null;
  isSystem: boolean;
}

interface AccessRow extends Record<string, unknown> {
  username: string;
  phone: string | null;
  full_name: string;
  created_at: string | Date;
  expires_at: string | Date;
  permissions: string[];
  role_ids: string[];
  scoped: boolean;
  writable: string[];
  /** Company code → its finance permission codes. */
  company_permissions: Record<string, string[]>;
}

const toId = (value: string): number => Number.parseInt(value, 10);

/**
 * Resolves the AuthContext of a session on every request (ADR-0027 #2): one query for session
 * validity, user status, effective permissions, the expanded write scope and the finance rights
 * per company (ADR-0084 #2). Revocations and role changes therefore apply to the very next request.
 */
@Injectable()
export class AccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async resolve(
    userId: number,
    sessionId: string,
    requestId?: string,
  ): Promise<ResolvedAccess | null> {
    const result = await this.db.execute<AccessRow>(sql`
      SELECT u.username, u.full_name, u.phone, s.created_at, s.expires_at,
        ARRAY(SELECT DISTINCT rp.permission_code FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
               WHERE ur.user_id = u.id) AS permissions,
        ARRAY(SELECT ur.role_id::text FROM user_roles ur WHERE ur.user_id = u.id
               ORDER BY ur.role_id) AS role_ids,
        EXISTS (SELECT 1 FROM user_scopes us WHERE us.user_id = u.id) AS scoped,
        ARRAY(SELECT w.id::text FROM warehouses w
               WHERE w.kind = 'TRANSIT'
                  OR w.id IN (SELECT us.warehouse_id FROM user_scopes us WHERE us.user_id = u.id)
                  OR w.branch_id IN (SELECT us.branch_id FROM user_scopes us WHERE us.user_id = u.id)
             ) AS writable,
        COALESCE((SELECT json_object_agg(c.company_code, c.codes) FROM (
            SELECT ucr.company_code,
                   array_agg(DISTINCT rp.permission_code ORDER BY rp.permission_code) AS codes
              FROM user_company_roles ucr
              JOIN role_permissions rp ON rp.role_id = ucr.role_id
             WHERE ucr.user_id = u.id AND rp.permission_code LIKE 'finance.%'
             GROUP BY ucr.company_code) c), '{}'::json) AS company_permissions
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
       WHERE s.id = ${sessionId} AND s.kind = 'STAFF' AND s.user_id = ${userId}
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'ACTIVE'`);
    const row = result.rows[0];
    if (!row) return null;
    const permissions = new Set<Permission>(row.permissions.filter(isPermission));
    return {
      kind: 'STAFF',
      userId,
      sessionId,
      username: row.username,
      fullName: row.full_name,
      phone: row.phone,
      permissions,
      roleIds: row.role_ids.map(toId),
      writableWarehouseIds: row.scoped ? new Set(row.writable.map(toId)) : null,
      companyPermissions: new Map(
        Object.entries(row.company_permissions).map(([company, codes]) => [
          company,
          new Set(codes.filter(isPermission)),
        ]),
      ),
      sessionStartedAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      sessionExpiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
      ...(requestId ? { requestId } : {}),
    };
  }

  /** The roles behind an AuthContext, for GET /auth/me and the admin screens. */
  async roleRefs(roleIds: readonly number[]): Promise<RoleRef[]> {
    if (!roleIds.length) return [];
    return this.db
      .select({ id: roles.id, code: roles.code, name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(inArray(roles.id, [...roleIds]))
      .orderBy(roles.id);
  }
}
