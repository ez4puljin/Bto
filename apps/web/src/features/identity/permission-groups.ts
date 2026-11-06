import { type Permission, permissionGroup, type PermissionGroup } from '@tugeel/shared/auth';

/** The permissions in the given order, one list per module (ADR-0163 #6). */
export function groupPermissions<T extends Permission>(
  codes: readonly T[],
): { group: PermissionGroup; codes: T[] }[] {
  const groups = new Map<PermissionGroup, T[]>();
  for (const code of codes) {
    const group = permissionGroup(code);
    groups.set(group, [...(groups.get(group) ?? []), code]);
  }
  return [...groups].map(([group, list]) => ({ group, codes: list }));
}
