import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatUbDateTime } from '@/lib/dayjs';
import { cn } from '@/lib/utils';
import { useHealth } from './use-health';

type StateKey = 'systemStatus.state.up' | 'systemStatus.state.down' | 'systemStatus.state.unknown';

function stateKey(state: string): StateKey {
  if (state === 'up') return 'systemStatus.state.up';
  if (state === 'down') return 'systemStatus.state.down';
  return 'systemStatus.state.unknown';
}

function StatusRow({ label, state }: { label: string; state: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5" data-state={state}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'flex items-center gap-2 font-medium',
          state === 'up' ? 'text-success' : 'text-destructive',
        )}
      >
        <span aria-hidden className="size-2 rounded-full bg-current" />
        {t(stateKey(state))}
      </dd>
    </div>
  );
}

/**
 * Shows whether the API, the database and the job queue are reachable (GET /health, every 30 s);
 * «Шинэчлэх» in the header asks again at once.
 */
export function SystemStatusPage() {
  const { t } = useTranslation();
  const health = useHealth();
  return (
    <div>
      <PageHeader
        title={t('systemStatus.title')}
        description={t('systemStatus.description')}
        actions={
          <Button
            variant="outline"
            disabled={health.isFetching}
            onClick={() => void health.refetch()}
          >
            <RefreshCw className={cn(health.isFetching && 'animate-spin')} />
            {t('systemStatus.refresh')}
          </Button>
        }
      />
      <Card className="max-w-xl gap-0 py-0">
        <CardContent className="px-0">
          {health.isPending ? (
            <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
              {t('systemStatus.loading')}
            </p>
          ) : null}
          {health.isError ? (
            <p role="alert" className="px-4 py-3 text-sm text-destructive">
              {t('systemStatus.unreachable')}
            </p>
          ) : null}
          {health.data ? (
            <>
              <dl className="divide-y divide-border/80">
                <StatusRow label={t('systemStatus.components.db')} state={health.data.db} />
                <StatusRow label={t('systemStatus.components.pgboss')} state={health.data.pgboss} />
              </dl>
              <p className="border-t border-border/80 px-4 py-2.5 text-xs text-muted-foreground">
                {t('systemStatus.checkedAt', { time: formatUbDateTime(health.dataUpdatedAt) })}
                {' · '}
                {t('systemStatus.version', { version: health.data.version })}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
