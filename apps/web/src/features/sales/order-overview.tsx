import { isEditable } from '@tugeel/shared/sales';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { useBranches } from '@/features/identity/api';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { SalesOrder } from './api';
import { OrderActivity } from './order-activity';
import { PaymentLabel } from './order-badges';
import type { PanelTab } from './order-panel-tabs';
import { type SalesPipeline, type SalesStage, useBoardTree } from './pipelines-api';
import type { Mover } from './use-mover';

/**
 * «Ерөнхий» (ADR-0059, erxes's Overview): where the order stands among its pipeline's stages and
 * where it may go next, the facts of the order as labelled chips, its note and the latest activity.
 */
export function OrderOverview({
  order,
  pipeline,
  mover,
  blocked,
  onTab,
}: {
  order: SalesOrder;
  pipeline: SalesPipeline | undefined;
  mover: Mover;
  /** Unsaved edits: the stage waits until they are saved. */
  blocked: boolean;
  onTab: (tab: PanelTab) => void;
}) {
  const { t } = useTranslation();
  const tree = useBoardTree();
  const branches = useBranches();
  const branchId = tree.data?.find((board) => board.id === order.boardId)?.branchId ?? null;
  const branch =
    branchId === null
      ? null
      : (branches.data?.find((entry) => entry.id === branchId)?.name ?? null);
  const facts: { label: string; value: ReactNode }[] = [
    { label: t('sales.order.customer'), value: `${order.customerName} · ${order.customerCode}` },
    { label: t('sales.order.deliveryDate'), value: order.deliveryDate },
    { label: t('sales.order.fulfilment'), value: t(`sales.fulfilments.${order.fulfilment}`) },
    { label: t('sales.order.paymentMethod'), value: <PaymentLabel method={order.paymentMethod} /> },
    ...(branch ? [{ label: t('sales.panel.branch'), value: branch }] : []),
    ...(order.pipelineName
      ? [
          {
            label: t('sales.order.place'),
            value: `${order.boardName ?? ''} / ${order.pipelineName}`,
          },
        ]
      : []),
    {
      label: t('sales.order.createdBy'),
      value: t('sales.panel.createdAt', {
        name: order.createdByName ?? t('sales.panel.activity.someone'),
        at: formatUbDateTime(Date.parse(order.createdAt)),
      }),
    },
    {
      label: t('sales.order.total'),
      value:
        order.total === null
          ? t('sales.panel.totalLater')
          : t('pricing.money', { amount: formatMnt(order.total) }),
    },
  ];
  const editable = order.canEdit && isEditable(order.status);

  return (
    <div className="flex flex-col gap-5">
      {pipeline && order.stageId !== null ? (
        <StageProgress order={order} pipeline={pipeline} mover={mover} blocked={blocked} />
      ) : null}
      <dl className="flex flex-wrap gap-2">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="flex items-stretch overflow-hidden rounded-lg border border-border text-[13px]"
          >
            <dt className="flex items-center bg-fill px-2.5 py-1.5 text-muted-foreground">
              {fact.label}
            </dt>
            <dd className="flex items-center px-2.5 py-1.5">{fact.value}</dd>
          </div>
        ))}
      </dl>
      <section className="rounded-xl border border-border p-4">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('sales.order.note')}</h3>
          {editable ? (
            <Button variant="link" size="sm" onClick={() => onTab('properties')}>
              {t('common.edit')}
            </Button>
          ) : null}
        </div>
        <p className={cn('text-sm whitespace-pre-wrap', !order.note && 'text-muted-foreground')}>
          {order.note ?? t('sales.panel.noNote')}
        </p>
      </section>
      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t('sales.panel.recent')}</h3>
          <Button variant="link" size="sm" onClick={() => onTab('activity')}>
            {t('sales.panel.allActivity')}
          </Button>
        </div>
        <OrderActivity order={order} limit={5} />
      </section>
    </div>
  );
}

/**
 * The pipeline's stages as steps (erxes): those behind the order ticked, its own one marked, each
 * one the user may move into a button; the select beside them moves too. A CANCEL stage asks its
 * reason first and a stage's documents are offered after the move (the mover's dialogs).
 */
function StageProgress({
  order,
  pipeline,
  mover,
  blocked,
}: {
  order: SalesOrder;
  pipeline: SalesPipeline;
  mover: Mover;
  blocked: boolean;
}) {
  const { t } = useTranslation();
  const stages = pipeline.stages.filter((stage) => stage.archivedAt === null && stage.canView);
  const current = stages.findIndex((stage) => stage.id === order.stageId);
  const move = (stage: SalesStage) => {
    if (stage.id !== order.stageId) mover.start(order.id, stage);
  };
  const busy = blocked || mover.busy;

  return (
    <section aria-label={t('sales.panel.stageSteps')} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect
          aria-label={t('sales.panel.stage')}
          className="w-56"
          value={order.stageId ?? ''}
          disabled={busy}
          onChange={(event) => {
            const stage = stages.find(
              (entry) => entry.id === Number.parseInt(event.target.value, 10),
            );
            if (stage) move(stage);
          }}
        >
          {stages.map((stage) => (
            <option
              key={stage.id}
              value={stage.id}
              disabled={stage.id !== order.stageId && !stage.canMove}
            >
              {stage.name}
            </option>
          ))}
        </NativeSelect>
        <ol className="flex min-w-0 flex-1 items-center overflow-x-auto py-1">
          {stages.map((stage, index) => {
            const done = current >= 0 && index < current;
            const here = index === current;
            return (
              <li key={stage.id} className="flex min-w-0 flex-1 items-center last:flex-none">
                <button
                  type="button"
                  title={stage.name}
                  aria-label={here ? stage.name : t('sales.panel.moveTo', { name: stage.name })}
                  aria-current={here ? 'step' : undefined}
                  disabled={here || !stage.canMove || busy}
                  onClick={() => move(stage)}
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-default',
                    done || here
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground enabled:hover:border-primary/60',
                    here && 'ring-4 ring-primary/20',
                  )}
                >
                  {done || here ? <Check className="size-4" /> : null}
                </button>
                {index < stages.length - 1 ? (
                  <span
                    aria-hidden
                    className={cn(
                      'h-0.5 min-w-4 flex-1',
                      index < current ? 'bg-primary' : 'bg-border',
                    )}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      {blocked ? <p className="text-[13px] text-warning">{t('sales.panel.saveFirst')}</p> : null}
    </section>
  );
}
