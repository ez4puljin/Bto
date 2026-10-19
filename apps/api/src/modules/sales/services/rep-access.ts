import type { StageAction } from '@tugeel/shared/sales';
import type { AuthContext } from '../../identity';
import { MANAGE, type PipelineView, type StageView } from './sales-access.service';

/** The sales-rep app's permission (ADR-0061 #5): own orders only, through `/sales-rep/*`. */
export const REP = 'sales.orders.rep';

/** Where a rep's order may land: a draft (NONE) or a confirmed, reserved order (CONFIRM). */
export const REP_STAGE_ACTIONS: readonly StageAction[] = ['NONE', 'CONFIRM'];

const anyRole = (ctx: AuthContext, roleIds: readonly number[]) =>
  roleIds.some((id) => ctx.roleIds.includes(id));

/**
 * Whether a rep may place a new order on this stage (ADR-0061 #6): the pipeline live and PUBLIC or
 * visible to one of the rep's roles; the stage live, of that pipeline, NONE or CONFIRM, and its
 * MOVE right open (no roles chosen) or granted to one of the rep's roles. Admins limit reps per
 * stage with MOVE roles. A manager (`sales.boards.manage`) holding the permission may place on any
 * such stage, to try the app. This is not `Access.stageRights`, which reps do not pass: they hold
 * neither `sales.orders.read` nor `sales.orders.manage`.
 */
export function repMayPlace(ctx: AuthContext, pipeline: PipelineView, stage: StageView): boolean {
  if (!ctx.permissions.has(REP)) return false;
  if (pipeline.archivedAt !== null || stage.archivedAt !== null) return false;
  if (stage.pipelineId !== pipeline.id || !REP_STAGE_ACTIONS.includes(stage.action)) return false;
  if (ctx.permissions.has(MANAGE)) return true;
  const visible =
    pipeline.visibility === 'PUBLIC' ||
    anyRole(ctx, [...pipeline.roles.VIEW, ...pipeline.roles.MANAGE, ...pipeline.roles.ALL_ORDERS]);
  return visible && (stage.roles.MOVE.length === 0 || anyRole(ctx, stage.roles.MOVE));
}
