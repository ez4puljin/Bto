import { describe, expect, it } from 'vitest';
import { effectiveStage, type PlaceableBoards, placeOf } from './placement';

const context: PlaceableBoards = {
  boards: [
    {
      id: 1,
      name: 'Мөрөн',
      pipelines: [
        {
          id: 10,
          name: 'Мөрөн Борлуулалт',
          stages: [
            { id: 100, name: 'ХТ Захиалга', action: 'NONE' },
            { id: 101, name: 'Нярав Хяналт', action: 'CONFIRM' },
          ],
        },
      ],
    },
  ],
  defaultStageId: 100,
};

describe('where a rep order lands (ADR-0061 #6)', () => {
  it('finds a stage with its board and pipeline', () => {
    expect(placeOf(context, 101)).toEqual({
      boardName: 'Мөрөн',
      pipelineName: 'Мөрөн Борлуулалт',
      stageId: 101,
      stageName: 'Нярав Хяналт',
      confirms: true,
    });
    expect(placeOf(context, 999)).toBeNull();
    expect(placeOf(context, null)).toBeNull();
  });

  it('keeps the chosen stage while allowed, else the default, else the only one', () => {
    expect(effectiveStage(context, 101)).toBe(101);
    expect(effectiveStage(context, 999)).toBe(100);
    expect(effectiveStage({ ...context, defaultStageId: null }, null)).toBeNull();
    const single: PlaceableBoards = {
      defaultStageId: null,
      boards: [
        {
          id: 1,
          name: 'Б',
          pipelines: [{ id: 2, name: 'П', stages: [{ id: 3, name: 'Ш', action: 'NONE' }] }],
        },
      ],
    };
    expect(effectiveStage(single, null)).toBe(3);
  });
});
