import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FilterTree, type FilterTreeRow } from '@/components/filter-tree';
import type { Category } from './api';
import { categoryCode, compareCategories } from './category-code';

/** Parents before children in the list's order, each counting what is below it. */
function rowsOf(categories: readonly Category[]): FilterTreeRow[] {
  const byParent = new Map<number | null, Category[]>();
  for (const category of categories) {
    byParent.set(category.parentId, [...(byParent.get(category.parentId) ?? []), category]);
  }
  const rows: FilterTreeRow[] = [];
  const walk = (parentId: number | null): number => {
    let total = 0;
    for (const category of [...(byParent.get(parentId) ?? [])].sort(compareCategories)) {
      const { code, title } = categoryCode(category);
      const row: FilterTreeRow = {
        id: category.id,
        parentId,
        title,
        name: category.name,
        code,
        count: category.productCount,
      };
      rows.push(row);
      row.count += walk(category.id);
      total += row.count;
    }
    return total;
  };
  walk(null);
  return rows;
}

/** The product categories in a side panel, each with its code and how many products it holds. */
export function CategoryFilterTree(props: {
  categories: readonly Category[];
  selected: number | undefined;
  onPick: (id: number | undefined) => void;
  /** Labels the box that finds a category; without it, no box. */
  searchLabel?: string;
  noMatchLabel?: string;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => rowsOf(props.categories), [props.categories]);
  return (
    <FilterTree
      rows={rows}
      selected={props.selected}
      onPick={props.onPick}
      allLabel={t('catalog.products.panel.all')}
      {...(props.searchLabel ? { searchLabel: props.searchLabel } : {})}
      {...(props.noMatchLabel ? { noMatchLabel: props.noMatchLabel } : {})}
    />
  );
}
