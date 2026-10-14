import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** PageHeader's own margin adds to a flex column's gap: 36px under the title instead of 20px. */
const HEADER_IN_FLEX_GAP = /<div className="[^"]*\bflex-col\b[^"]*\bgap-\d+[^"]*">\s*<PageHeader\b/;

describe('page layout (docs/ui.md §4)', () => {
  it('never puts the PageHeader first in a flex column with a gap', () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => HEADER_IN_FLEX_GAP.test(text))
      .map(([file]) => file);
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
