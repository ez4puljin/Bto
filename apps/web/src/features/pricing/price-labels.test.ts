import { beforeEach, describe, expect, it } from 'vitest';
import {
  LABEL_SHEET_SPECS,
  labelPages,
  labelsHref,
  parseLabelIds,
  parseLabelSheet,
  storedLabelIds,
} from './price-labels';

describe('price labels', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads the ids of an address once each and drops what is not an id', () => {
    expect(parseLabelIds('3,1,3,x,-2,0,7')).toEqual([3, 1, 7]);
    expect(parseLabelIds(null)).toEqual([]);
    expect(parseLabelSheet('A4_8')).toBe('A4_8');
    expect(parseLabelSheet('A5')).toBeNull();
  });

  it('carries a short list in the address and a long one through the storage', () => {
    expect(labelsHref([5, 6])).toBe('/pricing/labels/print?ids=5,6');
    const many = Array.from({ length: 400 }, (_, index) => index + 1);
    const href = labelsHref(many, 1_000);
    const name = new URL(href, 'http://bto.test').searchParams.get('set');
    expect(name).not.toBeNull();
    expect(storedLabelIds(name)).toEqual(many);
    // A hand-over older than a day is swept by the next one.
    labelsHref(many, 1_000 + 25 * 60 * 60 * 1000);
    expect(storedLabelIds(name)).toEqual([]);
  });

  it('cuts the labels into pages of the sheet', () => {
    const labels = Array.from({ length: 50 }, (_, index) => index);
    expect(labelPages(labels, LABEL_SHEET_SPECS.A4_24.perPage).map((page) => page.length)).toEqual([
      24, 24, 2,
    ]);
    expect(labelPages(labels, LABEL_SHEET_SPECS.ROLL_58.perPage)).toHaveLength(50);
    // A sheet of A4 holds its labels: 3 × 70 mm across, 8 × 37 mm down.
    const { width, height, columns, perPage } = LABEL_SHEET_SPECS.A4_24;
    expect(width * columns).toBeLessThanOrEqual(210);
    expect(height * (perPage / columns)).toBeLessThanOrEqual(297);
  });
});
