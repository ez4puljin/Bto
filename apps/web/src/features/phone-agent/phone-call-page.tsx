import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { cn } from '@/lib/utils';
import { callerOf, formatDuration, OUTCOME_TONE, toolOf } from './call-format';
import { type PhoneCallMessage, usePhoneCall, usePhoneCallbackOf } from './phone-agent-api';

/**
 * One call (ADR-0232): who rang and what came of it, then the conversation as chat bubbles, the
 * caller on one side and the agent on the other; a tool the agent used is one folded line.
 */
export function PhoneCallPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const detail = usePhoneCall(id);
  const call = detail.data?.call;
  const callback = usePhoneCallbackOf(id, call?.outcome === 'CALLBACK');
  const none = <span className="text-muted-foreground">{t('phoneAgent.calls.none')}</span>;
  return (
    <>
      <PageHeader
        title={t('phoneAgent.call.title', { id })}
        crumbs={[{ label: t('phoneAgent.calls.title'), to: '/sales/phone-calls' }]}
      />
      <ProblemAlert problem={problemFromError(detail.error)} onRetry={detail.refetch} />
      {call ? (
        <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{t('phoneAgent.call.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t('phoneAgent.calls.fields.startedAt')}</dt>
                <dd className="font-mono">{formatUbMinute(call.startedAt)}</dd>
                <dt className="text-muted-foreground">{t('phoneAgent.calls.fields.caller')}</dt>
                <dd className="font-mono">{callerOf(call) ?? none}</dd>
                <dt className="text-muted-foreground">{t('phoneAgent.calls.fields.customer')}</dt>
                <dd>{call.customerName ?? t('phoneAgent.calls.unknown')}</dd>
                <dt className="text-muted-foreground">{t('phoneAgent.calls.fields.outcome')}</dt>
                <dd>
                  {call.outcome ? (
                    <Badge variant={OUTCOME_TONE[call.outcome]}>
                      {t(`phoneAgent.outcomes.${call.outcome}`)}
                    </Badge>
                  ) : (
                    t(`phoneAgent.declineReasons.${call.declineReason ?? 'NONE'}`)
                  )}
                </dd>
                <dt className="text-muted-foreground">{t('phoneAgent.calls.fields.order')}</dt>
                <dd className="font-mono">
                  {call.salesOrderId !== null ? (
                    <Link className="text-link" to={`/sales/orders/${call.salesOrderId}`}>
                      {call.orderNumber}
                    </Link>
                  ) : (
                    none
                  )}
                </dd>
                <dt className="text-muted-foreground">{t('phoneAgent.calls.fields.duration')}</dt>
                <dd className="font-mono">
                  {call.durationS !== null ? formatDuration(call.durationS) : none}
                </dd>
                {callback.data ? (
                  <>
                    <dt className="text-muted-foreground">{t('phoneAgent.call.callback')}</dt>
                    <dd>
                      <Badge variant={callback.data.status === 'OPEN' ? 'warning' : 'secondary'}>
                        {t(`phoneAgent.callbackStatuses.${callback.data.status}`)}
                      </Badge>
                      <span className="mt-1 block">{callback.data.reason}</span>
                    </dd>
                  </>
                ) : null}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('phoneAgent.call.conversation')}</CardTitle>
            </CardHeader>
            <CardContent>
              {detail.data && detail.data.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('phoneAgent.call.noMessages')}</p>
              ) : (
                <ol className="flex flex-col gap-2" aria-label={t('phoneAgent.call.conversation')}>
                  {(detail.data?.messages ?? []).map((message) => (
                    <li key={message.seq}>
                      <Message message={message} />
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Message({ message }: { message: PhoneCallMessage }) {
  const { t } = useTranslation();
  if (message.role === 'TOOL') {
    const tool = toolOf(message);
    return (
      <details className="rounded-lg border border-border/80 px-3 py-1.5 text-[0.8125rem]">
        <summary className="cursor-pointer text-muted-foreground">
          <span className="font-mono">{tool.name}</span>
          {tool.noHit ? <span className="ml-2">{t('phoneAgent.call.noHit')}</span> : null}
          {tool.code ? <span className="ml-2 font-mono">{tool.code}</span> : null}
        </summary>
        <pre className="mt-1 overflow-x-auto font-mono text-xs break-all whitespace-pre-wrap">
          {JSON.stringify(message.meta, null, 2)}
        </pre>
      </details>
    );
  }
  const user = message.role === 'USER';
  return (
    <div className={cn('flex flex-col', user ? 'items-start' : 'items-end')}>
      <span className="mb-0.5 text-[0.6875rem] text-muted-foreground">
        {t(`phoneAgent.roles.${message.role}`)}
      </span>
      <p
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap',
          user ? 'bg-fill' : 'bg-info-soft text-foreground',
        )}
      >
        {message.text}
      </p>
    </div>
  );
}
