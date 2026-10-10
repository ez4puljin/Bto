import type { Category } from './api';

export interface CategoryNode {
  category: Category;
  depth: number;
  /** Names from the root, e.g. "Хүнс / Гурил". */
  path: string;
}

const PATH_SEPARATOR = ' / ';

/** Categories depth-first, siblings by name, each with its depth and full path. */
export function categoryTree(categories: readonly Category[]): CategoryNode[] {
  const children = new Map<number | null, Category[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name, 'mn'));
  }
  const nodes: CategoryNode[] = [];
  const visit = (parentId: number | null, depth: number, prefix: string) => {
    for (const category of children.get(parentId) ?? []) {
      const path = prefix ? `${prefix}${PATH_SEPARATOR}${category.name}` : category.name;
      nodes.push({ category, depth, path });
      visit(category.id, depth + 1, path);
    }
  };
  visit(null, 0, '');
  return nodes;
}

/** Category id → full path, for list cells. */
export function categoryPaths(categories: readonly Category[]): Map<number, string> {
  return new Map(categoryTree(categories).map((node) => [node.category.id, node.path]));
}

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
