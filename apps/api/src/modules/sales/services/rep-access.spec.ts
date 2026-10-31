import type { Permission } from '@tugeel/shared/auth';
import type { StageAction } from '@tugeel/shared/sales';
import type { AuthContext } from '../../identity';
import { repMayPlace } from './rep-access';
import type { PipelineView, StageView } from './sales-access.service';

const REP_ROLE = 7;
const OFFICE_ROLE = 3;

const ctx = (permissions: Permission[], roleIds: number[] = [REP_ROLE]): AuthContext => ({
  kind: 'STAFF',
  userId: 1,
  sessionId: 's',
  username: 'rep',
  fullName: 'Rep',
  permissions: new Set(permissions),
  roleIds,
  writableWarehouseIds: null,
  companyPermissions: new Map(),
});

const stage = (fields: Partial<StageView> = {}): StageView => ({
  id: 10,
  pipelineId: 1,
  name: 'ХТ Захиалга',
  position: 0,
  action: 'NONE',
  printPickList: false,
  printDeliveryNote: false,
  cardSort: 'NEWEST',
  archivedAt: null,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
  ...fields,
});

const pipeline = (fields: Partial<PipelineView> = {}): PipelineView => ({
  id: 1,
  boardId: 1,
  name: 'Мөрөн Борлуулалт',
  position: 0,
  kind: 'SALES',
  transferWarehouseId: null,
  visibility: 'PUBLIC',
  ownOrdersOnly: false,
  archivedAt: null,
  createdBy: null,
  createdAt: new Date(),
  roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
  stages: [],
  ...fields,
});

const rep = ctx(['sales.orders.rep']);

describe('repMayPlace (ADR-0061 #6)', () => {
  it('opens live NONE and CONFIRM stages of a public pipeline whose MOVE is open', () => {
    for (const action of ['NONE', 'CONFIRM'] as StageAction[]) {
      expect(repMayPlace(rep, pipeline(), stage({ action }))).toBe(true);
    }
    for (const action of ['PICK', 'SALE', 'CANCEL'] as StageAction[]) {
      expect(repMayPlace(rep, pipeline(), stage({ action }))).toBe(false);
    }
  });

  it('needs the permission, live rows and a stage of that pipeline', () => {
    expect(
      repMayPlace(ctx(['sales.orders.read', 'sales.orders.manage']), pipeline(), stage()),
    ).toBe(false);
    expect(repMayPlace(rep, pipeline({ archivedAt: new Date() }), stage())).toBe(false);
    expect(repMayPlace(rep, pipeline(), stage({ archivedAt: new Date() }))).toBe(false);
    expect(repMayPlace(rep, pipeline({ id: 2 }), stage())).toBe(false);
  });

  it('follows MOVE roles and the private pipelines a rep role sees', () => {
    const office = { VIEW: [], EDIT: [], MOVE: [OFFICE_ROLE] };
    const reps = { VIEW: [], EDIT: [], MOVE: [REP_ROLE] };
    expect(repMayPlace(rep, pipeline(), stage({ roles: office }))).toBe(false);
    expect(repMayPlace(rep, pipeline(), stage({ roles: reps }))).toBe(true);
    expect(repMayPlace(rep, pipeline({ visibility: 'PRIVATE' }), stage())).toBe(false);
    const seen = pipeline({
      visibility: 'PRIVATE',
      roles: { VIEW: [REP_ROLE], MANAGE: [], ALL_ORDERS: [] },
    });
    expect(repMayPlace(rep, seen, stage())).toBe(true);
  });

  it('lets a manager holding the permission try the app on any such stage', () => {
    const manager = ctx(['sales.orders.rep', 'sales.boards.manage'], [OFFICE_ROLE]);
    expect(
      repMayPlace(
        manager,
        pipeline({ visibility: 'PRIVATE' }),
        stage({ roles: { VIEW: [], EDIT: [], MOVE: [OFFICE_ROLE + 1] } }),
      ),
    ).toBe(true);
    expect(repMayPlace(manager, pipeline(), stage({ action: 'PICK' }))).toBe(false);
  });
});
