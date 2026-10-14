import { ascendingUnique, difference, intersect, union } from './set-algebra';

describe('set algebra on ascending ids (ADR-0049 #3)', () => {
  it('intersects, unites and subtracts', () => {
    expect(intersect([1, 3, 5, 7], [2, 3, 7, 9])).toEqual([3, 7]);
    expect(union([1, 3, 5], [2, 3, 9])).toEqual([1, 2, 3, 5, 9]);
    expect(difference([1, 2, 3, 4, 5], [2, 4, 6])).toEqual([1, 3, 5]);
  });

  it('handles empty lists', () => {
    expect(intersect([], [1])).toEqual([]);
    expect(union([], [1, 2])).toEqual([1, 2]);
    expect(union([1], [])).toEqual([1]);
    expect(difference([1, 2], [])).toEqual([1, 2]);
    expect(difference([], [1])).toEqual([]);
  });

  it('normalises an answer to ascending ids without repeats', () => {
    expect(ascendingUnique([5, 1, 3, 1, 5])).toEqual([1, 3, 5]);
  });

  it('agrees with plain set operations on random lists', () => {
    const random = () =>
      ascendingUnique(Array.from({ length: 40 }, () => Math.floor(Math.random() * 60) + 1));
    for (let round = 0; round < 50; round += 1) {
      const a = random();
      const b = random();
      const sb = new Set(b);
      expect(intersect(a, b)).toEqual(a.filter((id) => sb.has(id)));
      expect(union(a, b)).toEqual(ascendingUnique([...a, ...b]));
      expect(difference(a, b)).toEqual(a.filter((id) => !sb.has(id)));
    }
  });
});
