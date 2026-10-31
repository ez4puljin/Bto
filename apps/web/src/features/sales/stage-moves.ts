import type { SalesStage } from './pipelines-api';

/**
 * ADR-0129: a card moves one stage at a time, among the pipeline's live stages in their order; a
 * CANCEL stage takes it from anywhere; the holder of sales.orders.moveAny moves it anywhere. The
 * target must still let the role move cards into it.
 */
export function canMoveTo(
  live: readonly SalesStage[],
  from: SalesStage,
  to: SalesStage,
  moveAny: boolean,
): boolean {
  if (to.id === from.id || !to.canMove) return false;
  if (moveAny || to.action === 'CANCEL') return true;
  const a = live.findIndex((stage) => stage.id === from.id);
  const b = live.findIndex((stage) => stage.id === to.id);
  return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
}
