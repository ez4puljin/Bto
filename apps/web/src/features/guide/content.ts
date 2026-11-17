import { type Block, parseMarkdown, plainText } from './markdown';

/** The categories in the order they are shown; each has a name `guide.categories.<key>`. */
export const GUIDE_CATEGORIES = [
  'start',
  'sales',
  'inventory',
  'procurement',
  'catalog',
  'pricing',
  'partners',
  'finance',
  'reports',
  'pos',
  'hr',
  'apps',
  'ai',
  'system',
  'setup',
] as const;
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];

export interface Article {
  /** The folder the file sits in. */
  category: string;
  /** The file name without its `NN-` and `.md`: the article's address. */
  slug: string;
  order: number;
  title: string;
  summary: string;
  source: string;
  /** Everything after the title. */
  blocks: Block[];
  /** Lower case, for the search box. */
  searchText: string;
}

export const isGuideCategory = (value: string | undefined): value is GuideCategory =>
  GUIDE_CATEGORIES.some((category) => category === value);

const FILES = import.meta.glob<string>('./content/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export function articleOf(path: string, source: string): Article | null {
  const match = /\/content\/([^/]+)\/(\d+)-([^/]+)\.md$/.exec(path);
  if (!match) return null;
  const blocks = parseMarkdown(source);
  const titleAt = blocks.findIndex((block) => block.kind === 'title');
  const title = blocks[titleAt];
  const rest = blocks.filter((_, index) => index !== titleAt);
  const first = rest.find((block) => block.kind === 'paragraph');
  const titleText = title && title.kind === 'title' ? plainText(title.inline) : '';
  return {
    category: match[1] ?? '',
    slug: match[3] ?? '',
    order: Number(match[2]),
    title: titleText,
    summary: first && first.kind === 'paragraph' ? plainText(first.inline) : '',
    source,
    blocks: rest,
    searchText: `${titleText}\n${source}`.toLowerCase(),
  };
}

const categoryRank = (category: string) => {
  const rank = GUIDE_CATEGORIES.findIndex((known) => known === category);
  return rank < 0 ? GUIDE_CATEGORIES.length : rank;
};

export const ARTICLES: readonly Article[] = Object.entries(FILES)
  .flatMap(([path, source]) => {
    const article = articleOf(path, source);
    return article ? [article] : [];
  })
  .sort(
    (a, b) =>
      categoryRank(a.category) - categoryRank(b.category) ||
      a.order - b.order ||
      a.slug.localeCompare(b.slug),
  );

export const findArticle = (category: string | undefined, slug: string | undefined) =>
  ARTICLES.find((article) => article.category === category && article.slug === slug);

export const articlePath = (article: Pick<Article, 'category' | 'slug'>) =>
  `/guide/${article.category}/${article.slug}`;
