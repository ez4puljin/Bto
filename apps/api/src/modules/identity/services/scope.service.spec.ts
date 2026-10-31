import { AppError } from '../../../common/errors/app-error';
import type { AuthContext } from '../auth-context';
import { ScopeService } from './scope.service';

const context = (writable: number[] | null): AuthContext => ({
  kind: 'STAFF',
  userId: 7,
  sessionId: 's',
  username: 'bat',
  fullName: 'Бат',
  phone: null,
  permissions: new Set(),
  roleIds: [],
  writableWarehouseIds: writable === null ? null : new Set(writable),
  companyPermissions: new Map(),
});

describe('ScopeService', () => {
  const scope = new ScopeService();

  it('lets an unscoped user write everywhere', () => {
    expect(scope.canWriteWarehouse(context(null), 42)).toBe(true);
  });

  it('limits a scoped user to the writable warehouses', () => {
    const ctx = context([1, 3]);
    expect(scope.canWriteWarehouse(ctx, 3)).toBe(true);
    expect(scope.canWriteWarehouse(ctx, 2)).toBe(false);
  });

  it('answers 403 FORBIDDEN with the reason in params', () => {
    try {
      scope.assertCanWriteWarehouse(context([1]), 2);
      throw new Error('expected a FORBIDDEN error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
        params: { reason: 'WAREHOUSE_SCOPE', warehouseId: 2 },
      });
    }
  });
});
