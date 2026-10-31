/** The sections of the order panel (ADR-0059), as the address names them (`?tab=`). */
export const PANEL_TABS = ['overview', 'properties', 'products', 'activity'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export function parsePanelTab(value: string | null | undefined): PanelTab {
  // The picking lives in the products tab since the owner's one-tab request (2026-10-31).
  if (value === 'pick') return 'products';
  return PANEL_TABS.find((tab) => tab === value) ?? 'overview';
}
