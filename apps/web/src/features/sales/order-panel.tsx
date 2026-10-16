import { isCancellable, isFinished, type PrintKind } from '@tugeel/shared/sales';
import { Archive, ArchiveRestore, Ellipsis, Printer, Send, XCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type SalesOrder, useSalesOrder, useSalesOrderMutations } from './api';
import { MoveDialogs } from './move-dialogs';
import { OrderActivity } from './order-activity';
import { OrderStatusBadge, PaymentLabel } from './order-badges';
import { OrderOverview } from './order-overview';
import { PANEL_TABS, type PanelTab } from './order-panel-tabs';
import { PickForm } from './order-pick';
import { OrderProducts } from './order-products';
import { OrderProperties } from './order-properties';
import {
  openPrint,
  orderPrintPath,
  placeName,
  usePipeline,
  useSalesMutations,
} from './pipelines-api';
import { usePrintFormat } from '@/lib/print-format';
import { PrintFormatToggle } from '@/components/print-format-toggle';
import { useMover } from './use-mover';

const MANAGE = 'sales.orders.manage';

/**
 * The order (ADR-0059, erxes's deal view): a wide panel from the right with the order's number,
 * badges, printing and actions on top, and its sections on the left — «Ерөнхий», «Мэдээлэл»,
 * «Бараа», «Бэлтгэх» for pickers, «Түүх». The editing sections stay mounted (`forceMount`, hidden
 * while another is open), so edits survive a change of section; closing with edits unsaved asks.
 */
export function OrderPanel({
  orderId,
  tab,
  onTab,
  onClose,
}: {
  orderId: number | null;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [dirty, setDirty] = useState({ properties: false, products: false });
  const [leaving, setLeaving] = useState(false);
  const unsaved = dirty.properties || dirty.products;
  const close = () => {
    if (unsaved) setLeaving(true);
    else onClose();
  };
  const onDirtyProperties = useCallback(
    (value: boolean) => setDirty((current) => ({ ...current, properties: value })),
    [],
  );
  const onDirtyProducts = useCallback(
    (value: boolean) => setDirty((current) => ({ ...current, products: value })),
    [],
  );

  return (
    <>
      <Sheet open={orderId !== null} onOpenChange={(open) => (open ? undefined : close())}>
        <SheetContent
          closeLabel={t('common.close')}
          className="gap-0 overflow-hidden p-0 sm:max-w-[min(80rem,94vw)]"
          // Escape in a search box with text clears the search; the panel stays.
          onEscapeKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement && target.type === 'search' && target.value) {
              event.preventDefault();
            }
          }}
        >
          {orderId !== null ? (
            <PanelBody
              key={orderId}
              orderId={orderId}
              tab={tab}
              onTab={onTab}
              unsaved={unsaved}
              onDirtyProperties={onDirtyProperties}
              onDirtyProducts={onDirtyProducts}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={leaving}
        title={t('sales.panel.leaveTitle')}
        description={t('sales.panel.leaveDescription')}
        confirmLabel={t('sales.panel.leave')}
        onConfirm={() => {
          setLeaving(false);
          setDirty({ properties: false, products: false });
          onClose();
        }}
        onClose={() => setLeaving(false)}
      />
    </>
  );
}

function PanelBody({
  orderId,
  tab,
  onTab,
  unsaved,
  onDirtyProperties,
  onDirtyProducts,
}: {
  orderId: number;
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  unsaved: boolean;
  onDirtyProperties: (dirty: boolean) => void;
  onDirtyProducts: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const order = useSalesOrder(orderId);
  const detail = order.data;
  const pipeline = usePipeline(detail?.pipelineId ?? null);
  const canPick = useHasPermission('sales.orders.pick');
  const mover = useMover();
  const pickable =
    canPick &&
    detail !== undefined &&
    (detail.status === 'CONFIRMED' || detail.status === 'PICKING');
  const tabs = PANEL_TABS.filter((entry) => entry !== 'pick' || pickable);
  const current = tabs.includes(tab) ? tab : 'overview';
  const title = detail ? (detail.number ?? t('sales.order.draftNo', { id: detail.id })) : '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader className="gap-2 border-b border-border px-5 py-3 pr-14">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <SheetTitle className="text-lg">{title}</SheetTitle>
            <SheetDescription>
              {detail
                ? [
                    detail.customerName,
                    detail.pipelineName ? placeName(detail.boardName, detail.pipelineName) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : ''}
            </SheetDescription>
            {detail ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={detail.status} />
                <PaymentLabel method={detail.paymentMethod} />
                {detail.archivedAt ? (
                  <Badge variant="outline">{t('sales.work.archivedBadge')}</Badge>
                ) : null}
              </div>
            ) : null}
          </div>
          {detail ? <PanelActions order={detail} /> : null}
        </div>
      </SheetHeader>
      <ProblemAlert problem={problemFromError(order.error)} />
      {detail ? (
        <Tabs
          value={current}
          onValueChange={(value) => onTab(tabs.find((entry) => entry === value) ?? 'overview')}
          orientation="vertical"
          className="min-h-0 flex-1 gap-0 lg:flex-row"
        >
          <TabsList
            aria-label={t('sales.panel.sections')}
            className="w-full shrink-0 overflow-x-auto px-3 lg:w-52 lg:flex-col lg:items-stretch lg:gap-1 lg:overflow-visible lg:border-r lg:border-b-0 lg:py-4"
          >
            {tabs.map((entry) => (
              <TabsTrigger
                key={entry}
                value={entry}
                className="lg:-mb-0 lg:justify-start lg:rounded-lg lg:border-b-0 lg:px-3 lg:data-[state=active]:bg-secondary lg:data-[state=active]:text-secondary-foreground"
              >
                {t(`sales.panel.tabs.${entry}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <TabsContent value="overview" forceMount hidden={current !== 'overview'}>
              <OrderOverview
                order={detail}
                pipeline={pipeline.data}
                mover={mover}
                blocked={unsaved}
                onTab={onTab}
              />
            </TabsContent>
            <TabsContent value="properties" forceMount hidden={current !== 'properties'}>
              <OrderProperties order={detail} onDirty={onDirtyProperties} />
            </TabsContent>
            <TabsContent value="products" forceMount hidden={current !== 'products'}>
              <OrderProducts order={detail} onDirty={onDirtyProducts} />
            </TabsContent>
            {pickable ? (
              <TabsContent value="pick">
                <PickForm order={detail} />
              </TabsContent>
            ) : null}
            <TabsContent value="activity">
              <OrderActivity order={detail} />
            </TabsContent>
          </div>
        </Tabs>
      ) : null}
      <MoveDialogs mover={mover} showProblem={false} />
      {mover.problem && !mover.pending && !mover.print ? (
        <div className="px-5 pb-3">
          <ProblemAlert problem={mover.problem} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The header's actions: the paper and the documents (ADR-0058), then «⋯» with what the order
 * allows — submitting a draft outside every pipeline, archiving or restoring, cancelling.
 */
function PanelActions({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  const canManage = useHasPermission(MANAGE);
  const [format, setFormat] = usePrintFormat();
  const mutations = useSalesMutations();
  const orderMutations = useSalesOrderMutations();
  const action = useAction();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [submitKey] = useState(randomUuid);
  const [cancelKey] = useState(randomUuid);
  const print = (kind: PrintKind) => openPrint(orderPrintPath(order.id, kind, format));
  const canSubmit = canManage && order.status === 'DRAFT' && order.pipelineId === null;
  const canArchive = order.canEdit && isFinished(order.status) && !order.archivedAt;
  const canRestore = order.canEdit && order.archivedAt !== null;
  const canCancel = canManage && isCancellable(order.status);
  const run = (work: () => Promise<unknown>, done: string) =>
    void action.run(async () => {
      await work();
      toast.success(done);
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PrintFormatToggle value={format} onChange={setFormat} />
      <Button variant="outline" onClick={() => print('PICK_LIST')}>
        <Printer />
        {t('sales.printKinds.PICK_LIST')}
      </Button>
      {order.total !== null ? (
        <Button variant="outline" onClick={() => print('DELIVERY_NOTE')}>
          <Printer />
          {t('sales.printKinds.DELIVERY_NOTE')}
        </Button>
      ) : null}
      {canSubmit || canArchive || canRestore || canCancel ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={t('sales.panel.more')}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canSubmit ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => orderMutations.submit.mutateAsync({ id: order.id, key: submitKey }),
                    t('sales.order.confirmed', { number: order.number ?? '' }),
                  )
                }
              >
                <Send />
                {t('sales.order.submit')}
              </DropdownMenuItem>
            ) : null}
            {canArchive ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => mutations.archiveOrder.mutateAsync(order.id),
                    t('sales.work.archivedOrder'),
                  )
                }
              >
                <Archive />
                {t('sales.work.archive')}
              </DropdownMenuItem>
            ) : null}
            {canRestore ? (
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () => mutations.unarchiveOrder.mutateAsync(order.id),
                    t('sales.work.unarchivedOrder'),
                  )
                }
              >
                <ArchiveRestore />
                {t('sales.work.unarchive')}
              </DropdownMenuItem>
            ) : null}
            {canCancel ? (
              <DropdownMenuItem variant="destructive" onSelect={() => setCancelling(true)}>
                <XCircle />
                {t('sales.order.cancel')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <div className="basis-full">
        <ProblemAlert problem={cancelling ? null : action.problem} />
      </div>
      <ConfirmDialog
        open={cancelling}
        title={t('sales.order.cancelTitle')}
        description={t('sales.order.cancelDescription')}
        confirmLabel={t('sales.order.cancel')}
        disabled={!reason.trim()}
        pending={orderMutations.cancel.isPending}
        problem={action.problem}
        onConfirm={() =>
          void action.run(async () => {
            await orderMutations.cancel.mutateAsync({
              id: order.id,
              key: cancelKey,
              reason: reason.trim(),
            });
            setCancelling(false);
            setReason('');
            toast.success(t('sales.order.cancelled'));
          })
        }
        onClose={() => {
          setCancelling(false);
          action.clear();
        }}
      >
        <FormField label={t('sales.order.cancelReason')} htmlFor="panel-cancel-reason">
          <Textarea
            id="panel-cancel-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
