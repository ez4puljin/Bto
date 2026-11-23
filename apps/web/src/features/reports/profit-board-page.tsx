import { Decimal } from '@tugeel/shared/money';
import {
  BOARD_PERIOD_KINDS,
  type BoardPeriodKind,
  boardPeriodOf,
  isBoardPeriodKey,
  isBoardPeriodKind,
  shiftBoardPeriod,
} from '@tugeel/shared/reports';
import { businessDate } from '@tugeel/shared/time';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { MonthInput } from '@/components/date-input';
import { EmptyState, SegmentedControl, SkeletonRows } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet } from '@/components/record-sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  type ProfitBoard,
  type ProfitBoardBreakdown,
  type ProfitBoardDimension,
  type ProfitBoardFilter,
  type ProfitBoardRow,
  SALES_SOURCES,
  type SalesSource,
  useProfitBoard,
  useProfitBoardProducts,
} from './api';
import { ExpenseEntriesSheet, ExpensesCard, type OpenExpense } from './profit-board-expenses';
import {
  BoardTrendChart,
  RankBars,
  type TrendBar,
  WaterfallChart,
  type WaterfallStep,
} from './profit-board-charts';
import { idParam, marginText, NONE, percentChange, pointChange } from './report-helpers';
import { AmountCell, RefreshControl, ROW_NAME } from './report-kit';

const DIMENSIONS = ['supplier', 'category', 'location', 'rep', 'branch'] as const;
const isDimension = (value: string | null): value is ProfitBoardDimension =>
  (DIMENSIONS as readonly (string | null)[]).includes(value);
const isSource = (value: string | null): value is SalesSource =>
  (SALES_SOURCES as readonly (string | null)[]).includes(value);

/** The chart beside each breakdown table shows this many rows. */
const CHART_ROWS = 10;
/** How far back the quarter and year pickers reach. */
const PICKER_PERIODS: Record<BoardPeriodKind, number> = { month: 0, quarter: 20, year: 8 };

/* ------------------------------------------------------------- the period */

/** «2026 оны 4-р улирал», «2026 он», a month as it is written. */
function usePeriodLabel() {
  const { t } = useTranslation();
  return (kind: BoardPeriodKind, period: string, axis = false): string => {
    if (kind === 'quarter') {
      const values = { year: period.slice(0, 4), quarter: period.slice(6) };
      return axis ? t('reports.board.quarterAxis', values) : t('reports.board.quarterOf', values);
    }
    if (kind === 'year') return axis ? period : t('reports.board.yearOf', { year: period });
    return period;
  };
}

/** The address's period and filters, each checked; a bad value falls back to the default. */
function useBoardFilter() {
  const [search, setSearch] = useSearchParams();
  const today = businessDate();
  const kindParam = search.get('kind');
  const kind: BoardPeriodKind = isBoardPeriodKind(kindParam) ? kindParam : 'month';
  const current = boardPeriodOf(kind, today);
  const periodParam = search.get('period');
  const period =
    isBoardPeriodKey(kind, periodParam) && periodParam <= current ? periodParam : current;
  const sourceParam = search.get('source');
  const tabParam = search.get('tab');
  const filter: ProfitBoardFilter = {
    kind,
    period,
    branchId: idParam(search.get('branch')),
    source: isSource(sourceParam) ? sourceParam : 'ALL',
  };
  const update = (changes: Record<string, string | null>) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  return {
    filter,
    current,
    tab: isDimension(tabParam) ? tabParam : ('supplier' as const),
    update,
  };
}

function PeriodPicker(props: {
  kind: BoardPeriodKind;
  period: string;
  current: string;
  onChange: (period: string) => void;
}) {
  const { t } = useTranslation();
  const labelOf = usePeriodLabel();
  const { kind, period, current } = props;
  const options =
    kind === 'month'
      ? []
      : Array.from({ length: PICKER_PERIODS[kind] }, (_, index) =>
          shiftBoardPeriod(kind, current, -index),
        );
  if (kind !== 'month' && !options.includes(period)) options.push(period);
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        aria-label={t('reports.board.previous')}
        onClick={() => props.onChange(shiftBoardPeriod(kind, period, -1))}
      >
        <ChevronLeft />
      </Button>
      {kind === 'month' ? (
        <MonthInput
          aria-label={t('reports.board.period')}
          className="w-40"
          value={period}
          max={current}
          onChange={(value) => props.onChange(value)}
        />
      ) : (
        <NativeSelect
          aria-label={t('reports.board.period')}
          className="w-auto min-w-40"
          value={period}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {options.map((value) => (
            <option key={value} value={value}>
              {labelOf(kind, value)}
            </option>
          ))}
        </NativeSelect>
      )}
      <Button
        variant="outline"
        size="icon"
        aria-label={t('reports.board.next')}
        disabled={period >= current}
        onClick={() => props.onChange(shiftBoardPeriod(kind, period, 1))}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

/* --------------------------------------------------------------- the tiles */

/** How a rise reads: good (sales, profit) or neither (cost). */
type Sense = 'good' | 'neutral';

/** One comparison under a tile: «Өмнөх үеэс ▲ 12.5%», the arrow and words, not colour alone. */
function Delta(props: { label: string; change: Decimal | null; sense: Sense; points?: boolean }) {
  const { t } = useTranslation();
  const { change } = props;
  const sign = change === null || change.isZero() ? 0 : change.gt(0) ? 1 : -1;
  const tone =
    sign === 0 || props.sense === 'neutral'
      ? 'text-muted-foreground'
      : sign > 0
        ? 'text-success'
        : 'text-destructive';
  const amount = change === null ? NONE : change.abs().toFixed(1);
  const text =
    change === null
      ? NONE
      : props.points
        ? t('reports.common.points', { value: amount })
        : `${amount}%`;
  return (
    <div className="flex items-center justify-between gap-2 text-[0.75rem]">
      <span className="min-w-0 truncate text-muted-foreground">{props.label}</span>
      <span className={cn('font-mono font-medium whitespace-nowrap', tone)}>
        {sign > 0 ? (
          <span aria-hidden>{'▲ '}</span>
        ) : sign < 0 ? (
          <span aria-hidden>{'▼ '}</span>
        ) : null}
        {sign !== 0 ? (
          <span className="sr-only">{`${t(sign > 0 ? 'reports.common.up' : 'reports.common.down')} `}</span>
        ) : null}
        {text}
      </span>
    </div>
  );
}

function BoardTile(props: {
  title: string;
  value: string;
  hint?: string;
  lines?: readonly string[];
  deltas?: readonly ReactNode[];
  tone?: 'default' | 'destructive';
}) {
  return (
    <section
      aria-label={props.title}
      className="flex min-w-0 flex-col gap-1.5 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <h2 className="text-[0.8125rem] font-medium text-muted-foreground">{props.title}</h2>
      <p
        className={cn(
          'truncate font-mono text-[1.375rem] leading-tight font-semibold',
          props.tone === 'destructive' && 'text-destructive',
        )}
        title={props.value}
      >
        {props.value}
      </p>
      {props.lines?.map((line) => (
        <p key={line} className="text-[0.75rem] text-muted-foreground">
          {line}
        </p>
      ))}
      {props.hint ? <p className="text-[0.75rem] text-muted-foreground">{props.hint}</p> : null}
      {props.deltas?.length ? (
        <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-2">
          {props.deltas}
        </div>
      ) : null}
    </section>
  );
}

const plus = (a: string, b: string) => new Decimal(a).plus(b).toFixed(2);

/** A tile's amount in whole tugriks (the tables keep the cents). */
const wholeTugrik = (value: string) => formatTugrik(new Decimal(value).toFixed(0));

function Tiles({ data }: { data: ProfitBoard }) {
  const { t } = useTranslation();
  const { totals, discounts, bonus, results, expenses } = data;
  const vsPrevious = t('reports.board.vsPrevious');
  const vsLastYear = t('reports.board.vsLastYear');
  const compare = (
    key: string,
    values: [string | null, string | null, string | null],
    sense: Sense,
    points = false,
  ) => {
    const change = points ? pointChange : percentChange;
    return [
      <Delta
        key={`${key}-p`}
        label={vsPrevious}
        change={change(values[0], values[1])}
        sense={sense}
        points={points}
      />,
      <Delta
        key={`${key}-y`}
        label={vsLastYear}
        change={change(values[0], values[2])}
        sense={sense}
        points={points}
      />,
    ];
  };
  const of = (pick: (figures: ProfitBoard['totals']['current']) => string | null) =>
    [pick(totals.current), pick(totals.previous), pick(totals.lastYear)] as [
      string | null,
      string | null,
      string | null,
    ];
  const bySource = t('reports.board.tiles.bySource');
  const result = (pick: (figures: NonNullable<ProfitBoard['results']>['current']) => string) =>
    results
      ? ([pick(results.current), pick(results.previous), pick(results.lastYear)] as [
          string,
          string,
          string,
        ])
      : null;
  const resultTile = (
    key: string,
    title: string,
    values: [string, string, string] | null,
    options: { sense: Sense; lines?: string[]; hint?: string; loss?: boolean },
  ) => (
    <BoardTile
      key={key}
      title={title}
      value={values ? wholeTugrik(values[0]) : NONE}
      tone={options.loss && values && new Decimal(values[0]).lt(0) ? 'destructive' : 'default'}
      lines={values ? options.lines : []}
      hint={values ? options.hint : bySource}
      deltas={values ? compare(key, values, options.sense) : []}
    />
  );
  const common = expenses?.common;
  const books: ReactNode[] = [
    resultTile(
      'expenses',
      t('reports.board.tiles.expenses'),
      result((r) => r.expenses),
      {
        sense: 'neutral',
        lines: common
          ? [t('reports.board.tiles.commonLine', { amount: wholeTugrik(common.current) })]
          : [],
        hint: expenses && expenses.lines === 0 ? t('reports.board.tiles.expensesNone') : undefined,
      },
    ),
    resultTile(
      'operatingProfit',
      t('reports.board.tiles.operatingProfit'),
      result((r) => r.operatingProfit),
      {
        sense: 'good',
        loss: true,
        lines: results
          ? [
              t('reports.board.tiles.otherIncomeLine', {
                amount: wholeTugrik(results.current.otherIncome),
              }),
            ]
          : [],
      },
    ),
    resultTile(
      'netProfit',
      t('reports.board.tiles.netProfit'),
      result((r) => r.netProfit),
      {
        sense: 'good',
        loss: true,
        lines: results
          ? [t('reports.board.tiles.taxLine', { amount: wholeTugrik(results.current.tax) })]
          : [],
      },
    ),
  ];
  const tiles: ReactNode[] = [
    <BoardTile
      key="sales"
      title={t('reports.board.tiles.sales')}
      value={wholeTugrik(totals.current.sales)}
      deltas={compare(
        'sales',
        of((f) => f.sales),
        'good',
      )}
    />,
    <BoardTile
      key="cost"
      title={t('reports.board.tiles.cost')}
      value={wholeTugrik(totals.current.cost)}
      deltas={compare(
        'cost',
        of((f) => f.cost),
        'neutral',
      )}
    />,
    <BoardTile
      key="profit"
      title={t('reports.board.tiles.profit')}
      value={wholeTugrik(totals.current.profit)}
      tone={new Decimal(totals.current.profit).lt(0) ? 'destructive' : 'default'}
      deltas={compare(
        'profit',
        of((f) => f.profit),
        'good',
      )}
    />,
    <BoardTile
      key="margin"
      title={t('reports.board.tiles.margin')}
      value={marginText(totals.current.margin)}
      tone={
        totals.current.margin !== null && new Decimal(totals.current.margin).lt(data.threshold)
          ? 'destructive'
          : 'default'
      }
      deltas={compare(
        'margin',
        of((f) => f.margin),
        'good',
        true,
      )}
    />,
    <BoardTile
      key="discounts"
      title={t('reports.board.tiles.discounts')}
      value={discounts ? wholeTugrik(discounts.current) : NONE}
      hint={discounts ? t('reports.board.tiles.discountsHint') : bySource}
      deltas={
        discounts
          ? compare(
              'discounts',
              [discounts.current, discounts.previous, discounts.lastYear],
              'good',
            )
          : []
      }
    />,
    <BoardTile
      key="withDiscounts"
      title={t('reports.board.tiles.profitWithDiscounts')}
      value={discounts ? wholeTugrik(plus(totals.current.profit, discounts.current)) : NONE}
      hint={discounts ? undefined : bySource}
      deltas={
        discounts
          ? compare(
              'withDiscounts',
              [
                plus(totals.current.profit, discounts.current),
                plus(totals.previous.profit, discounts.previous),
                plus(totals.lastYear.profit, discounts.lastYear),
              ],
              'good',
            )
          : []
      }
    />,
    <BoardTile
      key="bonus"
      title={t('reports.board.tiles.bonus')}
      value={bonus ? wholeTugrik(bonus.value) : NONE}
      lines={
        bonus
          ? [
              t('reports.board.tiles.bonusQty', {
                qty: formatQty(bonus.qty),
                lines: formatCount(bonus.lines),
              }),
              ...(bonus.unvalued > 0
                ? [t('reports.board.tiles.bonusUnvalued', { count: formatCount(bonus.unvalued) })]
                : []),
            ]
          : []
      }
      hint={bonus ? t('reports.board.tiles.bonusHint') : bySource}
    />,
  ];
  // The gross result first (four tiles), then what the books make of it (expenses, operating and
  // net profit, ADR-0238), then what stands beside it; each group fills its row.
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 @5xl:grid-cols-4">{tiles.slice(0, 4)}</div>
      <div className="grid grid-cols-3 gap-3">{books}</div>
      <div className="grid grid-cols-3 gap-3">{tiles.slice(4)}</div>
    </div>
  );
}

/* -------------------------------------------------------------- the charts */

function ChartCard(props: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card role="region" aria-label={props.title} className="min-w-0 gap-2">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {props.children}
        {props.note ? (
          <p className="mt-2 text-[0.75rem] text-muted-foreground">{props.note}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Charts({ data }: { data: ProfitBoard }) {
  const { t } = useTranslation();
  const labelOf = usePeriodLabel();
  const points: TrendBar[] = data.trend.map((point) => ({
    key: point.period,
    label: labelOf(data.kind, point.period, true),
    sales: point.sales,
    profit: point.profit,
    margin: point.margin,
    netProfit: point.netProfit,
  }));
  const results = data.results?.current ?? null;
  const { current } = data.totals;
  const steps: WaterfallStep[] = [
    { key: 'sales', label: t('reports.board.tiles.sales'), kind: 'total', value: current.sales },
    {
      key: 'cost',
      label: t('reports.board.columns.cost'),
      kind: 'change',
      value: new Decimal(current.cost).negated().toFixed(2),
    },
    { key: 'profit', label: t('reports.board.tiles.profit'), kind: 'total', value: current.profit },
    ...(data.discounts && results
      ? ([
          {
            key: 'discounts',
            label: t('reports.board.tiles.discounts'),
            kind: 'change',
            value: data.discounts.current,
          },
          {
            key: 'otherIncome',
            label: t('reports.board.steps.otherIncome'),
            kind: 'change',
            value: results.otherIncome,
          },
          {
            key: 'expenses',
            label: t('reports.board.tiles.expenses'),
            kind: 'change',
            value: new Decimal(results.expenses).negated().toFixed(2),
          },
          {
            key: 'operatingProfit',
            label: t('reports.board.tiles.operatingProfit'),
            kind: 'total',
            value: results.operatingProfit,
          },
          {
            key: 'tax',
            label: t('reports.board.steps.tax'),
            kind: 'change',
            value: new Decimal(results.tax).negated().toFixed(2),
          },
          {
            key: 'netProfit',
            label: t('reports.board.tiles.netProfit'),
            kind: 'total',
            value: results.netProfit,
          },
        ] satisfies WaterfallStep[])
      : []),
  ];
  return (
    <div className="grid gap-3 @5xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <ChartCard title={t('reports.board.trend')}>
        <BoardTrendChart points={points} label={t('reports.board.trend')} />
      </ChartCard>
      <ChartCard title={t('reports.board.waterfall')}>
        <WaterfallChart steps={steps} label={t('reports.board.waterfall')} />
      </ChartCard>
    </div>
  );
}

/* ---------------------------------------------------------- the breakdowns */

/** What a row reads as: its name, or the words for a row of no one. */
function useRowLabel() {
  const { t } = useTranslation();
  return (dimension: ProfitBoardDimension, row: ProfitBoardRow, child = false): string => {
    if (child && row.own) return t('reports.board.rows.own', { name: row.name ?? '' });
    const kind = row.kind;
    if (
      dimension === 'rep' &&
      (kind === 'APP' || kind === 'POS' || kind === 'COST_ADJ' || kind === 'NONE')
    ) {
      return t(`reports.excel.kinds.${kind}`);
    }
    if (row.kind === 'NONE') {
      if (dimension === 'supplier') return t('reports.board.rows.noSupplier');
      if (dimension === 'category') return t('reports.profit.noCategory');
      if (dimension === 'location') return t('reports.board.rows.noWarehouse');
      return t('reports.board.rows.noBranch');
    }
    return row.name ?? t('reports.common.noName');
  };
}

const rowKey = (row: ProfitBoardRow) => `${row.kind}:${row.id ?? ''}:${row.own ? 'own' : ''}`;

interface OpenRow {
  dimension: ProfitBoardDimension;
  row: ProfitBoardRow;
  label: string;
}

function BreakdownTable(props: {
  dimension: ProfitBoardDimension;
  breakdown: ProfitBoardBreakdown;
  totals: ProfitBoard['totals']['current'];
  discountTotal: string | null;
  onOpen: (open: OpenRow) => void;
}) {
  const { t } = useTranslation();
  const labelOf = useRowLabel();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const { dimension, breakdown } = props;
  const supplier = dimension === 'supplier';
  const columns = 'reports.board.columns';
  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const line = (row: ProfitBoardRow, child: boolean): ReactNode => {
    const key = rowKey(row);
    const label = labelOf(dimension, row, child);
    const open = expanded.has(key);
    return (
      <TableRow
        key={`${child ? 'child' : 'row'}:${key}`}
        className={child ? 'bg-accent/40' : undefined}
      >
        <TableCell className="max-w-72">
          <div className={cn('flex min-w-0 items-center gap-1', child && 'pl-8')}>
            {!child && row.children.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={open}
                aria-label={`${open ? t('reports.board.collapse') : t('reports.board.expand')}: ${label}`}
                onClick={() => toggle(key)}
              >
                {open ? <ChevronUp /> : <ChevronDown />}
              </Button>
            ) : null}
            <button
              type="button"
              className={cn(ROW_NAME, 'min-w-0 touch:min-h-11')}
              title={label}
              onClick={() => props.onOpen({ dimension, row, label })}
            >
              {label}
            </button>
          </div>
        </TableCell>
        <AmountCell value={row.sales} />
        <AmountCell value={row.cost} />
        <AmountCell
          value={row.profit}
          className={new Decimal(row.profit).lt(0) ? 'text-destructive' : undefined}
        />
        <TableCell
          className={cn(
            'text-right font-mono whitespace-nowrap',
            row.flagged && 'font-semibold text-destructive',
          )}
        >
          {marginText(row.margin)}
        </TableCell>
        <TableCell className="text-right font-mono whitespace-nowrap">
          {row.share === null ? NONE : `${row.share}%`}
        </TableCell>
        {supplier ? (
          <>
            <AmountCell value={row.discount} />
            <AmountCell value={row.profitWithDiscount} />
          </>
        ) : null}
      </TableRow>
    );
  };
  const others = breakdown.others;
  return (
    <div className="min-w-0 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t(`${columns}.name`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.sales`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.cost`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.profit`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.margin`)}</TableHead>
            <TableHead className="text-right">{t(`${columns}.share`)}</TableHead>
            {supplier ? (
              <>
                <TableHead className="text-right">{t(`${columns}.discount`)}</TableHead>
                <TableHead className="text-right">{t(`${columns}.profitWithDiscount`)}</TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.rows.flatMap((row) => [
            line(row, false),
            ...(expanded.has(rowKey(row)) ? row.children.map((child) => line(child, true)) : []),
          ])}
          {others ? (
            <TableRow>
              <TableCell className="text-muted-foreground">
                {t('reports.board.rows.othersCount', { count: formatCount(others.count) })}
              </TableCell>
              <AmountCell value={others.sales} />
              <AmountCell value={others.cost} />
              <AmountCell value={others.profit} />
              <TableCell className="text-right font-mono">{marginText(others.margin)}</TableCell>
              <TableCell className="text-right font-mono">
                {others.share === null ? NONE : `${others.share}%`}
              </TableCell>
              {supplier ? (
                <>
                  <AmountCell value={others.discount} />
                  <AmountCell value={others.profitWithDiscount} />
                </>
              ) : null}
            </TableRow>
          ) : null}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-semibold">{t('reports.common.total')}</TableCell>
            <AmountCell value={props.totals.sales} className="font-semibold" />
            <AmountCell value={props.totals.cost} className="font-semibold" />
            <AmountCell value={props.totals.profit} className="font-semibold" />
            <TableCell className="text-right font-mono font-semibold">
              {marginText(props.totals.margin)}
            </TableCell>
            <TableCell />
            {supplier ? (
              <>
                <AmountCell value={props.discountTotal} className="font-semibold" />
                <AmountCell
                  value={
                    props.discountTotal === null
                      ? null
                      : plus(props.totals.profit, props.discountTotal)
                  }
                  className="font-semibold"
                />
              </>
            ) : null}
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function Breakdowns(props: {
  data: ProfitBoard;
  tab: ProfitBoardDimension;
  onTab: (tab: ProfitBoardDimension) => void;
  onOpen: (open: OpenRow) => void;
}) {
  const { t } = useTranslation();
  const labelOf = useRowLabel();
  const { data, tab } = props;
  const breakdown = data.breakdowns[tab];
  const title = t('reports.board.breakdown');
  const empty = breakdown.rows.length === 0;
  return (
    <Card role="region" aria-label={title} className="min-w-0 gap-3">
      <CardHeader className="gap-2">
        <CardTitle>{title}</CardTitle>
        <p className="text-[0.75rem] text-muted-foreground">{t('reports.board.breakdownHint')}</p>
        <SegmentedControl
          name={title}
          options={DIMENSIONS}
          value={tab}
          label={(value) => t(`reports.board.tabs.${value}`)}
          onChange={props.onTab}
        />
      </CardHeader>
      <CardContent className="@container min-w-0">
        {empty ? (
          <EmptyState title={t('reports.board.empty')} />
        ) : (
          <div className="grid gap-4 @7xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <RankBars
              label={`${title}: ${t(`reports.board.tabs.${tab}`)}`}
              rows={breakdown.rows.slice(0, CHART_ROWS).map((row) => ({
                key: rowKey(row),
                label: labelOf(tab, row),
                profit: row.profit,
                share: row.share,
              }))}
            />
            <BreakdownTable
              key={tab}
              dimension={tab}
              breakdown={breakdown}
              totals={data.totals.current}
              discountTotal={data.discounts?.current ?? null}
              onOpen={props.onOpen}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------ the products */

function ProductsSheet(props: {
  open: OpenRow | null;
  filter: ProfitBoardFilter;
  range: { from: string; to: string } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { open } = props;
  const products = useProfitBoardProducts(
    props.filter,
    open
      ? { dimension: open.dimension, kind: open.row.kind, id: open.row.id, own: open.row.own }
      : null,
  );
  const columns = 'reports.board.columns';
  const data = products.data;
  return (
    <RecordSheet
      open={open !== null}
      onClose={props.onClose}
      title={open?.label ?? ''}
      description={
        props.range ? t('reports.common.range', { from: props.range.from, to: props.range.to }) : ''
      }
    >
      {open ? (
        <div className="flex flex-col gap-4">
          <FactChips
            facts={[
              { label: t(`${columns}.sales`), value: formatTugrik(open.row.sales) },
              { label: t(`${columns}.profit`), value: formatTugrik(open.row.profit) },
              {
                label: t(`${columns}.margin`),
                value: (
                  <span className={open.row.flagged ? 'font-semibold text-destructive' : undefined}>
                    {marginText(open.row.margin)}
                  </span>
                ),
              },
            ]}
          />
          <PanelSection title={t(`${columns}.product`)}>
            <ProblemAlert problem={problemFromError(products.error)} onRetry={products.refetch} />
            {data?.others ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                {t('reports.board.productsMore', { count: formatCount(data.others.count) })}
              </p>
            ) : null}
            {data && data.rows.length === 0 ? (
              <EmptyState title={t('reports.board.empty')} />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t(`${columns}.product`)}</TableHead>
                      <TableHead className="text-right">{t(`${columns}.qty`)}</TableHead>
                      <TableHead className="text-right">{t(`${columns}.sales`)}</TableHead>
                      <TableHead className="text-right">{t(`${columns}.cost`)}</TableHead>
                      <TableHead className="text-right">{t(`${columns}.profit`)}</TableHead>
                      <TableHead className="text-right">{t(`${columns}.margin`)}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.isPending ? <SkeletonRows columns={6} rows={4} /> : null}
                    {data?.rows.map((row) => (
                      <TableRow key={row.productId}>
                        <TableCell className="max-w-80">
                          <span className="block truncate font-medium" title={row.name}>
                            {row.name}
                          </span>
                          <span className="font-mono text-[0.75rem] text-muted-foreground">
                            {row.sku}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono whitespace-nowrap">
                          {row.unit ? `${formatQty(row.qty)} ${row.unit}` : formatQty(row.qty)}
                        </TableCell>
                        <AmountCell value={row.sales} />
                        <AmountCell value={row.cost} />
                        <AmountCell
                          value={row.profit}
                          className={new Decimal(row.profit).lt(0) ? 'text-destructive' : undefined}
                        />
                        <TableCell
                          className={cn(
                            'text-right font-mono whitespace-nowrap',
                            row.flagged && 'font-semibold text-destructive',
                          )}
                        >
                          {marginText(row.margin)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </PanelSection>
        </div>
      ) : null}
    </RecordSheet>
  );
}

/* ---------------------------------------------------------------- the page */

/**
 * «Тайлан → Ашгийн самбар» (ADR-0237): a month, quarter or year's net sales, cost of goods sold,
 * gross profit and margin against the period before and the same one a year earlier, the trend, the
 * profit's structure with the suppliers' discounts, the operating expenses, other income and tax
 * from the books down to operating and net profit (ADR-0238), and the gross profit by supplier,
 * category, warehouse, rep and branch, each row opening its products. Only for `reports.margins.view`.
 */
export function ProfitBoardPage() {
  const { t } = useTranslation();
  const labelOf = usePeriodLabel();
  const { filter, current, tab, update } = useBoardFilter();
  const board = useProfitBoard(filter);
  const [open, setOpen] = useState<OpenRow | null>(null);
  const [expense, setExpense] = useState<OpenExpense | null>(null);
  const data = board.data;
  const sourceLabel = t('reports.profit.sources.label');
  return (
    <div className="@container space-y-4">
      <PageHeader
        title={t('reports.board.title')}
        description={t('reports.board.description')}
        meta={
          data ? (
            <span className="font-mono text-[0.8125rem]">
              {`${labelOf(data.kind, data.period)} · ${t('reports.common.range', {
                from: data.current.from,
                to: data.current.to,
              })}`}
            </span>
          ) : undefined
        }
        actions={<RefreshControl />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          name={t('reports.board.kind')}
          options={BOARD_PERIOD_KINDS}
          value={filter.kind}
          label={(value) => t(`reports.board.kinds.${value}`)}
          onChange={(kind) => update({ kind, period: null })}
        />
        <PeriodPicker
          kind={filter.kind}
          period={filter.period}
          current={current}
          onChange={(period) => update({ period: period === current ? null : period })}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('reports.board.branch')}
          value={filter.branchId ? String(filter.branchId) : ''}
          onChange={(event) => update({ branch: event.target.value || null })}
        >
          <option value="">{t('reports.board.allBranches')}</option>
          {data?.branches.map((branch) => (
            <option key={branch.id} value={String(branch.id)}>
              {branch.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={sourceLabel}
          active={filter.source !== 'ALL'}
          value={filter.source}
          onChange={(event) =>
            update({ source: event.target.value === 'ALL' ? null : event.target.value })
          }
        >
          {SALES_SOURCES.map((source) => (
            <option key={source} value={source}>
              {t(`reports.profit.sources.${source}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ProblemAlert problem={problemFromError(board.error)} onRetry={board.refetch} />
      {data ? (
        <>
          <Tiles data={data} />
          <Charts data={data} />
          {data.expenses ? <ExpensesCard expenses={data.expenses} onOpen={setExpense} /> : null}
          <Breakdowns
            data={data}
            tab={tab}
            onTab={(next) => update({ tab: next === 'supplier' ? null : next })}
            onOpen={setOpen}
          />
        </>
      ) : board.isPending ? (
        <div role="status" aria-label={t('reports.board.title')} className="space-y-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(13rem,100%),1fr))] gap-3">
            {[0, 1, 2, 3].map((slot) => (
              <div key={slot} className="h-28 animate-pulse rounded-xl bg-fill" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-xl bg-fill" />
        </div>
      ) : null}
      <ProductsSheet
        open={open}
        filter={filter}
        range={data ? data.current : null}
        onClose={() => setOpen(null)}
      />
      <ExpenseEntriesSheet
        open={expense}
        filter={filter}
        range={data ? data.current : null}
        onClose={() => setExpense(null)}
      />
    </div>
  );
}
