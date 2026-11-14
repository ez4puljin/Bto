import { USAGE_APPS, type UsageApp } from '@tugeel/shared/usage';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { navTrail } from '@/app/nav-items';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCount } from '@/lib/money';
import {
  type ScreenUsageRow,
  USAGE_PERIODS,
  type UsagePeriod,
  usagePeriodOf,
  useScreenUsage,
} from './usage-api';
import { unusedNavItems } from './usage-menu';

function Duration({ seconds }: { seconds: number }) {
  const { t } = useTranslation();
  const whole = Math.round(seconds);
  if (whole < 60) return <>{t('usage.seconds', { seconds: whole })}</>;
  return <>{t('usage.minutes', { minutes: Math.floor(whole / 60), seconds: whole % 60 })}</>;
}

function AppUsage({ app, rows }: { app: UsageApp; rows: readonly ScreenUsageRow[] }) {
  const { t } = useTranslation();
  const total = rows.reduce((sum, row) => sum + row.opens, 0);
  const title = t(`usage.apps.${app}`);
  return (
    <section aria-label={title} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="text-base font-semibold">{title}</h2>
        {rows.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('usage.summary', { screens: rows.length, opens: formatCount(total) })}
          </p>
        ) : null}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">{t('usage.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('usage.columns.screen')}</TableHead>
                  <TableHead className="text-right">{t('usage.columns.opens')}</TableHead>
                  <TableHead className="text-right">{t('usage.columns.people')}</TableHead>
                  <TableHead className="text-right">{t('usage.columns.average')}</TableHead>
                  <TableHead className="w-40">{t('usage.columns.share')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const label = app === 'web' ? navTrail(row.screen)?.item.label : undefined;
                  const share = total > 0 ? (row.opens / total) * 100 : 0;
                  return (
                    <TableRow key={row.screen}>
                      <TableCell>
                        {label ? <span className="font-medium">{t(label)}</span> : null}
                        <span
                          className={
                            label
                              ? 'ml-2 font-mono text-xs text-muted-foreground'
                              : 'font-mono text-sm'
                          }
                        >
                          {row.screen}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(row.opens)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.people > 0 ? formatCount(row.people) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.opens > 0 ? <Duration seconds={row.seconds / row.opens} /> : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            aria-hidden
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.max(share, 1)}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                            {share.toFixed(share < 10 ? 1 : 0)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function UnusedMenu({ rows }: { rows: readonly ScreenUsageRow[] }) {
  const { t } = useTranslation();
  const unused = unusedNavItems(rows);
  const title = t('usage.unused.title');
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-sm text-muted-foreground">{t('usage.unused.description')}</p>
          {unused.length === 0 ? (
            <p className="text-sm">{t('usage.unused.none')}</p>
          ) : (
            <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {unused.map(({ group, item }) => (
                <li key={item.to}>
                  <span className="text-muted-foreground">{t(group)} › </span>
                  {t(item.label)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Which screens are used (ADR-0197): per client, every screen opened in the period with how often,
 * by how many people and for how long at a time, and the menu entries of the office web nobody
 * opened. What to improve first, and what could be taken out of the way.
 */
export function UsagePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const days = usagePeriodOf(params.get('days'));
  const usage = useScreenUsage(days);
  const choose = (next: UsagePeriod) =>
    setParams(
      (current) => {
        current.set('days', String(next));
        return current;
      },
      { replace: true },
    );
  const rows = usage.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('usage.title')}
        description={t('usage.description')}
        actions={
          <div role="group" aria-label={t('usage.period.label')} className="flex gap-1">
            {USAGE_PERIODS.map((period) => (
              <Button
                key={period}
                size="sm"
                variant={period === days ? 'default' : 'outline'}
                aria-pressed={period === days}
                onClick={() => choose(period)}
              >
                {t('usage.period.days', { count: period })}
              </Button>
            ))}
          </div>
        }
      />
      {usage.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('usage.error')}
        </p>
      ) : usage.isPending ? (
        <p className="text-sm text-muted-foreground">{t('usage.loading')}</p>
      ) : (
        <>
          {USAGE_APPS.map((app) => (
            <AppUsage key={app} app={app} rows={rows.filter((row) => row.app === app)} />
          ))}
          <UnusedMenu rows={rows} />
        </>
      )}
    </div>
  );
}
