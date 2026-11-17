import { BookOpenText, SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { EmptyState, FilterBar, ListCard, SearchField } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import {
  ARTICLES,
  type Article,
  articlePath,
  findArticle,
  GUIDE_CATEGORIES,
  type GuideCategory,
  isGuideCategory,
} from './content';
import { MarkdownView } from './markdown-view';

function ArticleLink({ article }: { article: Article }) {
  return (
    <Link
      to={articlePath(article)}
      className="block px-4 py-3 hover:bg-fill focus-visible:bg-fill focus-visible:outline-none"
    >
      <span className="block text-sm font-medium text-link">{article.title}</span>
      {article.summary ? (
        <span className="mt-0.5 block text-sm text-muted-foreground">{article.summary}</span>
      ) : null}
    </Link>
  );
}

function CategoryCard({ category, articles }: { category: GuideCategory; articles: Article[] }) {
  const { t } = useTranslation();
  return (
    <ListCard>
      <h2 className="border-b px-4 py-3 text-base font-semibold">
        {t(`guide.categories.${category}`)}
      </h2>
      <ul className="divide-y">
        {articles.map((article) => (
          <li key={article.slug}>
            <ArticleLink article={article} />
          </li>
        ))}
      </ul>
    </ListCard>
  );
}

/** «Гарын авлага» (ADR-0214): the how-to articles by category, with a search box. */
export function GuidePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown = ARTICLES.filter((article) => !needle || article.searchText.includes(needle));
  const groups = GUIDE_CATEGORIES.map((category) => ({
    category,
    articles: shown.filter((article) => article.category === category),
  })).filter((group) => group.articles.length > 0);
  return (
    <div>
      <PageHeader title={t('guide.title')} description={t('guide.description')} />
      <div className="flex flex-col gap-4">
        <FilterBar>
          <SearchField
            aria-label={t('guide.search')}
            placeholder={t('guide.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </FilterBar>
        {groups.length === 0 ? (
          <ListCard>
            <EmptyState icon={SearchX} title={t('guide.empty')} />
          </ListCard>
        ) : (
          groups.map((group) => (
            <CategoryCard
              key={group.category}
              category={group.category}
              articles={group.articles}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** One article, with the others of its category under it; an unknown address says so. */
export function GuideArticlePage() {
  const { t } = useTranslation();
  const params = useParams();
  const article = findArticle(params.category, params.article);
  if (!article) {
    return (
      <div>
        <PageHeader title={t('guide.title')} />
        <ListCard>
          <EmptyState
            icon={BookOpenText}
            title={t('guide.notFound')}
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/guide">{t('guide.backToGuide')}</Link>
              </Button>
            }
          />
        </ListCard>
      </div>
    );
  }
  const others = ARTICLES.filter(
    (other) => other.category === article.category && other.slug !== article.slug,
  );
  return (
    <div>
      <PageHeader
        title={article.title}
        crumbs={[
          { label: t('guide.title'), to: '/guide' },
          {
            label: isGuideCategory(article.category)
              ? t(`guide.categories.${article.category}`)
              : article.category,
          },
        ]}
      />
      <div className="flex flex-col gap-6">
        <article className="min-w-0 rounded-xl bg-card p-5 shadow-card ring-1 ring-black/[0.06]">
          <MarkdownView blocks={article.blocks} />
        </article>
        {others.length > 0 ? (
          <ListCard>
            <h2 className="border-b px-4 py-3 text-base font-semibold">
              {t('guide.sameCategory')}
            </h2>
            <ul className="divide-y">
              {others.map((other) => (
                <li key={other.slug}>
                  <ArticleLink article={other} />
                </li>
              ))}
            </ul>
          </ListCard>
        ) : null}
      </div>
    </div>
  );
}
