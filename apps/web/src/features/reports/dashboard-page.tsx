import type { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { type LucideIcon, PackageMinus, TrendingDown, TriangleAlert, Trophy } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyName } from '@/features/company/api';
import { saveBlob } from '@/lib/download';
import { formatCount, formatMnt, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { type Dashboard, useDashboard, useReportDownloads } from './api';
import { type BarItem, HorizontalBars, TrendChart } from './charts';
import { MONTH, NONE, percentChange, pointChange, reportHref } from './report-helpers';
import { ExcelButton, PrintHeading, PrintLink, RefreshControl } from './report-kit';

/** How a rise reads: good (sales, profit), bad (receivables) or neither (stock). */
type Sense = 'good' | 'bad' | 'neutral';

/** One comparison of a tile: «Өмнөх сарын мөн үе ▲ 12.5%», coloured by what a rise means. */
function Delta(props: { label: string; change: Decimal | null; sense: Sense; points?: boolean }) {
  const { t } = useTranslation();
  const { change } = props;
  const sign = change === null || change.isZero() ? 0 : change.gt(0) ? 1 : -1;
  const tone =
    sign === 0 || props.sense === 'neutral'
      ? 'text-muted-foreground'
      : sign > 0 === (props.sense === 'good')
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
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <span className="text-muted-foreground">{props.label}</span>
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

/** A KPI tile: the title links to the report behind it (the whole tile is the link's target). */
function KpiTile(props: {
  title: string;
  to?: string;
  value: string;
  lines?: readonly ReactNode[];
  deltas: readonly ReactNode[];
}) {
  return (
    <section
      aria-label={props.title}
      className={cn(
        'relative flex flex-col gap-2 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]',
        props.to && 'transition-shadow hover:ring-black/[0.12]',
      )}
    >
      <h2 className="text-[13px] font-medium text-muted-foreground">
        {props.to ? (
          <Link
            to={props.to}
            className="outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
          >
            {props.title}
          </Link>
        ) : (
          props.title
        )}
      </h2>
      <p className="font-mono text-[24px] leading-tight font-semibold">{props.value}</p>
      {props.lines?.length ? (
        <div className="flex flex-col gap-0.5 text-[12px] text-muted-foreground">
          {props.lines.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-2">
        {props.deltas}
      </div>
    </section>
  );
}

function Tiles({ data, canProfit }: { data: Dashboard; canProfit: boolean }) {
  const { t } = useTranslation();
  const vsPrevious = t('reports.dashboard.vsPrevious');
  const vsLastYear = t('reports.dashboard.vsLastYear');
  const range = { from: data.current.from, to: data.current.to };
  const compare = (
    key: string,
    value: { current: string | null; previous: string | null; lastYear: string | null },
    sense: Sense,
  ) => [
    <Delta
      key={`${key}-p`}
      label={vsPrevious}
      change={percentChange(value.current, value.previous)}
      sense={sense}
    />,
    <Delta
      key={`${key}-y`}
      label={vsLastYear}
      change={percentChange(value.current, value.lastYear)}
      sense={sense}
    />,
  ];
  const tiles: ReactNode[] = [
    <KpiTile
      key="sales"
      title={t('reports.dashboard.sales')}
      to={canProfit ? reportHref('/reports/profit', { by: 'customer', ...range }) : undefined}
      value={formatTugrik(data.sales.current)}
      lines={[
        t('reports.dashboard.salesSplit', {
          wholesale: formatTugrik(data.wholesale),
          pos: formatTugrik(data.pos),
        }),
        t('reports.dashboard.returns', { amount: formatTugrik(data.returns) }),
      ]}
      deltas={compare('sales', data.sales, 'good')}
    />,
  ];
  if (data.margins && data.grossProfit) {
    const margin = data.margin;
    tiles.push(
      <KpiTile
        key="profit"
        title={t('reports.dashboard.profit')}
        to={canProfit ? reportHref('/reports/profit', { by: 'category', ...range }) : undefined}
        value={data.grossProfit.current === null ? NONE : formatTugrik(data.grossProfit.current)}
        lines={[
          margin?.current
            ? t('reports.dashboard.margin', { value: margin.current })
            : t('reports.dashboard.marginNone'),
        ]}
        deltas={[
          ...compare('profit', data.grossProfit, 'good'),
          <Delta
            key="margin-p"
            label={t('reports.dashboard.marginChange')}
            change={pointChange(margin?.current ?? null, margin?.previous ?? null)}
            sense="good"
            points
          />,
        ]}
      />,
    );
  }
  tiles.push(
    <KpiTile
      key="receivables"
      title={t('reports.dashboard.receivables')}
      to="/reports/aging"
      value={formatTugrik(data.receivables.current)}
      lines={[
        t('reports.dashboard.overdue', {
          amount: formatTugrik(data.overdue),
          count: formatCount(data.overdueCustomers),
        }),
      ]}
      deltas={compare('receivables', data.receivables, 'bad')}
    />,
  );
  const turnover =
    data.turnoverDays === null
      ? NONE
      : t('reports.dashboard.turnoverValue', { days: formatCount(data.turnoverDays) });
  tiles.push(
    data.margins && data.stockValue ? (
      <KpiTile
        key="stock"
        title={t('reports.dashboard.stock')}
        to="/reports/stock"
        value={data.stockValue.current === null ? NONE : formatTugrik(data.stockValue.current)}
        lines={[t('reports.dashboard.turnover', { days: turnover })]}
        deltas={compare('stock', data.stockValue, 'neutral')}
      />
    ) : (
      <KpiTile
        key="stock"
        title={t('reports.dashboard.turnoverTitle')}
        to="/reports/stock"
        value={turnover}
        deltas={[]}
      />
    ),
  );
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{tiles}</div>;
}

function ChartCard(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.hint ? <p className="text-[12px] text-muted-foreground">{props.hint}</p> : null}
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

function Charts({ data, canProfit }: { data: Dashboard; canProfit: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const range = { from: data.current.from, to: data.current.to };
  const items: BarItem[] = data.categories.slice(0, 10).map((row) => ({
    key: String(row.categoryId ?? 'none'),
    label: row.name ?? t('reports.dashboard.categories.noCategory'),
    value: row.sales,
    extra:
      data.margins && row.margin !== null
        ? t('reports.dashboard.categories.margin', { value: row.margin })
        : undefined,
  }));
  const hrefOf = (item: BarItem) =>
    item.key === 'none'
      ? reportHref('/reports/profit', { by: 'category', ...range })
      : reportHref('/reports/profit', {
          by: 'product',
          ...range,
          categoryId: item.key,
          label: item.label,
        });
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <ChartCard title={t('reports.dashboard.trend.title')}>
        <TrendChart points={data.trend} label={t('reports.dashboard.trend.title')} />
      </ChartCard>
      <ChartCard
        title={t('reports.dashboard.categories.title')}
        hint={canProfit ? t('reports.dashboard.categories.hint') : undefined}
      >
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('reports.dashboard.categories.empty')}
          </p>
        ) : (
          <HorizontalBars
            items={items}
            label={t('reports.dashboard.categories.title')}
            valueLabel={t('reports.dashboard.sales')}
            onSelect={canProfit ? (item) => void navigate(hrefOf(item)) : undefined}
            renderLink={
              canProfit ? (item, text) => <Link to={hrefOf(item)}>{text}</Link> : undefined
            }
          />
        )}
      </ChartCard>
    </div>
  );
}

function AlertCard(props: {
  title: string;
  icon: LucideIcon;
  hint?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <section
      aria-label={props.title}
      className="flex flex-col gap-2 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <h3 className="flex items-center gap-2 text-[15px] font-semibold">
        <Icon aria-hidden className="size-4 text-muted-foreground" />
        {props.title}
      </h3>
      {props.hint ? <p className="text-[12px] text-muted-foreground">{props.hint}</p> : null}
      <div className="flex-1">{props.children}</div>
      {props.footer ? <div className="text-[13px]">{props.footer}</div> : null}
    </section>
  );
}

const LINK = 'text-link underline-offset-2 hover:underline';

function Alerts({ data }: { data: Dashboard }) {
  const { t } = useTranslation();
  const { alerts } = data;
  const empty = (text: string) => <p className="text-[13px] text-muted-foreground">{text}</p>;
  return (
    <section aria-labelledby="dashboard-alerts" className="flex flex-col gap-2">
      <h2 id="dashboard-alerts" className="text-[17px] font-semibold">
        {t('reports.dashboard.alerts.title')}
      </h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <AlertCard
          title={t('reports.dashboard.alerts.overdueTitle')}
          icon={TriangleAlert}
          footer={
            <Link className={LINK} to={reportHref('/reports/aging', { overdue: 1 })}>
              {t('reports.dashboard.alerts.overdueAll')}
            </Link>
          }
        >
          {alerts.overdue.length === 0 ? (
            empty(t('reports.dashboard.alerts.overdueEmpty'))
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {alerts.overdue.map((row) => (
                  <li
                    key={row.partyId}
                    className="flex items-baseline justify-between gap-2 text-[13px]"
                  >
                    <span className="min-w-0">
                      {row.customerId ? (
                        <Link
                          className={cn(LINK, 'block truncate')}
                          to={`/partners/customers/${row.customerId}`}
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="block truncate">{row.name}</span>
                      )}
                      {row.oldestDueDate ? (
                        <span className="text-[12px] text-muted-foreground">
                          {t('reports.dashboard.alerts.overdueSince', { date: row.oldestDueDate })}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono whitespace-nowrap text-destructive">
                      {formatTugrik(row.overdue)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {t('reports.dashboard.alerts.overdueCount', {
                  count: formatCount(data.overdueCustomers),
                })}
              </p>
            </>
          )}
        </AlertCard>
        <AlertCard
          title={t('reports.dashboard.alerts.lowTitle')}
          icon={PackageMinus}
          footer={
            <Link className={LINK} to={reportHref('/reports/stock', { filter: 'LOW' })}>
              {t('reports.dashboard.alerts.lowAll')}
            </Link>
          }
        >
          {alerts.lowStock.length === 0 ? (
            empty(t('reports.dashboard.alerts.lowEmpty'))
          ) : (
            <>
              <ul className="flex flex-col gap-1.5">
                {alerts.lowStock.map((row) => (
                  <li
                    key={`${row.productId}:${row.warehouseId}`}
                    className="flex items-baseline justify-between gap-2 text-[13px]"
                  >
                    <span className="min-w-0">
                      <Link
                        className={cn(LINK, 'block truncate')}
                        to={`/inventory/stock/${row.productId}`}
                      >
                        {row.name}
                      </Link>
                      <span className="text-[12px] text-muted-foreground">
                        {`${row.sku} · ${row.warehouseName}`}
                      </span>
                    </span>
                    <span className="font-mono whitespace-nowrap text-warning">
                      {t('reports.dashboard.alerts.lowQty', {
                        onHand: formatQty(row.onHand),
                        minQty: formatQty(row.minQty),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                {t('reports.dashboard.alerts.lowCount', {
                  count: formatCount(alerts.lowStockCount),
                })}
              </p>
            </>
          )}
        </AlertCard>
        {data.margins ? (
          <AlertCard
            title={t('reports.dashboard.alerts.fallingTitle')}
            icon={TrendingDown}
            hint={t('reports.dashboard.alerts.fallingHint', { threshold: data.threshold })}
          >
            {alerts.fallingCategories.length === 0 ? (
              empty(t('reports.dashboard.alerts.fallingEmpty'))
            ) : (
              <ul className="flex flex-col gap-1.5">
                {alerts.fallingCategories.map((row) => (
                  <li
                    key={row.categoryId ?? 'none'}
                    className="flex items-baseline justify-between gap-2 text-[13px]"
                  >
                    {row.categoryId ? (
                      <Link
                        className={cn(LINK, 'min-w-0 truncate')}
                        to={reportHref('/reports/profit', {
                          by: 'product',
                          from: data.current.from,
                          to: data.current.to,
                          categoryId: row.categoryId,
                          label: row.name,
                        })}
                      >
                        {row.name ?? t('reports.dashboard.categories.noCategory')}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate">
                        {row.name ?? t('reports.dashboard.categories.noCategory')}
                      </span>
                    )}
                    <span className="font-mono whitespace-nowrap text-destructive">
                      {t('reports.dashboard.alerts.fallingMargin', {
                        margin: row.margin ?? NONE,
                        previous: row.previousMargin === null ? NONE : `${row.previousMargin}%`,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </AlertCard>
        ) : null}
        <AlertCard title={t('reports.dashboard.alerts.topRepTitle')} icon={Trophy}>
          {alerts.topRep ? (
            <div className="flex flex-col gap-0.5">
              <p className="text-[15px] font-semibold">{alerts.topRep.name}</p>
              <p className="font-mono text-[18px] font-semibold">
                {formatTugrik(alerts.topRep.sales)}
              </p>
              {alerts.topRep.share !== null ? (
                <p className="text-[12px] text-muted-foreground">
                  {t('reports.dashboard.alerts.topRepShare', { share: alerts.topRep.share })}
                </p>
              ) : null}
            </div>
          ) : (
            empty(t('reports.dashboard.alerts.topRepEmpty'))
          )}
        </AlertCard>
      </div>
    </section>
  );
}

/**
 * «Тайлан → Захирлын самбар» (ADR-0108): the month's sales, profit, receivables and stock against
 * the same days a month and a year earlier, the twelve-month trend, sales by category and what needs
 * attention. Costs and margins only for those who see them (`margins`).
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const month = search.get('month') ?? businessDate().slice(0, 7);
  const valid = MONTH.test(month);
  const dashboard = useDashboard(valid ? month : null);
  const downloads = useReportDownloads();
  const action = useAction();
  const canProfit = useHasPermission('reports.margins.view');
  const data = dashboard.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('reports.dashboard.title')}
        description={t('reports.dashboard.description')}
        meta={
          data ? (
            <span className="font-mono text-[13px]">
              {t('reports.common.range', { from: data.current.from, to: data.current.to })}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Input
              type="month"
              aria-label={t('reports.dashboard.month')}
              className="w-40"
              value={month}
              onChange={(event) => setParam('month', event.target.value)}
            />
            <RefreshControl />
            <ExcelButton
              disabled={!valid || downloads.dashboard.isPending}
              onClick={() =>
                void action.run(async () =>
                  saveBlob(await downloads.dashboard.mutateAsync(month), `dashboard-${month}.xlsx`),
                )
              }
            />
            <PrintLink to={reportHref('/reports/dashboard/print', { month, format: 'a4' })} />
          </>
        }
      />
      <ProblemAlert problem={action.problem ?? problemFromError(dashboard.error)} />
      {data ? (
        <>
          <Tiles data={data} canProfit={canProfit} />
          <Charts data={data} canProfit={canProfit} />
          <Alerts data={data} />
        </>
      ) : null}
    </div>
  );
}

/** The dashboard's figures on paper: the comparison table, the categories and the alerts. */
export function DashboardPrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const month = search.get('month') ?? businessDate().slice(0, 7);
  const dashboard = useDashboard(MONTH.test(month) ? month : null);
  const company = useCompanyName();
  const title = `${t('reports.dashboard.title')} ${month}`;
  const data = dashboard.data;
  const money = (value: string | null) => (value === null ? NONE : formatMnt(value));
  const rows: [string, string | null, string | null, string | null][] = data
    ? [
        [
          t('reports.dashboard.sales'),
          data.sales.current,
          data.sales.previous,
          data.sales.lastYear,
        ],
        ...(data.margins && data.grossProfit
          ? ([
              [
                t('reports.dashboard.profit'),
                data.grossProfit.current,
                data.grossProfit.previous,
                data.grossProfit.lastYear,
              ],
            ] as [string, string | null, string | null, string | null][])
          : []),
        [
          t('reports.dashboard.receivables'),
          data.receivables.current,
          data.receivables.previous,
          data.receivables.lastYear,
        ],
        ...(data.margins && data.stockValue
          ? ([
              [
                t('reports.dashboard.stock'),
                data.stockValue.current,
                data.stockValue.previous,
                data.stockValue.lastYear,
              ],
            ] as [string, string | null, string | null, string | null][])
          : []),
      ]
    : [];
  return (
    <PrintFrame ready={data !== undefined} error={dashboard.error} title={title}>
      {() =>
        data ? (
          <div className="flex flex-col gap-3 text-[12px]">
            <PrintHeading
              company={company}
              title={title}
              note={t('reports.common.range', { from: data.current.from, to: data.current.to })}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead className="text-right">
                    {t('reports.excel.dashboard.current')}
                  </TableHead>
                  <TableHead className="text-right">{t('reports.dashboard.vsPrevious')}</TableHead>
                  <TableHead className="text-right">{t('reports.dashboard.vsLastYear')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(([label, current, previous, lastYear]) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    <TableCell className="text-right font-mono">{money(current)}</TableCell>
                    <TableCell className="text-right font-mono">{money(previous)}</TableCell>
                    <TableCell className="text-right font-mono">{money(lastYear)}</TableCell>
                  </TableRow>
                ))}
                {data.margins && data.margin ? (
                  <TableRow>
                    <TableCell>{t('reports.excel.dashboard.margin')}</TableCell>
                    <TableCell className="text-right font-mono">
                      {data.margin.current ?? NONE}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {data.margin.previous ?? NONE}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {data.margin.lastYear ?? NONE}
                    </TableCell>
                  </TableRow>
                ) : null}
                <TableRow>
                  <TableCell>{t('reports.excel.dashboard.overdue')}</TableCell>
                  <TableCell className="text-right font-mono">{formatMnt(data.overdue)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell>{t('reports.dashboard.turnoverTitle')}</TableCell>
                  <TableCell className="text-right font-mono">
                    {data.turnoverDays === null ? NONE : formatCount(data.turnoverDays)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
            <h2 className="text-[14px] font-semibold">{t('reports.dashboard.categories.title')}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.excel.dashboard.category')}</TableHead>
                  <TableHead className="text-right">{t('reports.dashboard.sales')}</TableHead>
                  {data.margins ? (
                    <TableHead className="text-right">
                      {t('reports.excel.dashboard.margin')}
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.categories.map((row) => (
                  <TableRow key={row.categoryId ?? 'none'}>
                    <TableCell>
                      {row.name ?? t('reports.dashboard.categories.noCategory')}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatMnt(row.sales)}</TableCell>
                    {data.margins ? (
                      <TableCell className="text-right font-mono">{row.margin ?? NONE}</TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
