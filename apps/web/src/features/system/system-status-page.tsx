import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatUbDateTime } from '@/lib/dayjs';
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
    <div className="flex items-center justify-between py-2" data-state={state}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={state === 'up' ? 'font-medium text-success' : 'font-medium text-destructive'}>
        {t(stateKey(state))}
      </dd>
    </div>
  );
}

/** Shows whether the API, the database and the job queue are reachable (GET /health). */
export function SystemStatusPage() {
  const { t } = useTranslation();
  const health = useHealth();
  return (
    <div>
      <PageHeader title={t('systemStatus.title')} meta={t('systemStatus.description')} />
      <Card className="max-w-xl">
        <CardContent className="space-y-4">
          {health.isPending && <p>{t('systemStatus.loading')}</p>}
          {health.isError && (
            <p role="alert" className="text-destructive">
              {t('systemStatus.unreachable')}
            </p>
          )}
          {health.data && (
            <>
              <dl className="divide-y">
                <StatusRow label={t('systemStatus.components.db')} state={health.data.db} />
                <StatusRow label={t('systemStatus.components.pgboss')} state={health.data.pgboss} />
              </dl>
              <p className="text-xs text-muted-foreground">
                {t('systemStatus.checkedAt', { time: formatUbDateTime(health.dataUpdatedAt) })}
                {' · '}
                {t('systemStatus.version', { version: health.data.version })}
              </p>
            </>
          )}
          <Button
            variant="outline"
            disabled={health.isFetching}
            onClick={() => void health.refetch()}
          >
            {t('systemStatus.refresh')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
