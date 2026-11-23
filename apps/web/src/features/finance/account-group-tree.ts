import type { SearchSelectOption } from '@/components/search-select';
import type { GlAccountGroup } from './api';

/** The chart's group tree for the account and group dialogs (ADR-0239). */

/** Each group's path from the root, the group last (a broken or looping chain stops). */
export function groupPaths(groups: readonly GlAccountGroup[]): Map<number, GlAccountGroup[]> {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const paths = new Map<number, GlAccountGroup[]>();
  for (const group of groups) {
    const path: GlAccountGroup[] = [];
    for (
      let at: GlAccountGroup | undefined = group;
      at && !path.includes(at);
      at = at.parentId === null ? undefined : byId.get(at.parentId)
    ) {
      path.unshift(at);
    }
    paths.set(group.id, path);
  }
  return paths;
}

/**
 * The active groups as choices showing their path («7011 · Зардал › Ерөнхий › Тог»), found by any
 * code or name on it, in the tree's order. `keep` stays listed even when inactive (the current one).
 */
export function groupOptions(
  groups: readonly GlAccountGroup[],
  keep: number | null = null,
  leaveOut: ReadonlySet<number> = new Set(),
): SearchSelectOption[] {
  const paths = groupPaths(groups);
  const order = (path: readonly GlAccountGroup[]) =>
    path.map((group) => String(group.sort).padStart(5, '0') + group.code).join('/');
  return groups
    .filter((group) => (group.status === 'ACTIVE' || group.id === keep) && !leaveOut.has(group.id))
    .map((group) => ({ group, path: paths.get(group.id) ?? [group] }))
    .sort((a, b) => order(a.path).localeCompare(order(b.path)))
    .map(({ group, path }) => ({
      value: String(group.id),
      label: `${group.code} · ${path.map((step) => step.name).join(' › ')}`,
      keys: path.map((step) => step.code),
    }));
}

/** The active group whose code is the longest beginning of an account's code, for a new account. */
export function groupOfCode(groups: readonly GlAccountGroup[], code: string): number | null {
  const typed = code.trim();
  let best: GlAccountGroup | null = null;
  for (const group of groups) {
    if (group.status !== 'ACTIVE' || !typed.startsWith(group.code)) continue;
    if (!best || group.code.length > best.code.length) best = group;
  }
  return best?.id ?? null;
}

/** A group and every group below it. */
export function subtree(groups: readonly GlAccountGroup[], id: number): Set<number> {
  const below = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const group of groups) {
      if (group.parentId !== null && below.has(group.parentId) && !below.has(group.id)) {
        below.add(group.id);
        grew = true;
      }
    }
  }
  return below;
}
