import { type CategoryNode as SharedCategoryNode } from '@tugeel/shared/catalog';
import type { Category } from './api';

/** The tree and its paths are shared with the api's export (`@tugeel/shared/catalog`). */
export { categoryPaths, categoryTree } from '@tugeel/shared/catalog';
export type CategoryNode = SharedCategoryNode<Category>;

/** A category and everything below it: a category cannot move under any of these. */
export function subtreeIds(categories: readonly Category[], rootId: number): Set<number> {
  const ids = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      if (category.parentId !== null && ids.has(category.parentId) && !ids.has(category.id)) {
        ids.add(category.id);
        grew = true;
      }
    }
  }
  return ids;
}
