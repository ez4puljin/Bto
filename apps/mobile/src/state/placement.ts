/** The boards, pipelines and stages a rep may place on, as GET /sales-rep/context gives them. */
export interface PlaceableBoards {
  boards: {
    id: number;
    name: string;
    pipelines: {
      id: number;
      name: string;
      stages: {
        id: number;
        name: string;
        action: 'NONE' | 'CONFIRM' | 'PICK' | 'SALE' | 'CANCEL';
      }[];
    }[];
  }[];
  defaultStageId: number | null;
}

export interface Place {
  boardName: string;
  pipelineName: string;
  stageId: number;
  stageName: string;
  /** CONFIRM: the order is confirmed and reserved at once; NONE: a draft. */
  confirms: boolean;
}

/** Where a stage sits; null when the rep may no longer place on it (moved, archived, rights). */
export function placeOf(context: PlaceableBoards, stageId: number | null): Place | null {
  if (stageId === null) return null;
  for (const board of context.boards) {
    for (const pipeline of board.pipelines) {
      const stage = pipeline.stages.find((entry) => entry.id === stageId);
      if (stage) {
        return {
          boardName: board.name,
          pipelineName: pipeline.name,
          stageId: stage.id,
          stageName: stage.name,
          confirms: stage.action === 'CONFIRM',
        };
      }
    }
  }
  return null;
}

/**
 * The stage to use: the one chosen while the rep may still place on it, else the channel default,
 * else the only stage there is; null when the rep has to choose.
 */
export function effectiveStage(context: PlaceableBoards, chosen: number | null): number | null {
  if (placeOf(context, chosen)) return chosen;
  if (placeOf(context, context.defaultStageId)) return context.defaultStageId;
  const all = context.boards.flatMap((board) =>
    board.pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id)),
  );
  return all.length === 1 ? (all[0] ?? null) : null;
}
