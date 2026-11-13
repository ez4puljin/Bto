import type { Permission } from '../auth';
import { addDays } from '../time';

/**
 * Saved report views (ADR-0194): a report page's prompt and conditions, as its address carries
 * them, kept under a name. The pages that can keep views, each with the right its page needs.
 */
export const REPORT_VIEW_PAGES = {
  'party-ledger': 'finance.read',
  'money-ledger': 'finance.read',
  'stock-balance': 'reports.view',
  'product-sales': 'reports.view',
  'stock-documents': 'reports.view',
  aging: 'reports.view',
  profit: 'reports.margins.view',
  stock: 'reports.view',
  suppliers: 'reports.margins.view',
} as const satisfies Record<string, Permission>;

export type ReportViewPage = keyof typeof REPORT_VIEW_PAGES;
export const REPORT_VIEW_PAGE_KEYS = Object.keys(REPORT_VIEW_PAGES) as ReportViewPage[];

export function isReportViewPage(value: unknown): value is ReportViewPage {
  return typeof value === 'string' && Object.hasOwn(REPORT_VIEW_PAGES, value);
}

/** A period that moves with the calendar, so a view saved in October still says «this month». */
export const PERIOD_PRESETS = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return typeof value === 'string' && (PERIOD_PRESETS as readonly string[]).includes(value);
}

export const REPORT_VIEW_NAME_MAX_LENGTH = 80;
export const REPORT_VIEW_QUERY_MAX_LENGTH = 2000;
/** One user's views of one page. */
export const REPORT_VIEW_LIMIT = 30;

/** A preset's dates: from its first day to `today` (a past month to its last day). */
export function presetRange(preset: PeriodPreset, today: string): { from: string; to: string } {
  const [year = '1970', month = '01'] = today.split('-');
  const monthIndex = Number.parseInt(month, 10) - 1;
  if (preset === 'thisMonth') return { from: `${year}-${month}-01`, to: today };
  if (preset === 'thisYear') return { from: `${year}-01-01`, to: today };
  if (preset === 'thisQuarter') {
    const first = String(monthIndex - (monthIndex % 3) + 1).padStart(2, '0');
    return { from: `${year}-${first}-01`, to: today };
  }
  const lastDay = addDays(`${year}-${month}-01`, -1);
  return { from: `${lastDay.slice(0, 8)}01`, to: lastDay };
}

/** The preset whose dates today are exactly `from` – `to`, if any (what a save suggests). */
export function presetOf(from: string, to: string, today: string): PeriodPreset | null {
  for (const preset of PERIOD_PRESETS) {
    const range = presetRange(preset, today);
    if (range.from === from && range.to === to) return preset;
  }
  return null;
}

const PERIOD_KEYS: readonly string[] = ['from', 'to'];

/** An address's parameters as written (still encoded), in the order they stand. */
function pairsOf(search: string): [string, string][] {
  return search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part !== '')
    .map((part) => {
      const at = part.indexOf('=');
      return at < 0 ? [part, ''] : [part.slice(0, at), part.slice(at + 1)];
    });
}

/** Parameters by name (a repeated name keeps its order), joined again. */
function queryOf(pairs: [string, string][]): string {
  return [...pairs]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/** Printable ASCII only: an address's parameters are already encoded. */
export function isViewQuery(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= REPORT_VIEW_QUERY_MAX_LENGTH &&
    /^[\x21-\x7e]*$/.test(value)
  );
}

/**
 * What is kept of a page's address: its parameters in a stable order, without the dates when the
 * view follows a preset (they are worked out each time it is opened).
 */
export function storedViewQuery(search: string, period: PeriodPreset | null): string {
  const pairs = pairsOf(search);
  return queryOf(period ? pairs.filter(([key]) => !PERIOD_KEYS.includes(key)) : pairs);
}

/** The address parameters a view opens with on `today`. */
export function openViewQuery(
  view: { query: string; period: PeriodPreset | null },
  today: string,
): string {
  if (!view.period) return queryOf(pairsOf(view.query));
  const range = presetRange(view.period, today);
  return queryOf([
    ...pairsOf(view.query).filter(([key]) => !PERIOD_KEYS.includes(key)),
    ['from', range.from],
    ['to', range.to],
  ]);
}
