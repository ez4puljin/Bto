/**
 * How a typed search matches a kept row's name and code without the server.
 *
 * STOPGAP (2026-11-20): the server's rule is `@tugeel/shared/text` (`searchKeys`, `queryTerms`,
 * `matchesQuery`: Cyrillic and Latin spellings, the phonetic key), but the staff app may not
 * import it (eslint.config.mjs `MOBILE_HERMES_PATTERNS`, ADR-0061: Unicode regexes). This one
 * lower-cases and needs every typed word inside the name or the code. When the ban is lifted for
 * `text`, this module becomes three lines over `@tugeel/shared/text` and nothing else changes.
 */

export interface RowKeys {
  /** The name and the code, lower-cased, words joined by one space. */
  text: string;
}

export type Terms = string[];

const fold = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

/** A row's keys: its name and its extra words (the sku, the customer's code). */
export function keysOf(name: string, extra: readonly string[] = []): RowKeys {
  return { text: ` ${fold([name, ...extra].join(' '))}` };
}

/** The typed words. */
export function termsOf(query: string): Terms {
  const text = fold(query);
  return text === '' ? [] : text.split(' ');
}

/** Every typed word appears in the row. */
export function matches(keys: RowKeys, terms: Terms): boolean {
  return terms.length > 0 && terms.every((term) => keys.text.includes(term));
}

/** Every typed word starts a word of the row: such rows come first. */
export function matchesStrictly(keys: RowKeys, terms: Terms): boolean {
  return terms.every((term) => keys.text.includes(` ${term}`));
}
