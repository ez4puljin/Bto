import { Decimal } from '@tugeel/shared/money';
import { ExternalLink, Loader2, PlugZap, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import {
  type AiUsage,
  type AiUsageTotals,
  failureOf,
  useAiSettingsMutations,
  useAiUsage,
  usdText,
} from './ai-settings-api';

/** The provider's page with the credit left; the API has no call for it (ADR-0162). */
const ANTHROPIC_BILLING_URL = 'https://platform.claude.com/settings/billing';

const whole = new Intl.NumberFormat('en-US');

/**
 * «Системийн төлөв»: whether the AI is connected and what it has cost (ADR-0162). The cost is Bto's
 * own count of tokens at the day's price; the provider's bill is what counts.
 */
export function AiUsageCard() {
  const { t } = useTranslation();
  const usage = useAiUsage();
  const mutations = useAiSettingsMutations();
  return (
    <Card role="region" aria-labelledby="ai-usage-title" className="gap-0 py-0">
      <CardHeader className="border-b border-border/80 py-3">
        <CardTitle id="ai-usage-title">{t('systemStatus.ai.title')}</CardTitle>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={mutations.checkNow.isPending}
            onClick={() => mutations.checkNow.mutate()}
          >
            {mutations.checkNow.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
            {t('aiSettings.connection.test')}
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link to="/settings?tab=ai">{t('systemStatus.ai.settings')}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <div className="px-4 py-2.5 empty:hidden">
          <ProblemAlert
            problem={problemFromError(usage.error ?? mutations.checkNow.error)}
            onRetry={usage.refetch}
          />
        </div>
        {usage.data ? <UsageBody usage={usage.data} /> : null}
      </CardContent>
    </Card>
  );
}

function UsageBody({ usage }: { usage: AiUsage }) {
  const { t } = useTranslation();
  const { connection } = usage;
  const failure = connection.state === 'FAILED' ? failureOf(connection) : null;
  const lastFailure = connection.lastFailure ? failureOf(connection.lastFailure) : null;
  return (
    <>
      <dl className="divide-y divide-border/80">
        <div
          className="flex items-center justify-between gap-4 px-4 py-2.5"
          data-state={connection.state}
        >
          <dt className="text-sm text-muted-foreground">{t('systemStatus.ai.connection')}</dt>
          <dd
            className={cn(
              'flex items-center gap-2 font-medium',
              connection.state === 'CONNECTED' && 'text-success',
              connection.state === 'FAILED' && 'text-destructive',
              (connection.state === 'OFF' || connection.state === 'NOT_CONFIGURED') &&
                'text-muted-foreground',
            )}
          >
            <span aria-hidden className="size-2 rounded-full bg-current" />
            {t(`systemStatus.ai.states.${connection.state}`)}
          </dd>
        </div>
        {connection.model ? (
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-sm text-muted-foreground">{t('systemStatus.ai.model')}</dt>
            <dd className="font-mono text-sm">{connection.model}</dd>
          </div>
        ) : null}
      </dl>
      {failure ? (
        <p role="alert" className="border-t border-border/80 px-4 py-2.5 text-sm text-destructive">
          {t(`systemStatus.ai.failures.${failure.key}`, { status: failure.status })}
        </p>
      ) : null}
      {lastFailure && connection.lastFailure ? (
        <p role="alert" className="border-t border-border/80 px-4 py-2.5 text-sm text-destructive">
          {t('systemStatus.ai.lastFailure', {
            time: formatUbDateTime(Date.parse(connection.lastFailure.at)),
            reason: t(`systemStatus.ai.failures.${lastFailure.key}`, {
              status: lastFailure.status,
            }),
          })}
        </p>
      ) : null}
      <div className="grid gap-px border-t border-border/80 bg-border/80 sm:grid-cols-2">
        <Totals title={t('systemStatus.ai.today')} totals={usage.today} />
        <Totals title={t('systemStatus.ai.month')} totals={usage.month} />
      </div>
      <Budget usage={usage} />
      {usage.byUser.length > 0 ? <ByUser usage={usage} /> : null}
      <p className="border-t border-border/80 px-4 py-2.5 text-xs text-muted-foreground">
        {t('systemStatus.ai.creditNote')}{' '}
        {connection.provider === 'anthropic' ? (
          <a
            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
            href={ANTHROPIC_BILLING_URL}
            target="_blank"
            rel="noreferrer"
          >
            {t('systemStatus.ai.billing')}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </p>
    </>
  );
}

function Totals({ title, totals }: { title: string; totals: AiUsageTotals }) {
  const { t } = useTranslation();
  const rows = [
    { label: t('systemStatus.ai.questions'), value: whole.format(totals.questions) },
    { label: t('systemStatus.ai.invoiceChecks'), value: whole.format(totals.invoiceChecks) },
    {
      label: t('systemStatus.ai.tokens'),
      value: whole.format(totals.inputTokens + totals.outputTokens),
    },
    {
      label: t('systemStatus.ai.cost'),
      value: usdText(totals.costUsd, t('systemStatus.ai.lessThanCent')),
    },
  ];
  return (
    <section aria-label={title} className="bg-card px-4 py-3">
      <h3 className="mb-1.5 text-sm font-medium">{title}</h3>
      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
      {totals.unpricedCalls > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('systemStatus.ai.unpriced', { count: totals.unpricedCalls })}
        </p>
      ) : null}
    </section>
  );
}

function Budget({ usage }: { usage: AiUsage }) {
  const { t } = useTranslation();
  const { budget } = usage;
  const percent =
    budget.limitUsd === null
      ? 0
      : Math.min(
          100,
          Number.parseFloat(new Decimal(budget.spentUsd).div(budget.limitUsd).mul(100).toFixed(1)),
        );
  return (
    <div className="space-y-2 border-t border-border/80 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">{t('systemStatus.ai.budget')}</span>
        {budget.limitUsd === null ? (
          <span>{t('systemStatus.ai.budgetNone')}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="tabular-nums">
              {t('systemStatus.ai.budgetOf', {
                spent: new Decimal(budget.spentUsd).toFixed(2),
                limit: budget.limitUsd,
              })}
            </span>
            {budget.state === 'NONE' ? null : (
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-medium',
                  budget.state === 'OK' && 'text-success',
                  budget.state === 'WARN' && 'text-warning',
                  budget.state === 'REACHED' && 'text-destructive',
                )}
              >
                {budget.state === 'OK' ? null : <TriangleAlert aria-hidden className="size-3.5" />}
                {t(`systemStatus.ai.budgetStates.${budget.state}`)}
              </span>
            )}
          </span>
        )}
      </div>
      {budget.limitUsd === null ? null : (
        <div
          role="progressbar"
          aria-label={t('systemStatus.ai.budget')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              budget.state === 'WARN' && 'bg-warning',
              budget.state === 'REACHED' && 'bg-destructive',
              budget.state === 'OK' && 'bg-primary',
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {usage.userDailyQuestions === null ? null : (
        <p className="text-xs text-muted-foreground">
          {t('systemStatus.ai.dailyLimit', { count: usage.userDailyQuestions })}
        </p>
      )}
    </div>
  );
}

function ByUser({ usage }: { usage: AiUsage }) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="ai-usage-people" className="border-t border-border/80">
      <h3 id="ai-usage-people" className="px-4 pt-3 pb-1 text-sm font-medium">
        {t('systemStatus.ai.byUser')}
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('systemStatus.ai.person')}</TableHead>
            <TableHead className="text-right">{t('systemStatus.ai.questions')}</TableHead>
            <TableHead className="text-right">{t('systemStatus.ai.invoiceChecks')}</TableHead>
            <TableHead className="text-right">{t('systemStatus.ai.tokens')}</TableHead>
            <TableHead className="text-right">{t('systemStatus.ai.cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {usage.byUser.map((row) => (
            <TableRow key={row.userId}>
              <TableCell>{row.fullName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {whole.format(row.questions)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {whole.format(row.invoiceChecks)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {whole.format(row.inputTokens + row.outputTokens)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {usdText(row.costUsd, t('systemStatus.ai.lessThanCent'))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
