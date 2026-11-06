import {
  nextPeriod,
  periodMonth,
  periodOf,
  periodYear,
  previousPeriod,
} from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileWarning,
  History,
  Link2,
  Pencil,
  RefreshCw,
  Settings,
  TriangleAlert,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
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
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type EbarimtRow,
  type EbarimtUnregistered,
  useEbarimtFiles,
  useEbarimtMutations,
  useEbarimtReport,
} from './api';
import { EntriesDialog, HistoryDialog, ReceiptsDialog } from './detail-dialogs';
import { AssignDialog, FilesDialog, SettingsDialog, UnregisteredDialog } from './manage-dialogs';
import { amountText, diffStateOf, usePeriodLabels } from './helpers';
import { DiffValue, InlineAmount, InlineText } from './parts';

type Mode = 'month' | 'range';
const MODES: readonly Mode[] = ['month', 'range'];

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'check', kind: 'check', width: 3.25 },
  { key: 'employee', kind: 'text', weight: 1.2, min: 7 },
  { key: 'code', kind: 'code', width: 4.5 },
  { key: 'supplier', kind: 'text', weight: 2.4, min: 10 },
  { key: 'registers', kind: 'text', weight: 1, min: 5.75 },
  { key: 'phone', kind: 'text', weight: 0.8, min: 5.25 },
  { key: 'purchase', kind: 'money', width: 7.75 },
  { key: 'ebarimt', kind: 'money', width: 7.75 },
  { key: 'exempt', kind: 'money', width: 7.25 },
  { key: 'diff', kind: 'money', width: 7.75 },
  { key: 'note', kind: 'text', weight: 1.4, min: 7 },
];

const EMPTY_COLUMN_FILTERS = {
  employee: '',
  code: '',
  supplier: '',
  registers: '',
  phone: '',
  note: '',
  purchase: '',
  ebarimt: '',
  exempt: '',
  diff: '',
};
type ColumnFilters = typeof EMPTY_COLUMN_FILTERS;

const textOk = (value: string, filter: string) =>
  !filter || value.toLowerCase().includes(filter.toLowerCase());

/** Half a tugrik or more reads as an amount, as the differences do. */
const amountOk = (value: string, filter: string) => {
  if (!filter) return true;
  const some = new Decimal(value).abs().greaterThan('0.5');
  return filter === 'positive' ? some : !some;
};

const diffOk = (value: string, filter: string) => !filter || diffStateOf(value) === filter;

/** A month's quarters, for the presets. */
const quarter = (year: number, months: readonly number[]) =>
  months.map((month) => periodOf(year, month));

/**
 * «Ebarimt» (ADR-0168): the month's purchases from the system's own receipts against e-Barimt's file,
 * one row per supplier. Read as a whole and filtered here, as the old list did; every cell saves on
 * its own.
 */
export function EbarimtPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const canEdit = useHasPermission('ebarimt.check.edit');
  const canAssign = useHasPermission('ebarimt.check.assign');

  const today = businessDate();
  const thisPeriod = periodOf(
    Number.parseInt(today.slice(0, 4), 10),
    Number.parseInt(today.slice(5, 7), 10),
  );
  const asked = Number.parseInt(params.get('period') ?? '', 10);
  const hasPeriod = !Number.isNaN(asked);
  const mode: Mode = params.get('mode') === 'range' ? 'range' : 'month';
  const period = hasPeriod ? asked : thisPeriod;
  const year = periodYear(period);
  const overview = useEbarimtFiles(year);
  const labels = usePeriodLabels(year);

  const setPeriod = (next: number) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set('period', String(next));
        return copy;
      },
      { replace: true },
    );
  const setMode = (next: Mode) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set('period', String(period));
        if (next === 'range') copy.set('mode', 'range');
        else copy.delete('mode');
        return copy;
      },
      { replace: true },
    );

  // Opened without a month: the latest holding a file, else this one.
  const loaded = overview.isSuccess || overview.isError;
  const latest = overview.data?.latestPeriod ?? null;
  useEffect(() => {
    if (hasPeriod || !loaded) return;
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set('period', String(latest ?? thisPeriod));
        return copy;
      },
      { replace: true },
    );
  }, [hasPeriod, loaded, latest, thisPeriod, setParams]);

  // A consolidated view: the months with a file by default, last December among those offered.
  const [rangePeriods, setRangePeriods] = useState<number[] | null>(null);
  const yearMonths = useMemo(() => overview.data?.months ?? [], [overview.data]);
  const withFile = useMemo(
    () => yearMonths.filter((month) => month.file).map((month) => month.period),
    [yearMonths],
  );
  useEffect(() => setRangePeriods(null), [year]);
  const chosenRange = rangePeriods ?? withFile;
  const periods = !hasPeriod ? [] : mode === 'month' ? [period] : chosenRange;
  const report = useEbarimtReport(periods);
  const mutations = useEbarimtMutations();
  const action = useAction();

  // Filters
  const [employee, setEmployee] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [columnFilters, setColumnFilters] = useState<ColumnFilters>(EMPTY_COLUMN_FILTERS);
  const setColumn = (key: keyof ColumnFilters) => (value: string) =>
    setColumnFilters((current) => ({ ...current, [key]: value }));

  // Dialogs
  const [filesOpen, setFilesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unregisteredOpen, setUnregisteredOpen] = useState(false);
  const [receiptsOf, setReceiptsOf] = useState<number | null>(null);
  const [entriesOf, setEntriesOf] = useState<number | null>(null);
  const [historyOf, setHistoryOf] = useState<number | null>(null);
  const [ttdOf, setTtdOf] = useState<EbarimtUnregistered | null>(null);
  const [assigning, setAssigning] = useState<readonly number[] | null>(null);

  // Ticked rows, shift-click for a run; a month's ticks are its own.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const lastTicked = useRef<number | null>(null);
  useEffect(() => {
    setTicked(new Set());
    lastTicked.current = null;
    setSearch('');
    setColumnFilters(EMPTY_COLUMN_FILTERS);
  }, [period, mode]);

  const nothingAsked = periods.length === 0;
  const rows = useMemo(
    () => (nothingAsked ? [] : (report.data?.rows ?? [])),
    [nothingAsked, report.data],
  );
  const rowOf = useMemo(() => new Map(rows.map((row) => [row.supplierId, row])), [rows]);
  const multi = periods.length > 1;
  const monthMode = mode === 'month';
  const canTick = canAssign && monthMode;

  const employeesOf = (row: EbarimtRow) => row.employeeMonths.map((month) => month.userId);
  const employeeNames = (row: EbarimtRow) =>
    row.employeeMonths.map((month) => month.name ?? '').join(' ');

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

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        const notes = row.byPeriod.map((month) => month.note ?? '').join(' ');
        if (employee !== 'all') {
          const wanted = employee === 'none' ? null : Number.parseInt(employee, 10);
          if (!employeesOf(row).includes(wanted)) return false;
        }
        if (onlyMissing && diffStateOf(row.diffAmount) !== 'missing') return false;
        if (
          q &&
          !`${row.name} ${row.code} ${row.registers} ${row.phone} ${row.remark} ${notes}`
            .toLowerCase()
            .includes(q)
        ) {
          return false;
        }
        const cf = columnFilters;
        return (
          textOk(employeeNames(row), cf.employee) &&
          textOk(row.code, cf.code) &&
          textOk(`${row.name} ${row.remark}`, cf.supplier) &&
          textOk(row.registers, cf.registers) &&
          textOk(row.phone, cf.phone) &&
          textOk(notes, cf.note) &&
          amountOk(row.purchaseAmount, cf.purchase) &&
          amountOk(row.ebarimtAmount, cf.ebarimt) &&
          amountOk(row.exemptAmount, cf.exempt) &&
          diffOk(row.diffAmount, cf.diff)
        );
      }),
    [rows, employee, onlyMissing, q, columnFilters],
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

  const allTicked = filtered.length > 0 && filtered.every((row) => ticked.has(row.supplierId));
  const someTicked = filtered.some((row) => ticked.has(row.supplierId));
  const tick = (index: number, id: number, event: MouseEvent) => {
    const on = !ticked.has(id);
    const next = new Set(ticked);
    if (event.shiftKey && lastTicked.current !== null) {
      const from = Math.min(lastTicked.current, index);
      const to = Math.max(lastTicked.current, index);
      for (let i = from; i <= to; i += 1) {
        const row = filtered[i];
        if (row) {
          if (on) next.add(row.supplierId);
          else next.delete(row.supplierId);
        }
      }
    } else if (on) next.add(id);
    else next.delete(id);
    lastTicked.current = index;
    setTicked(next);
  };
  const tickAll = () => {
    const next = new Set(ticked);
    for (const row of filtered) {
      if (allTicked) next.delete(row.supplierId);
      else next.add(row.supplierId);
    }
    lastTicked.current = null;
    setTicked(next);
  };

  const saveExempt = (row: EbarimtRow, exemptAmount: string) =>
    void action.run(() =>
      mutations.saveMonthValue.mutateAsync({ period, supplierId: row.supplierId, exemptAmount }),
    );
  const saveNote = (row: EbarimtRow, note: string) =>
    void action.run(() =>
      mutations.saveMonthValue.mutateAsync({
        period,
        supplierId: row.supplierId,
        note: note || null,
      }),
    );
  const saveProfile = (
    row: EbarimtRow,
    changes: { registers?: string | null; phone?: string | null; remark?: string | null },
  ) =>
    void action.run(() =>
      mutations.saveProfile.mutateAsync({ supplierId: row.supplierId, ...changes }),
    );

  const togglePeriod = (value: number) =>
    setRangePeriods(
      chosenRange.includes(value)
        ? chosenRange.filter((other) => other !== value)
        : [...chosenRange, value].sort((a, b) => a - b),
    );
  const previousDecember = periodOf(year - 1, 12);
  const offered = yearMonths.map((month) => month.period);
  const allOfYear = offered.filter((value) => value !== previousDecember);
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
    (month) => month.file && month.period !== previousDecember,
  ).length;
  const noFile = nothingAsked ? [] : (report.data?.noFile ?? []);
  const unregistered = nothingAsked ? [] : (report.data?.unregistered ?? []);
  const links = nothingAsked ? [] : (report.data?.links ?? []);

  const receiptsRow = receiptsOf === null ? undefined : rowOf.get(receiptsOf);
  const entriesRow = entriesOf === null ? undefined : rowOf.get(entriesOf);
  const historyRow = historyOf === null ? undefined : rowOf.get(historyOf);

  return (
    <div className="flex flex-col">
      <PageHeader
        dense
        title={t('ebarimtCheck.title')}
        description={t('ebarimtCheck.description')}
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
              onClick={() => void report.refetch()}
            >
              <RefreshCw className={cn(report.isFetching && 'animate-spin')} />
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
              onClick={() => setOnlyMissing((value) => !value)}
            >
              <AlertCircle />
              {t('ebarimtCheck.filters.missing', { count: missingCount })}
            </Button>
            <SearchField
              className="sm:w-56"
              aria-label={t('ebarimtCheck.filters.search')}
              placeholder={t('ebarimtCheck.filters.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
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
            aria-label={
              monthMode ? t('ebarimtCheck.previousMonth') : t('ebarimtCheck.previousYear')
            }
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
            aria-label={monthMode ? t('ebarimtCheck.nextMonth') : t('ebarimtCheck.nextYear')}
            onClick={() =>
              setPeriod(monthMode ? nextPeriod(period) : periodOf(year + 1, periodMonth(period)))
            }
          >
            <ChevronRight />
          </Button>
        </div>
      </FilterBar>

      {!monthMode ? (
        <div
          role="group"
          aria-label={t('ebarimtCheck.monthsTitle')}
          className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-card px-3 py-2 shadow-card ring-1 ring-black/[0.06]"
        >
          <span className="mr-1 text-[13px] font-medium">{t('ebarimtCheck.monthsTitle')}:</span>
          {yearMonths.map((month) => {
            const on = chosenRange.includes(month.period);
            return (
              <button
                key={month.period}
                type="button"
                aria-pressed={on}
                title={labels.name(month.period)}
                className={cn(
                  'relative h-7.5 min-w-9 rounded-full px-2 text-[13px] font-medium transition-colors',
                  on ? 'bg-primary text-white' : 'bg-fill text-foreground hover:bg-accent',
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
              onClick={() => setRangePeriods(preset.periods)}
            >
              {preset.label}
            </Button>
          ))}
          <span className="ml-auto text-[13px] font-medium">{labels.many(chosenRange)}</span>
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

      <ProblemAlert problem={action.problem} />
      <ProblemAlert problem={problemFromError(report.error)} onRetry={report.refetch} />

      {noFile.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-warning-soft px-3 py-2 text-[13px]">
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
          <span>
            {monthMode
              ? t('ebarimtCheck.noFileMonth', { month: labels.name(period) })
              : t('ebarimtCheck.noFileRange', { months: labels.many(noFile) })}
          </span>
          {canEdit ? (
            <Button size="sm" variant="outline" onClick={() => setFilesOpen(true)}>
              {t('ebarimtCheck.uploadNow')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <ListCard scroll>
        <ListTable columns={COLUMNS} className="text-[13px]">
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
                    className="mx-auto grid size-5 place-items-center rounded-full bg-danger-soft text-destructive"
                    onClick={() => setColumnFilters(EMPTY_COLUMN_FILTERS)}
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
          {report.isPending && !nothingAsked ? (
            <SkeletonRows columns={COLUMNS.length} />
          ) : (
            <TableBody>
              {filtered.map((row, index) => {
                const notes = row.byPeriod
                  .filter((month) => month.note)
                  .map((month) =>
                    multi ? `${labels.name(month.period)}: ${month.note}` : (month.note ?? ''),
                  )
                  .join('; ');
                return (
                  <TableRow
                    key={row.supplierId}
                    className={cn(
                      'group/row',
                      ticked.has(row.supplierId) && 'bg-secondary hover:bg-secondary',
                    )}
                  >
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {canTick ? (
                        <label className="flex cursor-pointer items-center justify-center gap-1">
                          <Checkbox
                            aria-label={t('ebarimtCheck.selectRow', { name: row.name })}
                            checked={ticked.has(row.supplierId)}
                            onClick={(event) => tick(index, row.supplierId, event)}
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
                          onAssign={() => setAssigning([row.supplierId])}
                          onHistory={() => setHistoryOf(row.supplierId)}
                        />
                      ) : (
                        <EmployeeMonths row={row} />
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.code}
                    </TableCell>
                    <TableCell>
                      <SupplierCell
                        row={row}
                        editable={canEdit}
                        onSave={(remark) => saveProfile(row, { remark: remark || null })}
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
                        maxLength={200}
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
                        onSave={(registers) => saveProfile(row, { registers })}
                        onRevert={() => saveProfile(row, { registers: null })}
                      />
                    </TableCell>
                    <TableCell>
                      <InlineText
                        mono
                        value={row.phone}
                        recordValue={row.phoneDefault}
                        placeholder={t('ebarimtCheck.cells.phone')}
                        label={t('ebarimtCheck.cells.phoneName', { name: row.name })}
                        editable={canEdit}
                        maxLength={60}
                        onSave={(phone) => saveProfile(row, { phone })}
                        onRevert={() => saveProfile(row, { phone: null })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountButton
                        label={t('ebarimtCheck.cells.purchaseOpen', {
                          name: row.name,
                          count: row.receiptCount,
                        })}
                        onClick={() => setReceiptsOf(row.supplierId)}
                      >
                        {amountText(row.purchaseAmount)}
                      </AmountButton>
                    </TableCell>
                    <TableCell className="text-right">
                      <AmountButton
                        label={t('ebarimtCheck.cells.ebarimtOpen', {
                          name: row.name,
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
                        onSave={(amount) => saveExempt(row, amount)}
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
                          maxLength={500}
                          onSave={(note) => saveNote(row, note)}
                        />
                      ) : (
                        <span
                          className="block truncate px-1 text-xs"
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
          )}
          {filtered.length > 0 ? (
            <TableFooter className="sticky bottom-0 z-10 bg-card font-medium">
              <TableRow>
                <TableCell colSpan={6} className="text-right text-muted-foreground">
                  {t('ebarimtCheck.totals', { count: filtered.length })}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {amountText(totals.purchase.toFixed(2))}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {amountText(totals.ebarimt.toFixed(2))}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold text-warning">
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
        {(hasPeriod && nothingAsked) || (!report.isPending && filtered.length === 0) ? (
          <EmptyState
            title={nothingAsked ? t('ebarimtCheck.emptyRange') : t('ebarimtCheck.emptySearch')}
            onClearFilters={
              nothingAsked
                ? undefined
                : () => {
                    setEmployee('all');
                    setOnlyMissing(false);
                    setSearch('');
                    setColumnFilters(EMPTY_COLUMN_FILTERS);
                  }
            }
          />
        ) : null}
      </ListCard>

      {canTick ? (
        <SelectionBar count={ticked.size} onClear={() => setTicked(new Set())}>
          <Button size="sm" onClick={() => setAssigning([...ticked])}>
            <UserCog />
            {t('ebarimtCheck.bulk.choose')}
          </Button>
        </SelectionBar>
      ) : null}

      {filesOpen ? <FilesDialog year={year} onClose={() => setFilesOpen(false)} /> : null}
      {settingsOpen ? <SettingsDialog onClose={() => setSettingsOpen(false)} /> : null}
      {receiptsRow ? (
        <ReceiptsDialog
          row={receiptsRow}
          periods={periods}
          baseYear={year}
          onClose={() => setReceiptsOf(null)}
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
          suppliers={assigning.map((id) => ({ id, name: rowOf.get(id)?.name ?? '' }))}
          currentName={
            assigning.length === 1 ? rowOf.get(assigning[0] as number)?.employeeName : null
          }
          ordererName={
            assigning.length === 1 ? rowOf.get(assigning[0] as number)?.ordererName : null
          }
          onDone={() => {
            setAssigning(null);
            setTicked(new Set());
          }}
          onClose={() => setAssigning(null)}
        />
      ) : null}
    </div>
  );
}

function EmployeeChip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={cn(
        'inline-flex h-7.5 items-center gap-1 rounded-full px-3 text-[13px] font-medium transition-colors',
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
  onSave: (remark: string) => void;
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
        {props.editable && row.remark === '' && !adding ? (
          <button
            type="button"
            aria-label={label}
            title={label}
            className="shrink-0 rounded text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-foreground focus-visible:opacity-100"
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
          maxLength={300}
          onClosed={() => setAdding(false)}
          onSave={props.onSave}
        />
      ) : null}
    </div>
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
            aria-label={t('ebarimtCheck.cells.employeeChange', { name: row.name })}
            title={name}
            className={cn(
              'block w-full truncate rounded-md px-1 py-0.5 text-left hover:bg-accent',
              row.employeeName ? '' : 'text-muted-foreground/70 italic',
              row.employeeAssigned && row.ordererName && 'font-medium text-link',
            )}
            onClick={props.onAssign}
          >
            {name}
          </button>
        ) : (
          <span
            className={cn(
              'block truncate px-1 py-0.5',
              row.employeeAssigned && row.ordererName && 'font-medium text-link',
            )}
          >
            {row.employeeName ?? '—'}
          </span>
        )}
        {row.employeeAssigned && row.ordererName ? (
          <span
            className="block truncate px-1 text-muted-foreground"
            title={t('ebarimtCheck.cells.employeeOrderer', { name: row.ordererName })}
          >
            {row.ordererName}
          </span>
        ) : null}
      </div>
      {row.history.length > 0 ? (
        <button
          type="button"
          aria-label={t('ebarimtCheck.history.open')}
          title={t('ebarimtCheck.history.open')}
          className="mt-0.5 shrink-0 text-warning hover:text-foreground"
          onClick={props.onHistory}
        >
          <History className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** A consolidated row: who held the supplier and how many months, most months first. */
function EmployeeMonths({ row }: { row: EbarimtRow }) {
  const { t } = useTranslation();
  const labels = usePeriodLabels();
  return (
    <div
      className="text-xs"
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
          <span className="truncate">{month.name ?? '—'}</span>
          <span className="shrink-0 rounded bg-fill px-1 tabular-nums">
            {t('ebarimtCheck.cells.monthsCount', { count: month.periods.length })}
          </span>
        </div>
      ))}
    </div>
  );
}

function AmountButton(props: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.hint ?? props.label}
      className="block w-full rounded-md px-1 py-0.5 text-right font-mono underline-offset-2 hover:bg-accent hover:text-link hover:underline"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The filter row sits under the head row and stays with it while the list scrolls. */
function FilterHead(props: { children?: React.ReactNode }) {
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
