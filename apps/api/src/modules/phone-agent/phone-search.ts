import { matchesQuery, queryTerms, searchKeys, tokenize } from '@tugeel/shared/text';

// The phone's product search (ADR-0232 #6, the owner after the first real call, 2026-11-20: «барааны
// нэрийг хайж санал болгох ёстой»). The caller's words come through speech recognition: a generic
// word the names do not carry («Түмний ундаа»), a case ending («ундааны»), a mis-heard vowel
// («түмэн» for «түмний») or a Latin brand heard in Cyrillic («спрайт»). The catalog's own search
// keeps a product only when every word is in its keys; this one keeps those first («exact», the
// same keys and the same test, `matchesQuery`) and fills up with products that match some of the
// words, weighted so that a brand counts more than a generic word, a size or filler. Pure: the
// service feeds it the shop's names and categories and reads stock only for the rows it returns.

/** Words a caller adds that name no product: never searched for. */
const FILLER = new Set([
  'байна',
  'байгаа',
  'бна',
  'бий',
  'уу',
  'үү',
  'юу',
  'вэ',
  'бэ',
  'юм',
  'бол',
  'авъя',
  'авья',
  'авах',
  'авна',
  'авмаар',
  'хэрэгтэй',
  'өгөөч',
  'өгөөрэй',
  'надад',
  'танайд',
  'танай',
  'тэр',
  'энэ',
  'нөгөө',
  'маань',
  'нь',
  'нэг',
  'зарим',
  'ямар',
  'бараа',
  'барааны',
]);

/**
 * Words that name a kind of goods rather than a product: matched, but weak, so a brand decides.
 * Compared by stem («ундааны» is «ундаа»).
 */
const GENERIC = new Set([
  'ундаа',
  'ус',
  'жүүс',
  'шүүс',
  'сок',
  'шар',
  'айраг',
  'пиво',
  'гурил',
  'будаа',
  'тос',
  'сүү',
  'чихэр',
  'талх',
  'гоймон',
  'шоколад',
  'жигнэмэг',
  'печень',
  'цай',
  'кофе',
  'архи',
  'дарс',
  'давс',
  'элсэн',
  'савангийн',
  'саван',
  'шампунь',
  'шанпунь',
  'чипс',
  'хиам',
  'мах',
  'зайрмаг',
  'тараг',
  'ширхэг',
  'хайрцаг',
  'шил',
  'сав',
  'лааз',
  'уут',
  'боодол',
  'том',
  'жижиг',
]);

/** Sizes and units of measure: they narrow, but never find a product alone. */
const SIZE = new Set(['л', 'литр', 'литрийн', 'мл', 'кг', 'гр', 'г', 'грамм', 'граммын', 'см']);

/** Mongolian case and plural endings, longest first; a stem keeps at least three letters. */
const ENDINGS = [
  'нуудын',
  'нүүдийн',
  'уудын',
  'үүдийн',
  'ийнх',
  'ынх',
  'нуудыг',
  'нүүдийг',
  'нууд',
  'нүүд',
  'ууд',
  'үүд',
  'аас',
  'ээс',
  'оос',
  'өөс',
  'аар',
  'ээр',
  'оор',
  'өөр',
  'тай',
  'тэй',
  'той',
  'ийн',
  'ийг',
  'ний',
  'ны',
  'ын',
  'ыг',
  'ид',
  'д',
  'т',
  'г',
  'н',
];

const WEIGHT = { brand: 1, generic: 0.4, size: 0.25 } as const;
type TermKind = keyof typeof WEIGHT;

/** A word's score from 0 to 1 below which it is not a match at all. */
const WORD_FLOOR = 0.4;
/** A partial product's score (weighted share of the query's words) below which it is dropped. */
const PRODUCT_FLOOR = 0.45;
/** Credit for a word found only in the product's category («ундаа» in «Хийжүүлсэн ундаа»). */
const CATEGORY_CREDIT = 0.8;

export function stem(word: string): string {
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= 3 && word.endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

/** The consonants of a phonetic form: speech recognition mostly mishears the vowels. */
function skeleton(phonetic: string): string {
  return phonetic.replace(/[aeiouy]/g, '');
}

/** pg_trgm's trigrams of one word: two spaces before, one after. */
function trigrams(word: string): string[] {
  const padded = `  ${word} `;
  const out = new Set<string>();
  for (let index = 0; index + 3 <= padded.length; index += 1) {
    out.add(padded.slice(index, index + 3));
  }
  return [...out];
}

function commonPrefix(a: string, b: string): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

/** One word of a name or a query in every form the comparison uses. */
interface WordForms {
  strict: string;
  phonetic: string;
  stem: string;
  skeleton: string;
  grams: string[];
}

function formsOf(word: string): WordForms {
  const keys = searchKeys(word);
  const strict = keys.strict.trim();
  const phonetic = keys.phonetic.trim();
  return {
    strict,
    phonetic,
    stem: stem(strict),
    skeleton: skeleton(phonetic),
    grams: trigrams(phonetic),
  };
}

/** One stem starts the other word and is most of it: «ундаа» in «ундааны», «түм» in «түмэн». */
function close(shorter: string, longer: string): boolean {
  return shorter.length >= 3 && shorter.length >= 0.6 * longer.length && longer.startsWith(shorter);
}

/**
 * How well a query word names a word of a product, 0 to 1: the word starts with it (1) or holds
 * it (0.85, «кола» in «шоколад»), the same in the phonetic form (0.95 / 0.8), the same stem
 * («ундааны», «түмэн» against «түмний»: 0.9), then a mis-heard form: the same consonants (0.75,
 * «спрайт» and «sprite») or a long common start. Trigram similarity is added by the index.
 */
function wordScore(term: WordForms, word: WordForms): number {
  if (word.strict.startsWith(term.strict)) return 1;
  if (term.strict.length < 3) return 0; // «ус» is not «бус»: a short word only starts a word
  if (word.strict.includes(term.strict)) return 0.85;
  if (term.phonetic.length >= 3) {
    if (word.phonetic.startsWith(term.phonetic)) return 0.95;
    if (word.phonetic.includes(term.phonetic)) return 0.8;
  }
  if (close(term.stem, word.strict) || close(word.stem, term.strict)) return 0.9;
  let best = 0;
  if (term.skeleton.length >= 3 && term.skeleton === word.skeleton) best = 0.75;
  const prefix = commonPrefix(term.phonetic, word.phonetic);
  if (prefix >= 3) {
    best = Math.max(best, (prefix / Math.max(term.phonetic.length, word.phonetic.length)) * 0.8);
  }
  return best >= WORD_FLOOR ? best : 0;
}

/** A product as the phone searches it. */
export interface PhoneSearchEntry {
  id: number;
  name: string;
  sku: string;
  /** The names of its category and the categories above it. */
  categoryNames: readonly string[];
}

interface IndexedEntry {
  entry: PhoneSearchEntry;
  keys: { strict: string; phonetic: string };
  words: number[];
  categoryWords: number[];
}

/** The shop's products ready for many searches: every distinct word's forms computed once. */
export class PhoneSearchIndex {
  private readonly vocabulary: WordForms[] = [];
  private readonly entries: IndexedEntry[] = [];
  /** Trigram → the vocabulary's words that have it (pg_trgm's similarity without a scan). */
  private readonly postings = new Map<string, number[]>();
  private readonly ids = new Map<string, number>();

  constructor(entries: readonly PhoneSearchEntry[] = []) {
    this.add(entries);
  }

  /**
   * The index of many products, built a slice at a time with the event loop let go between
   * slices: about a second of work on 13k products that must not hold up other requests.
   */
  static async build(entries: readonly PhoneSearchEntry[], slice = 500): Promise<PhoneSearchIndex> {
    const index = new PhoneSearchIndex();
    for (let at = 0; at < entries.length; at += slice) {
      index.add(entries.slice(at, at + slice));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return index;
  }

  private add(entries: readonly PhoneSearchEntry[]): void {
    for (const entry of entries) {
      this.entries.push({
        entry,
        keys: searchKeys(entry.name, [entry.sku]),
        words: this.wordIds(entry.name),
        categoryWords: [...new Set(entry.categoryNames.flatMap((name) => this.wordIds(name)))],
      });
    }
  }

  private wordIds(text: string): number[] {
    return [...new Set(tokenize(text))].map((word) => {
      let id = this.ids.get(word);
      if (id === undefined) {
        id = this.vocabulary.length;
        this.ids.set(word, id);
        const forms = formsOf(word);
        this.vocabulary.push(forms);
        for (const gram of forms.grams) {
          const list = this.postings.get(gram);
          if (list) list.push(id);
          else this.postings.set(gram, [id]);
        }
      }
      return id;
    });
  }

  /** Every vocabulary word's score against one query word. */
  private scoresOf(word: string): Float32Array {
    const term = formsOf(word);
    const scores = new Float32Array(this.vocabulary.length);
    const vocabulary = this.vocabulary;
    for (let id = 0; id < vocabulary.length; id += 1) {
      const own = vocabulary[id];
      if (own) scores[id] = wordScore(term, own);
    }
    if (term.strict.length < 3) return scores;
    const shared = new Map<number, number>();
    for (const gram of term.grams) {
      for (const id of this.postings.get(gram) ?? []) shared.set(id, (shared.get(id) ?? 0) + 1);
    }
    for (const [id, count] of shared) {
      const own = this.vocabulary[id];
      if (!own) continue;
      const similarity = count / (term.grams.length + own.grams.length - count);
      if (similarity >= WORD_FLOOR && similarity > (scores[id] ?? 0)) scores[id] = similarity;
    }
    return scores;
  }

  get size(): number {
    return this.entries.length;
  }

  /**
   * The products the caller's words name, best first: every word in the name («exact», the
   * catalog's own test), then partial matches by the weighted share of words they match, a brand
   * word counting more than a generic word or a size. At most `cap` rows.
   */
  search(query: string, cap: number): PhoneSearchHit[] {
    const terms = queryWords(query);
    if (terms.length === 0) return [];
    const catalogTerms = queryTerms(terms.map((term) => term.word).join(' '));
    const scores = terms.map((term) => this.scoresOf(term.word));
    const total = terms.reduce((sum, term) => sum + WEIGHT[term.kind], 0);
    const hasBrand = terms.some((term) => term.kind === 'brand');
    const hits: PhoneSearchHit[] = [];
    for (const indexed of this.entries) {
      const exact = matchesQuery(indexed.keys, catalogTerms);
      let gained = 0;
      let brandHit = false;
      for (let index = 0; index < terms.length; index += 1) {
        const term = terms[index];
        const own = scores[index];
        if (!term || !own) continue;
        let best = 0;
        for (const word of indexed.words) best = Math.max(best, own[word] ?? 0);
        if (term.kind !== 'size' && best < CATEGORY_CREDIT) {
          for (const word of indexed.categoryWords) {
            if ((own[word] ?? 0) >= 0.9) best = CATEGORY_CREDIT;
          }
        }
        if (term.kind === 'brand' && best > 0) brandHit = true;
        gained += WEIGHT[term.kind] * best;
      }
      // An exact product ranks by the same share: a word that starts a name's word before one inside it.
      const score = gained / total;
      if (!exact && (score < PRODUCT_FLOOR || (hasBrand && !brandHit))) continue;
      hits.push({ id: indexed.entry.id, name: indexed.entry.name, exact, score });
    }
    hits.sort(
      (a, b) =>
        (b.exact ? 1 : 0) - (a.exact ? 1 : 0) ||
        b.score - a.score ||
        a.name.length - b.name.length ||
        a.id - b.id,
    );
    return hits.slice(0, cap);
  }
}

export interface PhoneSearchHit {
  id: number;
  name: string;
  exact: boolean;
  score: number;
}

/** The query's words that may name a product, each with its weight's kind; filler dropped. */
export function queryWords(query: string): { word: string; kind: TermKind }[] {
  return tokenize(query)
    .filter((word) => !FILLER.has(word))
    .map((word) => ({
      word,
      kind:
        /^\d/.test(word) || SIZE.has(word)
          ? 'size'
          : GENERIC.has(word) || GENERIC.has(stem(word))
            ? 'generic'
            : 'brand',
    }));
}

/**
 * A short hint when two or more rows share their first word: «Түмний: кола, жүрж — 2л» (the shared
 * last word after the dash). Null otherwise.
 */
export function familyHint(names: readonly string[]): string | null {
  const split = names.map((name) => name.trim().split(/\s+/));
  const groups = new Map<string, string[][]>();
  for (const words of split) {
    const head = (words[0] ?? '').toLocaleLowerCase('mn');
    if (words.length < 2 || !head) continue;
    groups.set(head, [...(groups.get(head) ?? []), words]);
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 2) return null;
  const brand = best[0]?.[0] ?? '';
  const lasts = new Set(best.map((words) => (words.length > 2 ? words[words.length - 1] : null)));
  const tail = lasts.size === 1 ? [...lasts][0] : null;
  const kinds = best.map(
    (words) => words.slice(1, tail ? -1 : undefined).join(' ') || (words[words.length - 1] ?? ''),
  );
  return `${brand}: ${[...new Set(kinds)].join(', ')}${tail ? ` — ${tail}` : ''}`;
}
