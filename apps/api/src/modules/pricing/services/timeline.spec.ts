import { planChange } from './timeline';

const row = (id: number, validFrom: string, validTo: string | null, value = id) => ({
  id,
  validFrom,
  validTo,
  value,
});
const same = (value: number) => (candidate: { value: number }) => candidate.value === value;

describe('planChange', () => {
  it('starts the first row, open-ended', () => {
    expect(planChange([], '2026-10-14', same(1))).toEqual({ close: null, validTo: null });
  });

  it('closes the row in force on the day and runs to its old end', () => {
    const open = row(1, '2026-10-01', null);
    expect(planChange([open], '2026-10-14', same(2))).toEqual({ close: open, validTo: null });
    const bounded = row(1, '2026-10-01', '2026-10-20');
    expect(planChange([bounded, row(2, '2026-10-20', null)], '2026-10-14', same(3))).toEqual({
      close: bounded,
      validTo: '2026-10-20',
    });
  });

  it('slots a change in before a planned row', () => {
    const planned = row(1, '2026-10-20', null);
    expect(planChange([planned], '2026-10-14', same(2))).toEqual({
      close: null,
      validTo: '2026-10-20',
    });
  });

  it('voids a row replaced on its first day', () => {
    const today = row(1, '2026-10-14', null);
    expect(planChange([today], '2026-10-14', same(2))).toEqual({ close: today, validTo: null });
  });

  it('changes nothing when the row in force says the same', () => {
    expect(planChange([row(1, '2026-10-01', null, 7)], '2026-10-14', same(7))).toBeNull();
  });

  it('ignores rows that never applied', () => {
    const voided = row(1, '2026-10-14', '2026-10-14', 7);
    const open = row(2, '2026-10-14', null, 8);
    expect(planChange([voided, open], '2026-10-14', same(7))).toEqual({
      close: open,
      validTo: null,
    });
  });
});
