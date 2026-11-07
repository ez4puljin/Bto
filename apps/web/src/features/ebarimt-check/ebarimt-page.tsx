import type { ProblemDetails } from '@tugeel/api-client';
import {
  EBARIMT_LIMITS,
  isPeriod,
  nextPeriod,
  periodMonth,
  periodOf,
  periodYear,
  previousPeriod,
} from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileWarning,
  History,
  Hourglass,
  Link2,
  Pencil,
  Phone,
  RefreshCw,
  Settings,
  TriangleAlert,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavigationType, useNavigationType, useSearchParams } from 'react-router';
import { useAuthState, useHasPermission } from '@/app/auth-context';
import { MonthInput } from '@/components/date-input';
import {
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  SearchField,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { SelectionBar } from '@/components/selection-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';
import {
  type EbarimtRow,
  type EbarimtUnregistered,
  useEbarimtFiles,
  useEbarimtMutations,
  useEbarimtRefresh,
  useEbarimtReport,
  useEbarimtVersion,
} from './api';
import { EntriesDialog, HistoryDialog, ReceiptsDialog } from './detail-dialogs';
import {
  amountText,
  diffStateOf,
  FOCUS_RING,
  hasAmount,
  isPositiveAmount,
  shortName,
  usePeriodLabels,
} from './helpers';
import { AssignDialog, FilesDialog, SettingsDialog, UnregisteredDialog } from './manage-dialogs';
import { DiffValue, InlineAmount, InlineText } from './parts';

interface CellRefusal {
  key: string;
  label: string;
  problem: ProblemDetails | null;
}

type Mode = 'month' | 'range';
const MODES: readonly Mode[] = ['month', 'range'];

/**
 * Eleven columns: the cells sit closer than the kit's, billions fit the money columns, and the whole
 * stays under 1273px at the 17px root, 1366 wide with a page scrollbar. Past that the kit drops to the
 * browser's own layout.
 */
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'check', kind: 'check', width: 3.75 },
  { key: 'employee', kind: 'text', weight: 1.2, min: 8 },
  { key: 'code', kind: 'code', width: 4 },
  { key: 'supplier', kind: 'text', weight: 2.4, min: 10.5 },
  { key: 'registers', kind: 'text', weight: 1, min: 5 },
  { key: 'phone', kind: 'text', weight: 0.8, min: 6.25 },
  { key: 'purchase', kind: 'money', width: 8 },
  { key: 'ebarimt', kind: 'money', width: 8 },
  { key: 'exempt', kind: 'money', width: 7 },
  { key: 'diff', kind: 'money', width: 8 },
  { key: 'note', kind: 'text', weight: 1.4, min: 6 },
];
const COMPACT_CELLS = '[&_td]:px-2 [&_th]:px-2';

/** A consolidated row ticks nothing and lists who held it: the room goes to the names. */
const RANGE_COLUMNS: readonly ColumnSpec[] = COLUMNS.map((column) => {
  if (column.key === 'check') return { key: 'check', kind: 'check', width: 3 };
  if (column.key === 'employee') return { ...column, min: 9.5 };
  if (column.key === 'supplier') return { ...column, min: 10 };
  if (column.key === 'note') return { ...column, min: 6 };
  return column;
});

const TICKS_KEY = 'tugeel.ebarimt.ticks.v1';

/** A month's ticks in this tab's storage, per user (docs/ui.md «Ticking rows»); screen state only. */
function readTicks(key: string, period: number): ReadonlySet<number> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
      period?: unknown;
      ids?: unknown;
    } | null;
    if (saved?.period === period && Array.isArray(saved.ids)) {
      return new Set(saved.ids.filter((id): id is number => Number.isInteger(id)));
    }
  } catch {
    // Storage or its text unusable: the ticks last while the page is open.
  }
  return new Set();
}

function writeTicks(key: string, period: number, ids: ReadonlySet<number>) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ period, ids: [...ids] }));
  } catch {
    // As above.
  }
}

/** Months chosen one after another make one read. */
const RANGE_SETTLE_MS = 250;

const COLUMN_FILTERS = [
  'employee',
  'code',
  'supplier',
  'registers',
  'phone',
  'note',
  'purchase',
  'ebarimt',
  'exempt',
  'diff',
] as const;
type ColumnFilter = (typeof COLUMN_FILTERS)[number];
type ColumnFilters = Record<ColumnFilter, string>;

const columnParam = (key: ColumnFilter) => `c_${key}`;

/** Nothing narrowing the list: what a new month starts from. */
const NO_LIST_FILTERS: Readonly<Record<string, null>> = Object.fromEntries([
  ['q', null],
  ['receipts', null],
  ...COLUMN_FILTERS.map((key) => [columnParam(key), null]),
]) as Record<string, null>;

const EMPTY_COLUMN_FILTERS = Object.fromEntries(
  COLUMN_FILTERS.map((key) => [key, '']),
) as ColumnFilters;

const columnFiltersOf = (params: URLSearchParams) =>
  Object.fromEntries(
    COLUMN_FILTERS.map((key) => [key, params.get(columnParam(key)) ?? '']),
  ) as ColumnFilters;

const textOk = (value: string, filter: string) =>
  !filter || value.toLowerCase().includes(filter.toLowerCase());

/** Names and notes are found the way the rest of Bto finds them, codes as typed. */
const wordsOk = (keys: ReturnType<typeof searchKeys>, filter: string) =>
  !filter.trim() || matchesQuery(keys, queryTerms(filter));

const amountOk = (value: string, filter: string) =>
  !filter || (filter === 'positive' ? isPositiveAmount(value) : !hasAmount(value));

const diffOk = (value: string, filter: string) => !filter || diffStateOf(value) === filter;

/** A month's quarters, for the presets. */
const quarter = (year: number, months: readonly number[]) =>
  months.map((month) => periodOf(year, month));

/** The chosen months in the address; `none` keeps «nothing chosen» apart from «the default». */
function readMonths(value: string | null): number[] | null {
  if (value === null) return null;
  if (value === 'none') return [];
  return value
    .split(',')
    .map((part) => Number.parseInt(part, 10))
    .filter(isPeriod);
}

/**
 * «Ebarimt» (ADR-0168): the month's purchases from the system's own receipts against e-Barimt's file,
 * one row per supplier. Read as a whole and filtered here, as the old list did; every cell saves on
 * its own. The month and the filters live in the address, so a receipt opened from here comes back
 * to the same list.
 */
export function EbarimtPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canEdit = useHasPermission('ebarimt.check.edit');
  const canAssign = useHasPermission('ebarimt.check.assign');
  const auth = useAuthState();
  const ticksKey = `${TICKS_KEY}:${auth.status === 'authenticated' ? auth.me.id : 0}`;
  const navigation = useNavigationType();

  const update = useCallback(
    (changes: Readonly<Record<string, string | null>>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const today = businessDate();
  const thisPeriod = periodOf(
    Number.parseInt(today.slice(0, 4), 10),
    Number.parseInt(today.slice(5, 7), 10),
  );
  const asked = Number.parseInt(params.get('period') ?? '', 10);
  const hasPeriod = isPeriod(asked);
  const mode: Mode = params.get('mode') === 'range' ? 'range' : 'month';
  const monthMode = mode === 'month';
  const period = hasPeriod ? asked : thisPeriod;
  const year = periodYear(period);
  const overview = useEbarimtFiles(year);
  const refresh = useEbarimtRefresh();
  const labels = usePeriodLabels(year);

  // What is typed lives here and is written to the address as it changes, like the other lists.
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(() => columnFiltersOf(params));
  const setColumn = (key: ColumnFilter) => (value: string) => {
    setColumnFilters((current) => ({ ...current, [key]: value }));
    update({ [columnParam(key)]: value });
  };
  const clearListFilters = () => {
    setSearch('');
    setColumnFilters(EMPTY_COLUMN_FILTERS);
  };

  /** Another month starts with the employee kept and what was typed cleared, as the old list did. */
  const setPeriod = (next: number) => {
    if (!isPeriod(next)) return;
    clearListFilters();
    update({
      period: String(next),
      ...NO_LIST_FILTERS,
      ...(periodYear(next) === year ? {} : { months: null }),
    });
  };
  const setMode = (next: Mode) => {
    if (next === mode) return;
    clearListFilters();
    update({ period: String(period), mode: next === 'range' ? 'range' : null, ...NO_LIST_FILTERS });
  };

  // The menu's own link carries no filters, and Back brings earlier ones: the boxes follow.
  useEffect(() => {
    if (hasPeriod && navigation !== NavigationType.Pop) return;
    setSearch(params.get('q') ?? '');
    setColumnFilters(columnFiltersOf(params));
  }, [hasPeriod, navigation, params]);

  // Opened without a month: the latest holding a file, else this one.
  const loaded = overview.isSuccess || overview.isError;
  const latest = overview.data?.latestPeriod ?? null;
  useEffect(() => {
    if (hasPeriod || !loaded) return;
    update({ period: String(latest ?? thisPeriod) });
  }, [hasPeriod, loaded, latest, thisPeriod, update]);

  // A consolidated view: the months with a file by default, last December among those offered.
  const yearMonths = useMemo(() => overview.data?.months ?? [], [overview.data]);
  const withFile = useMemo(
    () => yearMonths.filter((month) => month.file).map((month) => month.period),
    [yearMonths],
  );
  const lastDecember = periodOf(year - 1, 12);
  const monthsParam = params.get('months');
  const chosenRange = useMemo(
    () =>
      readMonths(monthsParam)?.filter(
        (value) => periodYear(value) === year || value === lastDecember,
      ) ?? withFile,
    [monthsParam, withFile, year, lastDecember],
  );
  // Chips clicked faster than the address settles still add up.
  const rangeNow = useRef<readonly number[]>(chosenRange);
  useEffect(() => {
    rangeNow.current = chosenRange;
  }, [chosenRange]);
  const setRangePeriods = (next: readonly number[]) => {
    rangeNow.current = next;
    update({ months: next.length === 0 ? 'none' : next.join(',') });
  };
  const rangeKey = chosenRange.join(',');
  const settledKey = useDebounced(rangeKey, RANGE_SETTLE_MS);
  const periods = useMemo(() => {
    if (!hasPeriod) return [];
    if (monthMode) return [period];
    return settledKey === '' ? [] : settledKey.split(',').map((part) => Number.parseInt(part, 10));
  }, [hasPeriod, monthMode, period, settledKey]);
  const report = useEbarimtReport(periods, year);
  // The stale check: the stamp the rows were read under against the poll's, once the poll is the
  // newer of the two (ADR-0118 #3). Rows being read, or standing in for others, say nothing.
  const version = useEbarimtVersion(periods);
  const othersChanged =
    report.data !== undefined &&
    version.data !== undefined &&
    !report.isFetching &&
    !report.isPlaceholderData &&
    version.dataUpdatedAt >= report.dataUpdatedAt &&
    report.data.stamp !== version.data.stamp;
  const mutations = useEbarimtMutations();
  // A cell open for typing keeps its row on the list, whatever the row's figures do meanwhile.
  const [holding, setHolding] = useState<number | null>(null);
  // Each cell's refused save stays until that cell saves, it is dismissed, or the month changes.
  const [refusals, setRefusals] = useState<readonly CellRefusal[]>([]);

  const employee = params.get('emp') ?? 'all';
  const setEmployee = (next: string) => update({ emp: next === 'all' ? null : next });
  const onlyMissing = params.get('missing') === '1';

  // Dialogs
  const [filesOpen, setFilesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unregisteredOpen, setUnregisteredOpen] = useState(false);
  const [entriesOf, setEntriesOf] = useState<number | null>(null);
  const [historyOf, setHistoryOf] = useState<number | null>(null);
  const [ttdOf, setTtdOf] = useState<EbarimtUnregistered | null>(null);
  const [assigning, setAssigning] = useState<{ ids: readonly number[]; bulk: boolean } | null>(
    null,
  );

  // Ticked rows, shift-click for a run from the row ticked last; a month's ticks are its own.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() =>
    hasPeriod ? readTicks(ticksKey, period) : new Set(),
  );
  const anchor = useRef<number | null>(null);
  const clearTicks = () => {
    setTicked(new Set());
    anchor.current = null;
  };
  // Opened without a month, the page's month is only known once the address settles.
  const viewed = useRef(hasPeriod ? `${period}:${mode}` : null);
  useEffect(() => {
    if (!hasPeriod || viewed.current === `${period}:${mode}`) return;
    viewed.current = `${period}:${mode}`;
    setTicked(readTicks(ticksKey, period));
    anchor.current = null;
    setEntriesOf(null);
    setHistoryOf(null);
    setHolding(null);
    setRefusals([]);
  }, [hasPeriod, period, mode, ticksKey]);
  useEffect(() => {
    if (hasPeriod) writeTicks(ticksKey, period, ticked);
  }, [hasPeriod, ticksKey, period, ticked]);

  const nothingAsked = monthMode ? !hasPeriod : chosenRange.length === 0;
  // Another year just chosen: the months it reads have not settled, and nothing of the last shows.
  const otherYear =
    !monthMode && periods.some((value) => periodYear(value) !== year && value !== lastDecember);
  const nothingToShow = nothingAsked || otherYear;
  const rows = useMemo(
    () => (nothingToShow ? [] : (report.data?.rows ?? [])),
    [nothingToShow, report.data],
  );
  const rowOf = useMemo(() => new Map(rows.map((row) => [row.supplierId, row])), [rows]);
  const multi = periods.length > 1;
  const canTick = canAssign && monthMode;

  const chips = useMemo(() => {
    const counts = new Map<number | null, { name: string | null; count: number }>();
    for (const row of rows) {
      for (const month of row.employeeMonths) {
        const entry = counts.get(month.userId) ?? { name: month.name, count: 0 };
        counts.set(month.userId, { name: month.name, count: entry.count + 1 });
      }
    }
    return [...counts.entries()]
      .map(([userId, entry]) => ({ userId, ...entry }))
      .sort((a, b) => {
        if (a.userId === null) return 1;
        if (b.userId === null) return -1;
        return b.count - a.count;
      });
  }, [rows]);

  const searchIndex = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const notes = row.byPeriod.map((month) => month.note ?? '').join(' ');
          const employees = row.employeeMonths.map((month) => month.name ?? '').join(' ');
          return [
            row.supplierId,
            {
              all: searchKeys(row.name, [row.code, row.registers, row.phone, row.remark, notes]),
              supplier: searchKeys(row.name, [row.remark]),
              employee: searchKeys(employees),
              note: searchKeys(notes),
            },
          ] as const;
        }),
      ),
    [rows],
  );
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const keys = searchIndex.get(row.supplierId);
        if (!keys) return false;
        if (row.supplierId === holding) return true;
        if (employee !== 'all') {
          const wanted = employee === 'none' ? null : Number.parseInt(employee, 10);
          if (!row.employeeMonths.some((month) => month.userId === wanted)) return false;
        }
        if (onlyMissing && diffStateOf(row.diffAmount) !== 'missing') return false;
        const cf = columnFilters;
        return (
          wordsOk(keys.all, search) &&
          wordsOk(keys.employee, cf.employee) &&
          textOk(row.code, cf.code) &&
          wordsOk(keys.supplier, cf.supplier) &&
          textOk(row.registers, cf.registers) &&
          textOk(row.phone, cf.phone) &&
          wordsOk(keys.note, cf.note) &&
          amountOk(row.purchaseAmount, cf.purchase) &&
          amountOk(row.ebarimtAmount, cf.ebarimt) &&
          amountOk(row.exemptAmount, cf.exempt) &&
          diffOk(row.diffAmount, cf.diff)
        );
      }),
    [rows, searchIndex, holding, employee, onlyMissing, search, columnFilters],
  );
  const hasColumnFilters = Object.values(columnFilters).some((value) => value !== '');
  const missingCount = rows.filter((row) => diffStateOf(row.diffAmount) === 'missing').length;
  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          purchase: sum.purchase.plus(row.purchaseAmount),
          ebarimt: sum.ebarimt.plus(row.ebarimtAmount),
          exempt: sum.exempt.plus(row.exemptAmount),
        }),
        { purchase: new Decimal(0), ebarimt: new Decimal(0), exempt: new Decimal(0) },
      ),
    [filtered],
  );

  const shownIds = useMemo(() => new Set(filtered.map((row) => row.supplierId)), [filtered]);
  // Nothing is hidden by a filter before the rows have come.
  const hiddenTicked = report.data ? [...ticked].filter((id) => !shownIds.has(id)).length : 0;
  const allTicked = filtered.length > 0 && filtered.every((row) => ticked.has(row.supplierId));
  const someTicked = filtered.some((row) => ticked.has(row.supplierId));
  const tick = (id: number, event: MouseEvent) => {
    const on = !ticked.has(id);
    const next = new Set(ticked);
    const index = filtered.findIndex((row) => row.supplierId === id);
    const from = filtered.findIndex((row) => row.supplierId === anchor.current);
    if (event.shiftKey && from >= 0) {
      const [low, high] = from < index ? [from, index] : [index, from];
      for (const row of filtered.slice(low, high + 1)) {
        if (on) next.add(row.supplierId);
        else next.delete(row.supplierId);
      }
    } else if (on) next.add(id);
    else next.delete(id);
    anchor.current = id;
    setTicked(next);
  };
  const tickAll = () => {
    const next = new Set(ticked);
    for (const row of filtered) {
      if (allTicked) next.delete(row.supplierId);
      else next.add(row.supplierId);
    }
    anchor.current = null;
    setTicked(next);
  };

  /** One cell's save: what it refuses is said by name and stays, as focus has moved on by then. */
  const saveCell = (
    key: string,
    label: string,
    write: () => Promise<unknown>,
    showValue?: (value: string) => string,
  ) =>
    void write().then(
      () => setRefusals((list) => list.filter((entry) => entry.key !== key)),
      (error: unknown) => {
        const told = problemFromError(error);
        const value = told?.params?.value;
        const problem =
          told && showValue && typeof value === 'string'
            ? { ...told, params: { ...told.params, value: showValue(value) } }
            : told;
        setRefusals((list) => [
          ...list.filter((entry) => entry.key !== key),
          { key, label, problem },
        ]);
        // A page already left has no list to show it in.
        toast.warning(t('ebarimtCheck.cells.refused', { label }));
      },
    );
  const saveExempt = (row: EbarimtRow, exemptAmount: string, shown: string) =>
    saveCell(
      `${period}:${row.supplierId}:exempt`,
      t('ebarimtCheck.cells.exemptName', { name: row.name }),
      () =>
        mutations.saveMonthValue.mutateAsync({
          period,
          supplierId: row.supplierId,
          exemptAmount,
          previousExemptAmount: shown,
        }),
      amountText,
    );
  const saveNote = (row: EbarimtRow, note: string, shown: string) =>
    saveCell(
      `${period}:${row.supplierId}:note`,
      t('ebarimtCheck.cells.noteName', { name: row.name }),
      () =>
        mutations.saveMonthValue.mutateAsync({
          period,
          supplierId: row.supplierId,
          note: note || null,
          previousNote: shown || null,
        }),
    );
  const saveProfile = (
    row: EbarimtRow,
    label: string,
    changes: {
      registers?: string | null;
      previousRegisters?: string;
      phone?: string | null;
      previousPhone?: string;
      remark?: string | null;
      previousRemark?: string;
    },
  ) =>
    saveCell(`${row.supplierId}:${label}`, label, () =>
      mutations.saveProfile.mutateAsync({ supplierId: row.supplierId, ...changes }),
    );
  const holdRow = (row: EbarimtRow) => (editing: boolean) =>
    setHolding((current) =>
      editing ? row.supplierId : current === row.supplierId ? null : current,
    );

  const togglePeriod = (value: number) =>
    setRangePeriods(
      rangeNow.current.includes(value)
        ? rangeNow.current.filter((other) => other !== value)
        : [...rangeNow.current, value].sort((a, b) => a - b),
    );
  const offered = yearMonths.map((month) => month.period);
  const allOfYear = offered.filter((value) => value !== lastDecember);
  const presets: { label: string; periods: number[] }[] = [
    {
      label: t('ebarimtCheck.presets.withDecember', { year: year - 1, next: year }),
      periods: offered,
    },
    { label: t('ebarimtCheck.presets.year'), periods: allOfYear },
    { label: t('ebarimtCheck.presets.q1'), periods: quarter(year, [1, 2, 3]) },
    { label: t('ebarimtCheck.presets.q2'), periods: quarter(year, [4, 5, 6]) },
    { label: t('ebarimtCheck.presets.q3'), periods: quarter(year, [7, 8, 9]) },
    { label: t('ebarimtCheck.presets.q4'), periods: quarter(year, [10, 11, 12]) },
  ];
  const filesDone = yearMonths.filter(
    (month) => month.file && month.period !== lastDecember,
  ).length;
  const noFile = nothingToShow ? [] : (report.data?.noFile ?? []);
  const unregistered = nothingToShow ? [] : (report.data?.unregistered ?? []);
  const links = nothingToShow ? [] : (report.data?.links ?? []);
  const accountCodes = nothingToShow ? [] : (report.data?.accountCodes ?? []);

  // The brief lives in the address: back from a receipt it stands open again, over its row.
  const receiptsRow = rowOf.get(Number.parseInt(params.get('receipts') ?? '', 10));
  const asksBrief = params.has('receipts');
  const comingBack = useRef(asksBrief);
  useEffect(() => {
    if (!comingBack.current || !receiptsRow) return;
    comingBack.current = false;
    document
      .querySelector(`[data-supplier="${receiptsRow.supplierId}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }, [receiptsRow]);
  const entriesRow = entriesOf === null ? undefined : rowOf.get(entriesOf);
  const historyRow = historyOf === null ? undefined : rowOf.get(historyOf);

  const waiting =
    !hasPeriod ||
    otherYear ||
    (!monthMode && overview.isPending) ||
    (!nothingAsked && report.isPending);
  const columns = monthMode ? COLUMNS : RANGE_COLUMNS;
  // Rows of the last choice while the next months settle: they read as such.
  const lagging = !monthMode && (report.isPlaceholderData || rangeKey !== settledKey);
  // A dialog whose row has left the list closes for good, rather than opening again later.
  const settled = !waiting && !lagging && report.isSuccess;
  useEffect(() => {
    if (!settled) return;
    if (entriesOf !== null && !entriesRow) setEntriesOf(null);
    if (historyOf !== null && !historyRow) setHistoryOf(null);
    if (asksBrief && !receiptsRow) update({ receipts: null });
  }, [settled, entriesOf, entriesRow, historyOf, historyRow, asksBrief, receiptsRow, update]);
  const previousLabel = monthMode
    ? t('ebarimtCheck.previousMonth')
    : t('ebarimtCheck.previousYear');
  const nextLabel = monthMode ? t('ebarimtCheck.nextMonth') : t('ebarimtCheck.nextYear');

  return (
    <div className="flex flex-col">
      <PageHeader
        dense
        title={t('ebarimtCheck.title')}
        meta={
          accountCodes.length > 0
            ? t('ebarimtCheck.accountsMeta', { codes: accountCodes.join(', ') })
            : undefined
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setFilesOpen(true)}>
              <FileSpreadsheet />
              {t('ebarimtCheck.actions.filesCount', { done: filesDone, total: 12 })}
            </Button>
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings />
              {t('ebarimtCheck.actions.settings')}
            </Button>
            <Button
              size="icon"
              variant="outline"
              aria-label={t('ebarimtCheck.actions.refresh')}
              title={t('ebarimtCheck.actions.refresh')}
              onClick={refresh}
            >
              <RefreshCw
                className={cn((report.isFetching || overview.isFetching) && 'animate-spin')}
              />
            </Button>
          </>
        }
      />

      <FilterBar
        end={
          <>
            {unregistered.length > 0 || links.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setUnregisteredOpen(true)}>
                <FileWarning className="text-warning" />
                {t('ebarimtCheck.filters.unregistered', { count: unregistered.length })}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={onlyMissing ? 'destructive' : 'outline'}
              aria-pressed={onlyMissing}
              onClick={() => update({ missing: onlyMissing ? null : '1' })}
            >
              <AlertCircle />
              {t('ebarimtCheck.filters.missing', { count: missingCount })}
            </Button>
            <SearchField
              className="sm:w-56"
              aria-label={t('ebarimtCheck.filters.search')}
              placeholder={t('ebarimtCheck.filters.search')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                update({ q: event.target.value });
              }}
            />
          </>
        }
      >
        <SegmentedControl
          name={t('ebarimtCheck.modeName')}
          options={MODES}
          value={mode}
          onChange={setMode}
          label={(value) => t(`ebarimtCheck.modes.${value}`)}
        />
        <div className="flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={previousLabel}
            title={previousLabel}
            onClick={() =>
              setPeriod(
                monthMode ? previousPeriod(period) : periodOf(year - 1, periodMonth(period)),
              )
            }
          >
            <ChevronLeft />
          </Button>
          {monthMode ? (
            <MonthInput
              variant="filter"
              label={t('ebarimtCheck.month')}
              required
              value={`${year}-${String(periodMonth(period)).padStart(2, '0')}`}
              onChange={(value) => {
                const [y, m] = value.split('-');
                if (y && m) setPeriod(periodOf(Number.parseInt(y, 10), Number.parseInt(m, 10)));
              }}
            />
          ) : (
            <span className="px-2 text-sm font-semibold">
              {t('ebarimtCheck.yearLabel', { year })}
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={nextLabel}
            title={nextLabel}
            onClick={() =>
              setPeriod(monthMode ? nextPeriod(period) : periodOf(year + 1, periodMonth(period)))
            }
          >
            <ChevronRight />
          </Button>
        </div>
        {othersChanged ? (
          <Button
            // Beside the no-file mark the row has room for its icon alone: a second row would
            // take the list's height.
            size={noFile.length > 0 ? 'icon-sm' : 'sm'}
            variant="outline"
            aria-label={`${t('ebarimtCheck.staleTitle')} ${t('ebarimtCheck.staleReload')}`}
            title={`${t('ebarimtCheck.staleTitle')} ${t('ebarimtCheck.staleReload')}`}
            onClick={refresh}
          >
            <TriangleAlert className="text-warning" />
            {noFile.length > 0 ? null : t('ebarimtCheck.staleReload')}
          </Button>
        ) : null}
        {noFile.length > 0 ? (
          <NoFileMark
            long={
              monthMode
                ? t('ebarimtCheck.noFileMonth', { month: labels.name(period) })
                : t('ebarimtCheck.noFileRange', { months: labels.many(noFile) })
            }
            short={
              monthMode
                ? t('ebarimtCheck.noFileShort')
                : t('ebarimtCheck.noFileShortRange', { count: noFile.length })
            }
            onUpload={canEdit ? () => setFilesOpen(true) : undefined}
          />
        ) : null}
      </FilterBar>

      {!monthMode ? (
        <div
          role="group"
          aria-label={t('ebarimtCheck.monthsTitle')}
          className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-card px-3 py-2 shadow-card ring-1 ring-black/[0.06]"
        >
          <span className="mr-1 text-[0.8125rem] font-medium">
            {t('ebarimtCheck.monthsTitle')}:
          </span>
          {yearMonths.map((month) => {
            const on = chosenRange.includes(month.period);
            return (
              <button
                key={month.period}
                type="button"
                aria-pressed={on}
                title={labels.name(month.period)}
                className={cn(
                  'relative h-7.5 min-w-9 rounded-full px-2 text-[0.8125rem] font-medium transition-colors',
                  FOCUS_RING,
                  on
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-fill text-foreground hover:bg-accent',
                )}
                onClick={() => togglePeriod(month.period)}
              >
                {periodYear(month.period) === year
                  ? periodMonth(month.period)
                  : labels.name(month.period)}
                {month.file ? null : (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning"
                  />
                )}
              </button>
            );
          })}
          <span aria-hidden className="mx-1 h-5 w-px bg-border" />
          {presets.map((preset) => (
            <Button
              key={preset.label}
              size="sm"
              variant="ghost"
              disabled={preset.periods.length === 0}
              onClick={() => setRangePeriods(preset.periods)}
            >
              {preset.label}
            </Button>
          ))}
          <span className="ml-auto hidden text-[0.8125rem] font-medium 2xl:inline">
            {labels.many(chosenRange)}
          </span>
        </div>
      ) : null}

      <FilterBar>
        <div
          role="group"
          aria-label={t('ebarimtCheck.filters.employees')}
          className="flex flex-wrap gap-1.5"
        >
          <EmployeeChip active={employee === 'all'} onClick={() => setEmployee('all')}>
            <Users aria-hidden className="size-3.5" />
            {t('ebarimtCheck.filters.all', { count: rows.length })}
          </EmployeeChip>
          {chips.map((chip) => {
            const key = chip.userId === null ? 'none' : String(chip.userId);
            return (
              <EmployeeChip key={key} active={employee === key} onClick={() => setEmployee(key)}>
                {chip.userId === null
                  ? t('ebarimtCheck.filters.noEmployee', { count: chip.count })
                  : t('ebarimtCheck.filters.employee', { name: chip.name, count: chip.count })}
              </EmployeeChip>
            );
          })}
        </div>
      </FilterBar>

      <ProblemAlert problem={problemFromError(overview.error)} onRetry={overview.refetch} />
      <ProblemAlert problem={problemFromError(report.error)} onRetry={report.refetch} />

      <ListCard scroll className={cn(lagging && 'opacity-60')}>
        <ListTable columns={columns} className={cn('text-[0.8125rem]', COMPACT_CELLS)}>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">
                {canTick ? (
                  <Checkbox
                    aria-label={t('ebarimtCheck.selectAll')}
                    checked={allTicked ? true : someTicked ? 'indeterminate' : false}
                    onCheckedChange={tickAll}
                  />
                ) : (
                  t('ebarimtCheck.columns.number')
                )}
              </TableHead>
              <TableHead>
                {monthMode
                  ? t('ebarimtCheck.columns.employee')
                  : t('ebarimtCheck.columns.employeeMonths')}
              </TableHead>
              <TableHead>{t('ebarimtCheck.columns.code')}</TableHead>
              <TableHead>{t('ebarimtCheck.columns.supplier')}</TableHead>
              <TableHead>{t('ebarimtCheck.columns.registers')}</TableHead>
              <TableHead>{t('ebarimtCheck.columns.phone')}</TableHead>
              <TableHead className="text-right">{t('ebarimtCheck.columns.purchase')}</TableHead>
              <TableHead className="text-right">{t('ebarimtCheck.columns.ebarimt')}</TableHead>
              <TableHead className="text-right" title={t('ebarimtCheck.columns.exemptFull')}>
                {t('ebarimtCheck.columns.exempt')}
              </TableHead>
              <TableHead className="text-right">{t('ebarimtCheck.columns.diff')}</TableHead>
              <TableHead>{t('ebarimtCheck.columns.note')}</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <FilterHead>
                {hasColumnFilters ? (
                  <button
                    type="button"
                    aria-label={t('ebarimtCheck.filters.clearColumns')}
                    title={t('ebarimtCheck.filters.clearColumns')}
                    className={cn(
                      'mx-auto grid size-5 place-items-center rounded-full bg-danger-soft text-destructive',
                      FOCUS_RING,
                    )}
                    onClick={() => {
                      setColumnFilters(EMPTY_COLUMN_FILTERS);
                      update(
                        Object.fromEntries(COLUMN_FILTERS.map((key) => [columnParam(key), null])),
                      );
                    }}
                  >
                    <X className="size-3" />
                  </button>
                ) : null}
              </FilterHead>
              <TextFilter
                column="employee"
                value={columnFilters.employee}
                onChange={setColumn('employee')}
              />
              <TextFilter column="code" value={columnFilters.code} onChange={setColumn('code')} />
              <TextFilter
                column="supplier"
                value={columnFilters.supplier}
                onChange={setColumn('supplier')}
              />
              <TextFilter
                column="registers"
                value={columnFilters.registers}
                onChange={setColumn('registers')}
              />
              <TextFilter
                column="phone"
                value={columnFilters.phone}
                onChange={setColumn('phone')}
              />
              <AmountFilter
                column="purchase"
                value={columnFilters.purchase}
                onChange={setColumn('purchase')}
              />
              <AmountFilter
                column="ebarimt"
                value={columnFilters.ebarimt}
                onChange={setColumn('ebarimt')}
              />
              <AmountFilter
                column="exempt"
                value={columnFilters.exempt}
                onChange={setColumn('exempt')}
              />
              <DiffFilter value={columnFilters.diff} onChange={setColumn('diff')} />
              <TextFilter column="note" value={columnFilters.note} onChange={setColumn('note')} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {waiting ? <SkeletonRows columns={columns.length} /> : null}
            {(waiting ? [] : filtered).map((row, index) => {
              const notes = row.byPeriod
                .filter((month) => month.note)
                .map((month) =>
                  multi ? `${labels.name(month.period)}: ${month.note}` : (month.note ?? ''),
                )
                .join('; ');
              return (
                <TableRow
                  key={`${monthMode ? period : 'range'}:${row.supplierId}`}
                  data-supplier={row.supplierId}
                  className={cn(
                    'group/row',
                    canTick && ticked.has(row.supplierId) && 'bg-secondary hover:bg-secondary',
                  )}
                >
                  <TableCell className="text-center text-xs text-muted-foreground">
                    {canTick ? (
                      <label className="flex cursor-pointer items-center justify-center gap-1">
                        <Checkbox
                          aria-label={t('ebarimtCheck.selectRow', { name: row.name })}
                          checked={ticked.has(row.supplierId)}
                          onClick={(event) => tick(row.supplierId, event)}
                        />
                        <span className="tabular-nums">{index + 1}</span>
                      </label>
                    ) : (
                      index + 1
                    )}
                  </TableCell>
                  <TableCell>
                    {monthMode ? (
                      <EmployeeCell
                        row={row}
                        canAssign={canAssign}
                        onAssign={() => setAssigning({ ids: [row.supplierId], bulk: false })}
                        onHistory={() => setHistoryOf(row.supplierId)}
                      />
                    ) : (
                      <EmployeeMonths row={row} onHistory={() => setHistoryOf(row.supplierId)} />
                    )}
                  </TableCell>
                  <TableCell title={row.code} className="font-mono text-xs text-muted-foreground">
                    {row.code}
                  </TableCell>
                  <TableCell>
                    <SupplierCell
                      row={row}
                      editable={canEdit}
                      onEditing={holdRow(row)}
                      onSave={(remark, shown) =>
                        saveProfile(row, t('ebarimtCheck.cells.remarkName', { name: row.name }), {
                          remark: remark || null,
                          previousRemark: shown,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <InlineText
                      mono
                      value={row.registers}
                      recordValue={row.registersDefault}
                      placeholder={t('ebarimtCheck.cells.registers')}
                      label={t('ebarimtCheck.cells.registersName', { name: row.name })}
                      editable={canEdit}
                      maxLength={EBARIMT_LIMITS.maxRegisters}
                      badge={
                        row.sharedRegisters.length > 0 ? (
                          <span
                            title={t('ebarimtCheck.cells.sharedRegister', {
                              registers: row.sharedRegisters.join(', '),
                            })}
                          >
                            <TriangleAlert
                              aria-hidden
                              className="mr-1 inline size-3 align-[-1px] text-warning"
                            />
                          </span>
                        ) : undefined
                      }
                      onEditing={holdRow(row)}
                      onSave={(registers, shown) =>
                        saveProfile(
                          row,
                          t('ebarimtCheck.cells.registersName', { name: row.name }),
                          { registers, previousRegisters: shown },
                        )
                      }
                      onRevert={() =>
                        saveProfile(
                          row,
                          t('ebarimtCheck.cells.registersName', { name: row.name }),
                          { registers: null, previousRegisters: row.registers },
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 items-start gap-0.5">
                      {row.phone ? (
                        <a
                          href={`tel:${row.phone.split(/[\s,;/\uFF0F\\]+/)[0] ?? ''}`}
                          aria-label={t('ebarimtCheck.cells.call', { name: row.name })}
                          title={t('ebarimtCheck.cells.call', { name: row.name })}
                          className="mt-1 shrink-0 text-muted-foreground hover:text-link"
                        >
                          <Phone aria-hidden className="size-3" />
                        </a>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <InlineText
                          mono
                          value={row.phone}
                          recordValue={row.phoneDefault}
                          placeholder={t('ebarimtCheck.cells.phone')}
                          label={t('ebarimtCheck.cells.phoneName', { name: row.name })}
                          editable={canEdit}
                          maxLength={EBARIMT_LIMITS.maxPhone}
                          onEditing={holdRow(row)}
                          onSave={(phone, shown) =>
                            saveProfile(
                              row,
                              t('ebarimtCheck.cells.phoneName', { name: row.name }),
                              { phone, previousPhone: shown },
                            )
                          }
                          onRevert={() =>
                            saveProfile(
                              row,
                              t('ebarimtCheck.cells.phoneName', { name: row.name }),
                              { phone: null, previousPhone: row.phone },
                            )
                          }
                        />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountButton
                      label={t('ebarimtCheck.cells.purchaseOpen', {
                        name: row.name,
                        amount: amountText(row.purchaseAmount),
                        count: row.receiptCount,
                      })}
                      hint={
                        row.pendingCount > 0
                          ? t('ebarimtCheck.cells.pending', { count: row.pendingCount })
                          : undefined
                      }
                      onClick={() => update({ receipts: String(row.supplierId) })}
                    >
                      {row.pendingCount > 0 ? (
                        <Hourglass
                          aria-hidden
                          className="mr-1 inline size-3 align-[-1px] text-warning"
                        />
                      ) : null}
                      {amountText(row.purchaseAmount)}
                    </AmountButton>
                  </TableCell>
                  <TableCell className="text-right">
                    <AmountButton
                      label={t('ebarimtCheck.cells.ebarimtOpen', {
                        name: row.name,
                        amount: amountText(row.ebarimtAmount),
                        count: row.ebarimtCount,
                      })}
                      hint={
                        new Decimal(row.linkedAmount).isZero()
                          ? undefined
                          : t('ebarimtCheck.cells.linked', {
                              amount: amountText(row.linkedAmount),
                            })
                      }
                      onClick={() => setEntriesOf(row.supplierId)}
                    >
                      {new Decimal(row.linkedAmount).isZero() ? null : (
                        <Link2
                          aria-hidden
                          className="mr-1 inline size-3 align-[-1px] text-warning"
                        />
                      )}
                      {amountText(row.ebarimtAmount)}
                    </AmountButton>
                  </TableCell>
                  <TableCell className="text-right">
                    <InlineAmount
                      value={row.exemptAmount}
                      label={t('ebarimtCheck.cells.exemptName', { name: row.name })}
                      editable={canEdit && monthMode}
                      onEditing={holdRow(row)}
                      onSave={(amount, shown) => saveExempt(row, amount, shown)}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <DiffValue value={row.diffAmount} />
                  </TableCell>
                  <TableCell>
                    {monthMode ? (
                      <InlineText
                        multiline
                        value={row.byPeriod[0]?.note ?? ''}
                        placeholder={t('ebarimtCheck.cells.note')}
                        label={t('ebarimtCheck.cells.noteName', { name: row.name })}
                        editable={canEdit}
                        maxLength={EBARIMT_LIMITS.maxNote}
                        onEditing={holdRow(row)}
                        onSave={(note, shown) => saveNote(row, note, shown)}
                      />
                    ) : (
                      <span
                        className="block max-w-64 truncate px-1 text-xs"
                        title={notes || t('ebarimtCheck.cells.noteInMonth')}
                      >
                        {notes || '—'}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {!waiting && filtered.length > 0 ? (
            <TableFooter className="sticky bottom-0 z-10 bg-card font-medium">
              <TableRow>
                <TableCell colSpan={6} className="text-right text-muted-foreground">
                  {t('ebarimtCheck.totals', { count: filtered.length })}
                </TableCell>
                <TableCell
                  title={amountText(totals.purchase.toFixed(2))}
                  className="text-right font-mono font-semibold"
                >
                  {amountText(totals.purchase.toFixed(2))}
                </TableCell>
                <TableCell
                  title={amountText(totals.ebarimt.toFixed(2))}
                  className="text-right font-mono font-semibold"
                >
                  {amountText(totals.ebarimt.toFixed(2))}
                </TableCell>
                <TableCell
                  title={amountText(totals.exempt.toFixed(2))}
                  className="text-right font-mono font-semibold text-warning"
                >
                  {amountText(totals.exempt.toFixed(2))}
                </TableCell>
                <TableCell className="text-right">
                  <DiffValue
                    value={totals.purchase.minus(totals.ebarimt).minus(totals.exempt).toFixed(2)}
                  />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          ) : null}
        </ListTable>
        {!waiting &&
        !report.isError &&
        (monthMode || !overview.isError) &&
        filtered.length === 0 ? (
          <EmptyState
            title={nothingAsked ? t('ebarimtCheck.emptyRange') : t('ebarimtCheck.emptySearch')}
            onClearFilters={
              nothingAsked
                ? undefined
                : () => {
                    clearListFilters();
                    update({ ...NO_LIST_FILTERS, emp: null, missing: null });
                  }
            }
          />
        ) : null}
      </ListCard>

      {canTick ? (
        <SelectionBar count={ticked.size} onClear={clearTicks}>
          {hiddenTicked > 0 ? (
            <span className="text-[0.8125rem] font-medium text-warning">
              {t('ebarimtCheck.filters.hiddenTicked', { count: hiddenTicked })}
            </span>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAssigning({ ids: [...ticked], bulk: true })}
          >
            <UserCog />
            {t('ebarimtCheck.bulk.choose')}
          </Button>
        </SelectionBar>
      ) : null}

      {refusals.length > 0 ? (
        <div className="fixed right-4 bottom-4 z-30 flex max-h-[calc(100dvh-5rem)] w-[min(22rem,calc(100%-2rem))] flex-col gap-2 overflow-y-auto">
          {refusals.map((refusal) => (
            <div
              key={refusal.key}
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-card p-3 shadow-card ring-1 ring-black/[0.06]"
            >
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[0.8125rem] font-medium text-destructive">
                  {refusal.label}
                </p>
                <ProblemAlert problem={refusal.problem} />
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('ebarimtCheck.cells.refusedDismiss', { label: refusal.label })}
                title={t('ebarimtCheck.cells.refusedDismiss', { label: refusal.label })}
                onClick={() =>
                  setRefusals((list) => list.filter((entry) => entry.key !== refusal.key))
                }
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {filesOpen ? <FilesDialog year={year} onClose={() => setFilesOpen(false)} /> : null}
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {receiptsRow ? (
        <ReceiptsDialog
          row={receiptsRow}
          periods={periods}
          baseYear={year}
          onClose={() => update({ receipts: null })}
        />
      ) : null}
      {entriesRow ? (
        <EntriesDialog
          row={entriesRow}
          periods={periods}
          baseYear={year}
          onClose={() => setEntriesOf(null)}
        />
      ) : null}
      {historyRow ? (
        <HistoryDialog row={historyRow} baseYear={year} onClose={() => setHistoryOf(null)} />
      ) : null}
      {unregisteredOpen ? (
        <UnregisteredDialog
          rows={unregistered}
          links={links}
          periods={periods}
          baseYear={year}
          onOpen={setTtdOf}
          onClose={() => setUnregisteredOpen(false)}
        />
      ) : null}
      {ttdOf ? (
        <EntriesDialog
          ttd={{ ttd: ttdOf.ttd, name: ttdOf.name }}
          periods={periods}
          baseYear={year}
          onClose={() => setTtdOf(null)}
        />
      ) : null}
      {assigning ? (
        <AssignDialog
          period={period}
          year={year}
          suppliers={assigning.ids.map((id) => ({ id, name: rowOf.get(id)?.name ?? '' }))}
          hiddenCount={assigning.bulk ? hiddenTicked : 0}
          currentName={
            assigning.ids.length === 1 ? rowOf.get(assigning.ids[0] as number)?.employeeName : null
          }
          ordererName={
            assigning.ids.length === 1 ? rowOf.get(assigning.ids[0] as number)?.ordererName : null
          }
          onDone={() => {
            if (assigning.bulk) clearTicks();
            setAssigning(null);
          }}
          onClose={() => setAssigning(null)}
        />
      ) : null}
    </div>
  );
}

/** A month without its file: said in the filter row, so the list keeps the room it fits in. */
function NoFileMark(props: { long: string; short: string; onUpload?: () => void }) {
  const { t } = useTranslation();
  if (!props.onUpload) {
    return (
      <span
        title={props.long}
        className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-warning"
      >
        <TriangleAlert aria-hidden className="size-3.5" />
        {props.short}
        <span className="sr-only">{props.long}</span>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={`${props.long} ${t('ebarimtCheck.uploadNow')}`}
      title={`${props.long} ${t('ebarimtCheck.uploadNow')}`}
      onClick={props.onUpload}
    >
      <TriangleAlert className="text-warning" />
      {props.short}
    </Button>
  );
}

function EmployeeChip(props: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={cn(
        'inline-flex h-7.5 items-center gap-1 rounded-full px-3 text-[0.8125rem] font-medium transition-colors',
        FOCUS_RING,
        props.active
          ? 'bg-secondary text-secondary-foreground'
          : 'bg-fill text-foreground hover:bg-accent',
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The supplier's name and its remark; a pencil on the row's hover starts one where there is none. */
function SupplierCell(props: {
  row: EbarimtRow;
  editable: boolean;
  onEditing: (editing: boolean) => void;
  onSave: (remark: string, shown: string) => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  const [adding, setAdding] = useState(false);
  const label = t('ebarimtCheck.cells.remarkName', { name: row.name });
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1">
        <Link
          to={`/partners/suppliers/${row.supplierId}`}
          title={row.name}
          className="min-w-0 truncate font-medium hover:underline"
        >
          {row.name}
        </Link>
        {row.status === 'ACTIVE' ? null : (
          <Badge variant="secondary" className="shrink-0">
            {t('ebarimtCheck.cells.inactive')}
          </Badge>
        )}
        {props.editable && row.remark === '' && !adding ? (
          <button
            type="button"
            aria-label={label}
            title={label}
            className={cn(
              'shrink-0 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100',
              FOCUS_RING,
            )}
            onClick={() => setAdding(true)}
          >
            <Pencil aria-hidden className="size-3" />
          </button>
        ) : null}
      </div>
      {row.remark !== '' || adding ? (
        <InlineText
          value={row.remark}
          placeholder={t('ebarimtCheck.cells.remark')}
          label={label}
          editable={props.editable}
          startEditing={adding}
          maxLength={EBARIMT_LIMITS.maxRemark}
          onEditing={props.onEditing}
          onClosed={() => setAdding(false)}
          onSave={props.onSave}
        />
      ) : null}
    </div>
  );
}

function HistoryButton(props: { row: EbarimtRow; onClick: () => void }) {
  const { t } = useTranslation();
  if (props.row.history.length === 0) return null;
  const label = t('ebarimtCheck.history.open', { name: props.row.name });
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn('mt-0.5 shrink-0 rounded text-warning hover:text-foreground', FOCUS_RING)}
      onClick={props.onClick}
    >
      <History className="size-3.5" />
    </button>
  );
}

/** The month's employee, who the supplier's own is when they differ, and a way to its history. */
function EmployeeCell(props: {
  row: EbarimtRow;
  canAssign: boolean;
  onAssign: () => void;
  onHistory: () => void;
}) {
  const { t } = useTranslation();
  const { row } = props;
  const name = row.employeeName ?? t('ebarimtCheck.cells.employeeNone');
  return (
    <div className="flex min-w-0 items-start gap-1 text-xs">
      <div className="min-w-0 flex-1">
        {props.canAssign ? (
          <button
            type="button"
            aria-label={t('ebarimtCheck.cells.employeeChange', {
              name: row.name,
              employee: row.employeeName ?? '—',
            })}
            title={name}
            className={cn(
              'block w-full truncate rounded-md px-1 py-0.5 text-left hover:bg-accent',
              FOCUS_RING,
              row.employeeName ? '' : 'text-muted-foreground/70 italic',
              row.employeeAssigned && row.ordererName && 'font-medium text-link',
            )}
            onClick={props.onAssign}
          >
            {row.employeeName ? shortName(row.employeeName) : name}
          </button>
        ) : (
          <span
            title={row.employeeName ?? undefined}
            className={cn(
              'block truncate px-1 py-0.5',
              row.employeeAssigned && row.ordererName && 'font-medium text-link',
            )}
          >
            {row.employeeName ? shortName(row.employeeName) : '—'}
          </span>
        )}
        {row.employeeAssigned && row.ordererName ? (
          <span
            className="block truncate px-1 text-muted-foreground"
            title={t('ebarimtCheck.cells.employeeOrderer', { name: row.ordererName })}
          >
            {shortName(row.ordererName)}
          </span>
        ) : null}
      </div>
      <HistoryButton row={row} onClick={props.onHistory} />
    </div>
  );
}

/** A consolidated row: who held the supplier and how many months, most months first. */
function EmployeeMonths({ row, onHistory }: { row: EbarimtRow; onHistory: () => void }) {
  const labels = usePeriodLabels();
  return (
    <div className="flex min-w-0 items-start gap-1 text-xs">
      <div
        className="min-w-0 flex-1"
        title={row.employeeMonths
          .map((month) => `${month.name ?? '—'}: ${labels.many(month.periods)}`)
          .join('\n')}
      >
        {row.employeeMonths.map((month, index) => (
          <div
            key={month.userId ?? 'none'}
            className={cn(
              'flex items-center gap-1 px-1',
              index === 0 ? 'font-medium' : 'text-muted-foreground',
            )}
          >
            <span className="truncate">{month.name ? shortName(month.name) : '—'}</span>
            <span className="shrink-0 rounded bg-fill px-1 tabular-nums">
              {month.periods.length}
            </span>
          </div>
        ))}
      </div>
      <HistoryButton row={row} onClick={onHistory} />
    </div>
  );
}

function AmountButton(props: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.hint ? `${props.label}\n${props.hint}` : props.label}
      className={cn(
        'block w-full rounded-md px-1 py-0.5 text-right font-mono underline-offset-2 hover:bg-accent hover:text-link hover:underline',
        FOCUS_RING,
      )}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The filter row sits under the head row and stays with it while the list scrolls. */
function FilterHead(props: { children?: ReactNode }) {
  return (
    <TableHead className="top-8! h-9 py-1 font-normal normal-case">{props.children}</TableHead>
  );
}

type ColumnKey = 'employee' | 'code' | 'supplier' | 'registers' | 'phone' | 'note';

function TextFilter(props: {
  column: ColumnKey;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`ebarimtCheck.columns.${props.column}`);
  return (
    <FilterHead>
      <Input
        aria-label={t('ebarimtCheck.filters.column', { column: label })}
        placeholder={t('ebarimtCheck.filters.columnPlaceholder')}
        value={props.value}
        className={cn(
          'h-7 px-1.5 text-xs md:text-xs',
          props.value && 'border-transparent bg-secondary',
        )}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </FilterHead>
  );
}

function AmountFilter(props: {
  column: 'purchase' | 'ebarimt' | 'exempt';
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(`ebarimtCheck.columns.${props.column}`);
  return (
    <FilterHead>
      <NativeSelect
        variant="filter"
        className="h-7 w-full pl-2 text-xs"
        aria-label={t('ebarimtCheck.filters.column', { column: label })}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{t('ebarimtCheck.filters.any')}</option>
        <option value="positive">{t('ebarimtCheck.filters.positive')}</option>
        <option value="zero">{t('ebarimtCheck.filters.zero')}</option>
      </NativeSelect>
    </FilterHead>
  );
}

function DiffFilter(props: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <FilterHead>
      <NativeSelect
        variant="filter"
        className="h-7 w-full pl-2 text-xs"
        aria-label={t('ebarimtCheck.filters.column', {
          column: t('ebarimtCheck.columns.diff'),
        })}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        <option value="">{t('ebarimtCheck.filters.any')}</option>
        <option value="missing">{t('ebarimtCheck.filters.diffMissing')}</option>
        <option value="ok">{t('ebarimtCheck.filters.diffOk')}</option>
        <option value="over">{t('ebarimtCheck.filters.diffOver')}</option>
      </NativeSelect>
    </FilterHead>
  );
}
