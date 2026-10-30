import { Decimal } from '@tugeel/shared/money';
import { nextPoStatus, poStatusRank, previousPoStatus } from '@tugeel/shared/procurement';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  Check,
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
import { NativeSelect } from '@/components/native-select';
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
  useOrdererCandidates,
  usePurchaseOrderDownloads,
  usePurchaseOrderMutations,
  useSetSupplierOrderer,
} from './api';
import { PoStatusBadge, SupplierTicks } from './parts';

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
  /** The one supplier on screen, if one: its facts and status moves sit in the header. */
  focus: PurchaseOrderSupplier | undefined;
  movePending: boolean;
  onStep: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
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
      {props.focus ? <SupplierStrip supplier={props.focus} canManage={canManage} /> : null}
      <StatusSteps
        suppliers={detail.suppliers}
        focus={props.focus}
        pending={props.movePending}
        onStep={props.onStep}
      />
      {props.focus ? null : (
        <dl
          className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-muted-foreground"
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
      )}
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

/**
 * The focused supplier's facts (owner 2026-10-30): name, status, pieces · kg, the orderer (changed
 * in place by a manager) and the receipt, in the header instead of the group row.
 */
function SupplierStrip({
  supplier,
  canManage,
}: {
  supplier: PurchaseOrderSupplier;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={supplier.supplierName}
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]"
    >
      <span className="text-[1.0625rem] font-semibold">{supplier.supplierName}</span>
      <PoStatusBadge status={supplier.status} />
      <span className="font-mono text-[0.8125rem] text-muted-foreground">
        {t('procurement.detail.piecesKg', {
          pieces: formatQty(supplier.qtyBase),
          kg: formatQty(new Decimal(supplier.weightKg).toDecimalPlaces(1).toString()),
        })}
      </span>
      <span className="flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
        {t('procurement.supplier.orderer')}:
        {canManage ? (
          <OrdererInline supplierId={supplier.supplierId} current={supplier.ordererId} />
        ) : (
          <span className="text-foreground">
            {supplier.ordererName ?? t('procurement.supplier.noOrderer')}
          </span>
        )}
      </span>
      {supplier.receiptId !== null ? (
        <Link
          to={`/inventory/receipts/${supplier.receiptId}`}
          className="font-mono text-[0.8125rem] text-link underline-offset-4 hover:underline"
        >
          {supplier.receiptNumber ??
            t('procurement.supplier.receiptDraft', { id: supplier.receiptId })}
        </Link>
      ) : null}
    </section>
  );
}

function OrdererInline({ supplierId, current }: { supplierId: number; current: number | null }) {
  const { t } = useTranslation();
  const candidates = useOrdererCandidates(true);
  const save = useSetSupplierOrderer(supplierId);
  const action = useAction();
  return (
    <>
      <NativeSelect
        variant="filter"
        aria-label={t('procurement.orderer.field')}
        value={current === null ? '' : String(current)}
        disabled={save.isPending}
        onChange={(event) => {
          const value = event.target.value;
          void action.run(async () => {
            await save.mutateAsync(value === '' ? null : Number.parseInt(value, 10));
          });
        }}
      >
        <option value="">{t('procurement.orderer.none')}</option>
        {(candidates.data ?? []).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.fullName}
          </option>
        ))}
      </NativeSelect>
      <ProblemAlert problem={action.problem} />
    </>
  );
}

/**
 * The seven statuses in order (the order itself has none). Without a focused supplier each shows
 * how many suppliers stand in it; with one, its road: the steps behind it ticked, the current one
 * lit with «Буцаах» and «→ дараагийн» beside it where the rights allow, the next ones muted.
 */
export function StatusSteps(props: {
  suppliers: readonly PurchaseOrderSupplier[];
  focus?: PurchaseOrderSupplier | undefined;
  pending?: boolean;
  onStep?: (supplier: PurchaseOrderSupplier, by: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const { focus } = props;
  const focusRank = focus ? poStatusRank(focus.status) : null;
  const next = focus ? nextPoStatus(focus.status) : null;
  const previous = focus ? previousPoStatus(focus.status) : null;
  return (
    <ol
      className="mb-3 flex flex-wrap items-center gap-y-2"
      aria-label={t('procurement.detail.steps')}
    >
      {PO_STATUSES.map((status, position) => {
        const count = props.suppliers.filter((supplier) => supplier.status === status).length;
        const done = focusRank !== null && position < focusRank;
        const current = focusRank !== null && position === focusRank;
        const lit = focusRank === null ? count > 0 : done || current;
        return (
          <li key={status} className="flex items-center">
            <span
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex h-8 items-center gap-2 rounded-full px-3 text-[0.8125rem]',
                current && 'bg-primary font-semibold text-white shadow-control',
                done && 'bg-success-soft text-success',
                !lit && 'text-muted-foreground',
                lit && !current && !done && 'bg-fill font-medium',
              )}
            >
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[0.6875rem] font-semibold',
                  current ? 'bg-white/25' : done ? 'bg-success text-white' : 'bg-background/80',
                )}
              >
                {done ? <Check aria-hidden className="size-3" /> : position + 1}
              </span>
              {t(`procurement.status.${status}`)}
              {focusRank === null ? (
                <span className="font-mono font-semibold">{formatCount(count)}</span>
              ) : null}
            </span>
            {current && focus ? (
              <span className="ml-1.5 flex items-center gap-1">
                {focus.canMoveBack && previous ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('procurement.supplier.backNamed', { name: focus.supplierName })}
                    disabled={props.pending}
                    onClick={() => props.onStep?.(focus, -1)}
                  >
                    <ArrowLeft />
                    {t('procurement.supplier.backTo', {
                      status: t(`procurement.status.${previous}`),
                    })}
                  </Button>
                ) : null}
                {focus.canMoveNext && next ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={t('procurement.supplier.nextNamed', { name: focus.supplierName })}
                    disabled={props.pending}
                    onClick={() => props.onStep?.(focus, 1)}
                  >
                    <ArrowRight />
                    {t('procurement.supplier.nextTo', { status: t(`procurement.status.${next}`) })}
                  </Button>
                ) : null}
              </span>
            ) : null}
            {position < PO_STATUSES.length - 1 ? (
              <span className="mx-1.5 h-px w-4 bg-border" aria-hidden />
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
