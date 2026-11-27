import { type Block, parseMarkdown, plainText } from '@/features/guide/markdown';

/**
 * «Шинэ өөрчлөлт» (ADR-0251): what changed in Bto, in plain Mongolian, one file per change in
 * `./content/<YYYY-MM-DD>-<slug>.md` (a `# title` and a few lines). The shell shows a signed-in user
 * every entry this browser has not shown them yet, newest first; closing it marks them read.
 */
export interface NewsEntry {
  /** The file name without `.md`: its date and slug, the key that marks it read. */
  id: string;
  /** `YYYY-MM-DD`, the day it went live. */
  date: string;
  title: string;
  /** Everything after the title. */
  blocks: Block[];
}

/** A first visit (nothing kept in this browser) shows only this many of the newest. */
export const FIRST_VISIT_LIMIT = 5;

const FILES = import.meta.glob<string>('./content/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function entryOf(path: string, source: string): NewsEntry | null {
  const match = /\/((\d{4}-\d{2}-\d{2})-[a-z0-9-]+)\.md$/.exec(path);
  if (!match) return null;
  const blocks = parseMarkdown(source);
  const titleAt = blocks.findIndex((block) => block.kind === 'title');
  const title = blocks[titleAt];
  if (!title || title.kind !== 'title') return null;
  return {
    id: match[1] ?? '',
    date: match[2] ?? '',
    title: plainText(title.inline),
    blocks: blocks.filter((_, index) => index !== titleAt),
  };
}

/** Newest first; on one day, the later file name first. */
export const sortEntries = (entries: readonly NewsEntry[]): NewsEntry[] =>
  [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

export const NEWS: readonly NewsEntry[] = sortEntries(
  Object.entries(FILES).flatMap(([path, source]) => {
    const entry = entryOf(path, source);
    return entry ? [entry] : [];
  }),
);

/**
 * The entries to show: every one not yet read; on a first visit (`read` null) only the newest
 * {@link FIRST_VISIT_LIMIT}, so a new person is not handed the whole history.
 */
export function unreadOf(entries: readonly NewsEntry[], read: ReadonlySet<string> | null) {
  if (read === null) return entries.slice(0, FIRST_VISIT_LIMIT);
  return entries.filter((entry) => !read.has(entry.id));
}

const keyOf = (userId: number) => `bto.news.read.${userId}`;

/** The ids this user has read in this browser; null when nothing was ever kept. */
export function readIds(userId: number): Set<string> | null {
  try {
    const text = window.localStorage.getItem(keyOf(userId));
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [],
    );
  } catch {
    return null;
  }
}

/** Marks every entry there is as read; ids of entries no longer shipped are dropped. */
export function markAllRead(userId: number, entries: readonly NewsEntry[]): void {
  try {
    window.localStorage.setItem(keyOf(userId), JSON.stringify(entries.map((entry) => entry.id)));
  } catch {
    // A browser that keeps nothing shows the news again next time; nothing else is lost.
  }
}
