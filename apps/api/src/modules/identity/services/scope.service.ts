import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import type { AuthContext } from '../auth-context';

/**
 * Write scopes (ADR-0027 #7, owner answer 2026-10-10): a scope limits which warehouses a user may
 * write documents for; reads are never filtered. Document services call this before posting.
 */
@Injectable()
export class ScopeService {
  canWriteWarehouse(ctx: AuthContext, warehouseId: number): boolean {
    return ctx.writableWarehouseIds === null || ctx.writableWarehouseIds.has(warehouseId);
  }

  assertCanWriteWarehouse(ctx: AuthContext, warehouseId: number): void {
    if (!this.canWriteWarehouse(ctx, warehouseId)) {
      throw new AppError(
        'FORBIDDEN',
        `warehouse ${warehouseId} is outside the write scope of user ${ctx.userId}`,
        { reason: 'WAREHOUSE_SCOPE', warehouseId },
      );
    }
  }
}
