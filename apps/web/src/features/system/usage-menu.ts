import { NAV_GROUPS } from '@/app/nav-items';
import type { ScreenUsageRow } from './usage-api';

/** The menu entries under which no screen was opened: `/catalog/products` covers its `/:id` too. */
export function unusedNavItems(rows: readonly ScreenUsageRow[]) {
  const opened = rows.filter((row) => row.app === 'web' && row.opens > 0).map((row) => row.screen);
  const under = (path: string) =>
    opened.some((screen) => screen === path || screen.startsWith(`${path}/`));
  return NAV_GROUPS.flatMap((group) =>
    group.items
      .filter((item) => !item.devOnly && ![item.to, ...(item.also ?? [])].some(under))
      .map((item) => ({ group: group.label, item })),
  );
}
