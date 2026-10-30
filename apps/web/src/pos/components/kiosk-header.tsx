import type { EdgeSession } from '@tugeel/shared/pos';
import { cn } from 'cn';
import { TriangleAlert, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from './layout';
import { useHealth } from '../queries';

/**
 * «Холбогдсон» while the edge reaches the centre, «Офлайн · N хүлээгдэж буй» while its outbox
 * waits, red when the till cannot reach its own edge. Asked every 10 s.
 */
export function StatusPill() {
  const { t } = useTranslation();
  const health = useHealth();
  const state = health.isError
    ? {
        tone: 'bg-danger-soft text-destructive',
        dot: 'bg-destructive',
        text: t('posKiosk.status.edgeDown'),
      }
    : !health.data
      ? {
          tone: 'bg-fill text-muted-foreground',
          dot: 'bg-muted-foreground',
          text: t('posKiosk.status.checking'),
        }
      : health.data.central.reachable
        ? {
            tone: 'bg-success-soft text-success',
            dot: 'bg-success',
            text: t('posKiosk.status.online'),
          }
        : {
            tone: 'bg-warning-soft text-warning',
            dot: 'bg-warning',
            text: t('posKiosk.status.offline', { count: health.data.outbox.pending }),
          };
  return (
    <span
      role="status"
      aria-label={t('posKiosk.status.label', { status: state.text })}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[0.8125rem] font-medium whitespace-nowrap',
        state.tone,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-full', state.dot)} />
      {state.text}
    </span>
  );
}

/**
 * The till's top bar (Erxes-like): the company and the till on the left, `center` (the product
 * search) in the middle, the connection, the cashier with the business day and `actions` on the
 * right.
 */
export function KioskHeader(props: {
  session: EdgeSession;
  center?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const { session } = props;
  const health = useHealth();
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-background px-4">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[0.9375rem] font-semibold">
              {session.companyName ?? t('brand.company')}
            </p>
            <p className="truncate text-[0.8125rem] text-muted-foreground">
              {t('posKiosk.header.till', { code: session.till.code, name: session.till.name })}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 justify-center">{props.center}</div>
        <div className="flex shrink-0 items-center gap-3">
          <StatusPill />
          <div className="flex items-center gap-2">
            <UserRound aria-hidden className="size-5 text-muted-foreground" />
            <div className="leading-tight">
              <p className="max-w-48 truncate text-[0.8125rem] font-semibold">
                {session.cashier.fullName}
              </p>
              <p className="font-mono text-xs text-muted-foreground">{session.businessDate}</p>
            </div>
          </div>
          {props.actions}
        </div>
      </header>
      {health.isError ? (
        // Losing the store's own server stops every sale: a strip across the screen, not only the
        // pill (ADR-0113). The pill's status line already announces it.
        <div className="flex shrink-0 items-center gap-3 bg-destructive px-4 py-2.5 text-[0.9375rem] text-primary-foreground">
          <TriangleAlert aria-hidden className="size-5 shrink-0" />
          <p>
            <span className="font-semibold">{t('posKiosk.status.edgeDown')}</span>
            {' · '}
            {t('posKiosk.status.edgeDownHint')}
          </p>
        </div>
      ) : null}
    </>
  );
}
