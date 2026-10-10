/**
 * Search keys for names that mix Cyrillic and Latin (ADR-0011 #4, ADR-0028). Every searchable row
 * stores two keys computed here, and queries are normalised by the same functions:
 *
 * - strict: NFKC, lower case, Latin look-alike letters folded to Cyrillic, ё → е. Keeps ө and ү
 *   distinct, so "ус" and "үс" stay different words.
 * - phonetic: a Latin romanisation with sound-alike folding, so "Coca-Cola" and "Кока кола" meet,
 *   and ө/ү typed as о/у on a Russian keyboard still match.
 *
 * A key is the word list with a leading space and single spaces between words, so " term" is a word
 * prefix. Bump SEARCH_KEYS_VERSION whenever a table below changes; stored keys are then recomputed.
 */
export const SEARCH_KEYS_VERSION = 1;

/** Latin letters that look like Cyrillic ones, after lower-casing (B/В, H/Н, M/М, T/Т included). */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  a: 'а',
  b: 'в',
  c: 'с',
  e: 'е',
  h: 'н',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  t: 'т',
  x: 'х',
  y: 'у',
  ё: 'е',
};

/** Mongolian Cyrillic romanised for the phonetic key; ө and ү fold into о and у. */
const ROMANISATION: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'io',
  ж: 'j',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sh',
  ъ: '',
  ы: 'i',
  ь: '',
  э: 'e',
  ю: 'iu',
  я: 'ia',
};

/** Latin spellings folded to the sound the romanisation above produces. */
const LATIN_DIGRAPHS: readonly (readonly [string, string])[] = [
  ['kh', 'h'],
  ['zh', 'j'],
  ['ph', 'f'],
  ['th', 't'],
  ['ck', 'k'],
  ['qu', 'kv'],
  ['ch', 'ch'],
  ['sh', 'sh'],
];
const LATIN_SINGLES: Readonly<Record<string, string>> = { q: 'k', w: 'v', x: 'ks', y: 'i' };

const LATIN = /\p{Script=Latin}/u;
const TOKEN = /[\p{L}\p{M}]+|\d+(?:\.\d+)*/gu;

/** Display form of a name: NFC, trimmed, single spaces. */
export function normalizeName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Lower-cased words and numbers of a text, with "0,5л" read as "0.5 л". */
export function tokenize(value: string): string[] {
  const text = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, '$1.')
    .replace(/(\d)(?=\p{L})/gu, '$1 ')
    .replace(/(\p{L})(?=\d)/gu, '$1 ');
  return text.match(TOKEN) ?? [];
}

function strictWord(word: string): string {
  let out = '';
  for (const char of word) out += LOOK_ALIKES[char] ?? char;
  return out;
}

function phoneticLatin(word: string): string {
  const letters = word.normalize('NFD').replace(/\p{M}/gu, '');
  let out = '';
  for (let i = 0; i < letters.length;) {
    const pair = letters.slice(i, i + 2);
    const digraph = LATIN_DIGRAPHS.find(([from]) => from === pair);
    if (digraph) {
      out += digraph[1];
      i += 2;
      continue;
    }
    const char = letters.charAt(i);
    if (char === 'c') out += /[eiy]/.test(letters.charAt(i + 1)) ? 's' : 'k';
    else out += LATIN_SINGLES[char] ?? char;
    i += 1;
  }
  return out;
}

function phoneticWord(word: string): string {
  let out = '';
  let latinRun = '';
  const flush = () => {
    out += phoneticLatin(latinRun);
    latinRun = '';
  };
  for (const char of word) {
    if (LATIN.test(char)) {
      latinRun += char;
      continue;
    }
    flush();
    out += ROMANISATION[char] ?? char;
  }
  flush();
  // Doubled letters carry no meaning in either script's spelling of the same word.
  return out.replace(/([a-z])\1+/g, '$1');
}

export interface SearchKeys {
  strict: string;
  phonetic: string;
  version: number;
}

function joinKey(words: readonly string[]): string {
  const kept = words.filter((word) => word.length > 0);
  return kept.length ? ` ${kept.join(' ')}` : '';
}

/** Both keys of a row: its name plus extra words such as the SKU. */
export function searchKeys(name: string, extra: readonly string[] = []): SearchKeys {
  const words = [name, ...extra].flatMap(tokenize);
  return {
    strict: joinKey(words.map(strictWord)),
    phonetic: joinKey(words.map(phoneticWord)),
    version: SEARCH_KEYS_VERSION,
  };
}

/** A unique key for names that must not repeat (categories, brands, units): the strict form. */
export function nameKey(name: string): string {
  return searchKeys(name).strict.trim();
}

/**
 * One query word in both forms. A form shorter than 3 characters matches as a word prefix
 * (" ус"), which pg_trgm can index; a longer one matches anywhere.
 */
export interface QueryTerm {
  strict: string;
  phonetic: string;
}

export function queryTerms(query: string): QueryTerm[] {
  return tokenize(query)
    .map((word) => ({ strict: strictWord(word), phonetic: phoneticWord(word) }))
    .filter((term) => term.strict.length > 0);
}

/** The pattern a term form must appear as inside a key (mirrors the SQL predicate). */
export function termPattern(form: string): string {
  return form.length < 3 ? ` ${form}` : form;
}

/** True when every term appears in either key; the reference for the SQL search. */
export function matchesQuery(
  keys: Pick<SearchKeys, 'strict' | 'phonetic'>,
  terms: readonly QueryTerm[],
) {
  return terms.every(
    (term) =>
      keys.strict.includes(termPattern(term.strict)) ||
      (term.phonetic.length > 0 && keys.phonetic.includes(termPattern(term.phonetic))),
  );
}

/** True when every term appears in the strict key; such rows rank first. */
export function matchesStrictly(keys: Pick<SearchKeys, 'strict'>, terms: readonly QueryTerm[]) {
  return terms.every((term) => keys.strict.includes(termPattern(term.strict)));
}
