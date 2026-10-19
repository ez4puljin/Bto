import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import type { CustomerContext } from '../auth-context';

export interface ResolvedCustomer extends CustomerContext {
  readonly sessionStartedAt: Date;
  readonly sessionExpiresAt: Date;
}

interface CustomerRow extends Record<string, unknown> {
  customer_id: string | number;
  phone: string;
  created_at: string | Date;
  expires_at: string | Date;
}

const asDate = (value: string | Date): Date => (value instanceof Date ? value : new Date(value));

/**
 * Resolves the store of a customer session on every request (ADR-0079 #3), as AccessService does
 * for staff: a live CUSTOMER session of an ACTIVE account, read in one query. The customer's own
 * status is checked at sign-in and refresh (partners' gate); deactivating a customer ends its
 * sessions at once.
 */
@Injectable()
export class CustomerAccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async resolve(
    customerUserId: number,
    sessionId: string,
    requestId?: string,
  ): Promise<ResolvedCustomer | null> {
    const result = await this.db.execute<CustomerRow>(sql`
      SELECT cu.customer_id, cu.phone, s.created_at, s.expires_at
        FROM auth_sessions s
        JOIN customer_users cu ON cu.id = s.customer_user_id
       WHERE s.id = ${sessionId} AND s.kind = 'CUSTOMER' AND s.customer_user_id = ${customerUserId}
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND cu.status = 'ACTIVE'`);
    const row = result.rows[0];
    if (!row) return null;
    return {
      kind: 'CUSTOMER',
      customerUserId,
      customerId: Number.parseInt(String(row.customer_id), 10),
      sessionId,
      phone: row.phone,
      sessionStartedAt: asDate(row.created_at),
      sessionExpiresAt: asDate(row.expires_at),
      ...(requestId ? { requestId } : {}),
    };
  }
}
