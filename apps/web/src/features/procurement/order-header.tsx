import { Decimal } from '@tugeel/shared/money';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  FileSpreadsheet,
  History,
  NotebookPen,
  Plus,
  Printer,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { saveBlob } from '@/lib/download';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  PO_STATUSES,
  type PurchaseOrderDetail,
  type PurchaseOrderSupplier,
  usePurchaseOrderDownloads,
  usePurchaseOrderMutations,
} from './api';
import { SupplierTicks } from './parts';

/**
 * The order's head (ADR-0118 #3): number, date, status and author; the seven statuses as circles
 * (done, current, next); «Хадгалах (n)», print, history, Excel, one step back for the filtered
 * supplier, archiving; the yellow bar when another user changed the order since the page loaded.
 */
export function OrderHeader(props: {
  detail: PurchaseOrderDetail;
  /** The supplier the page is filtered to, if one. */
  chosen: PurchaseOrderSupplier | undefined;
  dirtyCount: number;
  invalidCount: number;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  stale: boolean;
  onReload: () => void;
  onStepBack: (supplier: PurchaseOrderSupplier) => void;
}) {
  const { t } = useTranslation();
  const { detail } = props;
  const canManage = useHasPermission('procurement.orders.manage');
  const canPrices = useHasPermission('procurement.prices.read');
  const [adding, setAdding] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const downloads = usePurchaseOrderDownloads();
  const mutations = usePurchaseOrderMutations();
  const exporting = useAction();
  const archiving = useAction();
  const archived = detail.archivedAt !== null;

  const totals = detail.suppliers.reduce(
    (sum, supplier) => ({
      pieces: sum.pieces.plus(supplier.qtyBase),
      kg: sum.kg.plus(supplier.weightKg),
      estimated: supplier.estimatedCost
        ? sum.estimated.plus(supplier.estimatedCost)
        : sum.estimated,
      final: supplier.finalAmount ? sum.final.plus(supplier.finalAmount) : sum.final,
      diffs: sum.diffs + (supplier.priceDiffCount ?? 0),
    }),
    {
      pieces: new Decimal(0),
      kg: new Decimal(0),
      estimated: new Decimal(0),
      final: new Decimal(0),
      diffs: 0,
    },
  );

  return (
    <>
      <PageHeader
        title={detail.number}
        description={detail.note ?? undefined}
        crumbs={[
          { label: t('procurement.orders.title'), to: '/procurement/orders' },
          { label: detail.number, to: `/procurement/orders/${detail.id}` },
        ]}
        meta={
          <>
            {archived ? <Badge variant="outline">{t('procurement.detail.archived')}</Badge> : null}
            <span className="font-mono">{detail.orderDate}</span>
            {detail.createdBy ? (
              <span>{t('procurement.order.createdBy', { name: detail.createdBy })}</span>
            ) : null}
          </>
        }
        actions={
          <>
            {canManage ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('procurement.order.editNote')}
                  title={t('procurement.order.editNote')}
                  onClick={() => setEditingNote(true)}
                >
                  <NotebookPen />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('procurement.order.addSuppliers')}
                  title={t('procurement.order.addSuppliers')}
                  disabled={archived}
                  onClick={() => setAdding(true)}
                >
                  <Plus />
                </Button>
                {props.chosen?.canMoveBack ? (
                  <Button
                    variant="outline"
                    title={t('procurement.detail.stepBackTitle', {
                      name: props.chosen.supplierName,
                    })}
                    disabled={mutations.move.isPending}
                    onClick={() => props.chosen && props.onStepBack(props.chosen)}
                  >
                    <ArrowLeft />
                    {t('procurement.detail.stepBack')}
                  </Button>
                ) : null}
                {detail.canArchive || archived ? (
                  <Button
                    variant="outline"
                    pending={mutations.archive.isPending}
                    onClick={() =>
                      void archiving.run(async () => {
                        await mutations.archive.mutateAsync({
                          key: randomUuid(),
                          id: detail.id,
                          archived: !archived,
                        });
                        toast.success(
                          t(
                            archived
                              ? 'procurement.detail.unarchived'
                              : 'procurement.detail.archivedDone',
                          ),
                        );
                      })
                    }
                  >
                    {archived ? <ArchiveRestore /> : <Archive />}
                    {t(archived ? 'procurement.detail.unarchive' : 'procurement.detail.archive')}
                  </Button>
                ) : null}
              </>
            ) : null}
            <Button
              variant="outline"
              pending={downloads.exportExcel.isPending}
              onClick={() =>
                void exporting.run(async () =>
                  saveBlob(
                    await downloads.exportExcel.mutateAsync(detail.id),
                    `${detail.number}.xlsx`,
                  ),
                )
              }
            >
              <FileSpreadsheet />
              {t('procurement.detail.excel')}
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/procurement/orders/${detail.id}/history`}>
                <History />
                {t('procurement.history.title')}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={`/procurement/orders/${detail.id}/print`} target="_blank" rel="noreferrer">
                <Printer />
                {t('procurement.detail.print')}
              </Link>
            </Button>
            {props.canSave ? (
              <Button
                pending={props.saving}
                disabled={props.dirtyCount === 0 || props.invalidCount > 0}
                onClick={props.onSave}
              >
                {t('procurement.grid.save', { count: props.dirtyCount })}
              </Button>
            ) : null}
          </>
        }
      />
      <ProblemAlert problem={exporting.problem ?? archiving.problem} />
      <StatusCounts suppliers={detail.suppliers} />
      <dl
        className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground"
        aria-label={t('procurement.detail.totals')}
      >
        <Fact
          label={t('procurement.detail.totalPieces')}
          value={formatQty(totals.pieces.toFixed())}
        />
        <Fact
          label={t('procurement.detail.totalKg')}
          value={formatQty(totals.kg.toDecimalPlaces(1).toString())}
        />
        {canPrices ? (
          <>
            <Fact
              label={t('procurement.detail.estimated')}
              value={formatTugrik(totals.estimated.toFixed(2))}
            />
            <Fact
              label={t('procurement.detail.final')}
              value={formatTugrik(totals.final.toFixed(2))}
            />
            <Fact
              label={t('procurement.detail.priceDiffs')}
              value={t('procurement.detail.priceDiffCount', { count: formatCount(totals.diffs) })}
            />
          </>
        ) : null}
      </dl>
      {props.stale ? (
        <Alert className="mb-3 border-transparent bg-warning-soft shadow-none!">
          <TriangleAlert />
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{t('procurement.detail.staleTitle')}</span>
            <Button size="sm" variant="secondary" onClick={props.onReload}>
              <RefreshCw />
              {t('procurement.detail.reload')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {canManage ? (
        <>
          <Dialog open={adding} onOpenChange={setAdding}>
            {adding ? (
              <AddSuppliersDialog detail={detail} onClose={() => setAdding(false)} />
            ) : null}
          </Dialog>
          <Dialog open={editingNote} onOpenChange={setEditingNote}>
            {editingNote ? (
              <NoteDialog detail={detail} onClose={() => setEditingNote(false)} />
            ) : null}
          </Dialog>
        </>
      ) : null}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}

/** The seven statuses in order, each with how many suppliers stand in it (the order has none). */
export function StatusCounts({ suppliers }: { suppliers: readonly PurchaseOrderSupplier[] }) {
  const { t } = useTranslation();
  return (
    <ol
      className="mb-3 flex flex-wrap items-center gap-1.5"
      aria-label={t('procurement.detail.steps')}
    >
      {PO_STATUSES.map((status, position) => {
        const count = suppliers.filter((supplier) => supplier.status === status).length;
        return (
          <li key={status} className="flex items-center gap-1">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-semibold',
                count > 0 ? 'bg-primary text-white' : 'bg-fill text-muted-foreground',
              )}
            >
              {position + 1}
            </span>
            <span className={cn('text-[13px]', count === 0 && 'text-muted-foreground')}>
              {t(`procurement.status.${status}`)}
            </span>
            <span
              className={cn(
                'font-mono text-[13px] font-semibold',
                count === 0 && 'text-muted-foreground',
              )}
            >
              {formatCount(count)}
            </span>
            {position < PO_STATUSES.length - 1 ? (
              <span className="mx-1 h-px w-4 bg-border" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function AddSuppliersDialog(props: { detail: PurchaseOrderDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [suppliers, setSuppliers] = useState<ReadonlyMap<number, string>>(new Map());
  const inOrder = new Set(props.detail.suppliers.map((supplier) => supplier.supplierId));
  const add = () =>
    void action.run(async () => {
      await mutations.addSuppliers.mutateAsync({
        id: props.detail.id,
        supplierIds: [...suppliers.keys()],
      });
      toast.success(t('procurement.order.added', { count: suppliers.size }));
      props.onClose();
    });
  return (
    <DialogContent size="lg" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (suppliers.size > 0 && !mutations.addSuppliers.isPending) add();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('procurement.order.addSuppliers')}</DialogTitle>
          <DialogDescription>{t('procurement.order.addSuppliersHint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('procurement.create.suppliers')} htmlFor="po-add-suppliers">
          <SupplierTicks
            id="po-add-suppliers"
            value={suppliers}
            onChange={setSuppliers}
            exclude={inOrder}
          />
        </FormField>
        <DialogFormFooter
          pending={mutations.addSuppliers.isPending}
          disabled={suppliers.size === 0}
          submitLabel={
            suppliers.size > 0
              ? t('procurement.order.addCount', { count: formatCount(suppliers.size) })
              : t('procurement.order.add')
          }
          onCancel={props.onClose}
        />
      </form>
    </DialogContent>
  );
}

function NoteDialog(props: { detail: PurchaseOrderDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = usePurchaseOrderMutations();
  const action = useAction();
  const [note, setNote] = useState(props.detail.note ?? '');
  const save = () =>
    void action.run(async () => {
      await mutations.updateNote.mutateAsync({ id: props.detail.id, note: note.trim() || null });
      toast.success(t('common.saved'));
      props.onClose();
    });
  return (
    <DialogContent size="md" closeLabel={t('common.close')}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mutations.updateNote.isPending) save();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('procurement.order.editNote')}</DialogTitle>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <FormField label={t('procurement.orders.note')} htmlFor="po-note-edit">
          <Textarea
            id="po-note-edit"
            maxLength={500}
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        <DialogFormFooter pending={mutations.updateNote.isPending} onCancel={props.onClose} />
      </form>
    </DialogContent>
  );
}
