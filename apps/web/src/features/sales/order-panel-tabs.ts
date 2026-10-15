/** The sections of the order panel (ADR-0059), as the address names them (`?tab=`). */
export const PANEL_TABS = ['overview', 'properties', 'products', 'pick', 'activity'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

export function parsePanelTab(value: string | null | undefined): PanelTab {
  return PANEL_TABS.find((tab) => tab === value) ?? 'overview';
}
