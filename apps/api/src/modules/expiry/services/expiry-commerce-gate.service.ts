import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { EXPIRY_PAYROLL_SOURCE, type ExpiryPayrollSource } from '../ports';

/** Shared by commercial posting and ordinary archival. Always taken before an expiry item lock. */
@Injectable()
export class ExpiryCommerceGate {
  constructor(private readonly moduleRef: ModuleRef) {}
  async lockInTx(tx: Tx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(72026240,1)`);
    await this.moduleRef
      .get<ExpiryPayrollSource>(EXPIRY_PAYROLL_SOURCE, { strict: false })
      .lockInTx(tx);
  }
}
