import { Decimal } from '@tugeel/shared/money';
import type { PrintKind } from '@tugeel/shared/sales';
import { ArrowRightLeft, Plus, Printer, Settings2 } from 'lucide-react';
import { type DragEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { EmptyState } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useBranches } from '@/features/identity/api';
import { formatMnt, plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { type SalesOrder, useSalesOrder } from './api';
import {
  type OrderCard,
  orderPrintPath,
  type SalesBoard,
  type SalesStage,
  useBoardCards,
  useBoardMutations,
  usePickInfo,
  useSalesBoards,
} from './boards-api';
import { OrderStatusBadge, OrderView } from './orders-pages';

const DRAG_TYPE = 'application/x-tugeel-order';

/**
 * «Борлуулалт» → «Самбар» (ADR-0056 #8): the chosen board's stages as columns, its orders as
 * cards dragged (or moved through a menu) from stage to stage; a card opens the order beside the
 * board with the pick form and the documents to print.
 */
export function SalesBoardsPage() {
  const { t } = useTranslation();
  const boards = useSalesBoards();
  const branches = useBranches();
  const canManage = useHasPermission('sales.orders.manage');
  const canConfigure = useHasPermission('sales.boards.manage');
  const [params, setParams] = useSearchParams();
  const wanted = Number.parseInt(params.get('board') ?? '', 10);
  const list = boards.data ?? [];
  const board = list.find((entry) => entry.id === wanted) ?? list[0] ?? null;
  const [openId, setOpenId] = useState<number | null>(
    Number.parseInt(params.get('order') ?? '', 10) || null,
  );

  const choose = (id: number) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set('board', String(id));
        return next;
      },
      { replace: true },
    );
  const branchName = (id: number | null) =>
    id === null
      ? t('sales.boards.noBranch')
      : (branches.data?.find((b) => b.id === id)?.name ?? '');
  const grouped = new Map<string, SalesBoard[]>();
  for (const entry of list) {
    const key = branchName(entry.branchId);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={board ? board.name : t('sales.boards.title')}
        meta={
          list.length > 1 ? (
            <NativeSelect
              aria-label={t('sales.boards.choose')}
              value={board?.id ?? ''}
              onChange={(event) => choose(Number.parseInt(event.target.value, 10))}
            >
              {[...grouped].map(([group, entries]) => (
                <optgroup key={group} label={group}>
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          ) : null
        }
        actions={
          <>
            {canConfigure ? (
              <Button asChild variant="outline">
                <Link to="/sales/boards/settings">
                  <Settings2 />
                  {t('sales.boards.settings')}
                </Link>
              </Button>
            ) : null}
            {canManage ? (
              <Button asChild>
                <Link to={board ? `/sales/orders/new?board=${board.id}` : '/sales/orders/new'}>
                  <Plus />
                  {t('sales.orders.new')}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <ProblemAlert problem={problemFromError(boards.error)} />
      {!boards.isPending && board === null ? (
        <EmptyState
          title={t('sales.boards.empty')}
          action={
            canConfigure ? (
              <Button asChild variant="outline">
                <Link to="/sales/boards/settings">{t('sales.boards.settings')}</Link>
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {board ? <Board board={board} onOpen={setOpenId} /> : null}
      <OrderSheet orderId={openId} board={board} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Board({ board, onOpen }: { board: SalesBoard; onOpen: (id: number) => void }) {
  const { t } = useTranslation();
  const cards = useBoardCards(board.id);
  const mover = useMover(board);
  const stages = board.stages.filter((stage) => stage.archivedAt === null && stage.canView);
  const [over, setOver] = useState<number | null>(null);

  const dropOn = (stage: SalesStage) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(null);
    const orderId = Number.parseInt(event.dataTransfer.getData(DRAG_TYPE), 10);
    if (orderId) mover.start(orderId, stage);
  };

  return (
    <>
      <ProblemAlert problem={problemFromError(cards.error)} />
      <div className="flex gap-3 overflow-x-auto pb-3">
        {stages.map((stage) => {
          const column = cards.data?.find((entry) => entry.stageId === stage.id);
          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              data-over={over === stage.id ? 'true' : undefined}
              className={cn(
                'flex w-72 shrink-0 flex-col rounded-xl bg-black/[0.03] p-2 data-[over=true]:ring-2 data-[over=true]:ring-ring/40',
              )}
              onDragOver={(event) => {
                if (!stage.canMove) return;
                event.preventDefault();
                if (over !== stage.id) setOver(stage.id);
              }}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={stage.canMove ? dropOn(stage) : undefined}
            >
              <header className="flex items-baseline justify-between gap-2 px-2 py-1.5">
                <h2 className="truncate text-sm font-semibold">
                  {stage.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {column?.count ?? 0}
                  </span>
                </h2>
                {column && new Decimal(column.total).gt(0) ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {t('pricing.money', { amount: formatMnt(column.total) })}
                  </span>
                ) : null}
              </header>
              <div className="flex min-h-24 flex-col gap-2">
                {(column?.cards ?? []).map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    stage={stage}
                    stages={stages}
                    onOpen={() => onOpen(card.id)}
                    onMove={(target) => mover.start(card.id, target)}
                  />
                ))}
                {column && column.count > column.cards.length ? (
                  <p className="px-2 text-xs text-muted-foreground">
                    {t('sales.boards.more', { count: column.count - column.cards.length })}
                  </p>
                ) : null}
              </div>
            </section>
          );
        })}
      </div>
      <MoveDialogs mover={mover} />
    </>
  );
}

function Card({
  card,
  stage,
  stages,
  onOpen,
  onMove,
}: {
  card: OrderCard;
  stage: SalesStage;
  stages: SalesStage[];
  onOpen: () => void;
  onMove: (stage: SalesStage) => void;
}) {
  const { t } = useTranslation();
  const targets = stages.filter((entry) => entry.id !== stage.id && entry.canMove);
  const title = card.number ?? t('sales.order.draftNo', { id: card.id });
  return (
    <article
      draggable={targets.length > 0}
      aria-label={title}
      className="rounded-lg border border-border bg-card p-3 text-sm shadow-card"
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(card.id));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="text-left font-medium underline-offset-4 hover:underline"
          onClick={onOpen}
        >
          {title}
        </button>
        {targets.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${t('sales.boards.move')}: ${title}`}
              >
                <ArrowRightLeft />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {targets.map((target) => (
                <DropdownMenuItem key={target.id} onSelect={() => onMove(target)}>
                  {target.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <div className="mt-1 truncate">{card.customerName}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {card.total !== null ? (
          <span className="font-mono text-foreground">
            {t('pricing.money', { amount: formatMnt(card.total) })}
          </span>
        ) : null}
        <span className="font-mono">{card.deliveryDate}</span>
        <OrderStatusBadge status={card.status} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{t(`sales.channels.${card.channel}`)}</span>
        {card.createdByName ? <span>· {card.createdByName}</span> : null}
      </div>
    </article>
  );
}

/** Moving a card: the request, a reason for a CANCEL stage, the documents to print afterwards. */
function useMover(board: SalesBoard) {
  const mutations = useBoardMutations();
  const action = useAction();
  const [pending, setPending] = useState<{ orderId: number; stage: SalesStage } | null>(null);
  const [reason, setReason] = useState('');
  const [print, setPrint] = useState<{ orderId: number; kinds: PrintKind[] } | null>(null);
  const [key, setKey] = useState(randomUuid);

  const run = (orderId: number, stage: SalesStage, why?: string) =>
    void action.run(async () => {
      const result = await mutations.move.mutateAsync({
        orderId,
        key,
        stageId: stage.id,
        reason: why,
      });
      setKey(randomUuid());
      setPending(null);
      setReason('');
      if (result.print.length > 0) setPrint({ orderId, kinds: result.print });
    });
  return {
    board,
    pending,
    reason,
    setReason,
    print,
    problem: action.problem,
    busy: mutations.move.isPending,
    start(orderId: number, stage: SalesStage) {
      action.clear();
      if (stage.action === 'CANCEL') setPending({ orderId, stage });
      else run(orderId, stage);
    },
    confirm() {
      if (pending) run(pending.orderId, pending.stage, reason.trim());
    },
    cancel() {
      setPending(null);
      setReason('');
      action.clear();
    },
    closePrint: () => setPrint(null),
  };
}

function MoveDialogs({ mover }: { mover: ReturnType<typeof useMover> }) {
  const { t } = useTranslation();
  return (
    <>
      <ProblemAlert problem={mover.pending || mover.print ? null : mover.problem} />
      <ConfirmDialog
        open={mover.pending !== null}
        title={t('sales.order.cancelTitle')}
        description={t('sales.order.cancelDescription')}
        confirmLabel={t('sales.order.cancel')}
        disabled={!mover.reason.trim()}
        pending={mover.busy}
        problem={mover.problem}
        onConfirm={() => mover.confirm()}
        onClose={() => mover.cancel()}
      >
        <FormField label={t('sales.order.cancelReason')} htmlFor="board-cancel-reason">
          <Textarea
            id="board-cancel-reason"
            rows={2}
            value={mover.reason}
            onChange={(event) => mover.setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
      <PrintDialog print={mover.print} onClose={mover.closePrint} />
    </>
  );
}

/** Opens the order's printable page in a new tab (ADR-0056 #7); it prints itself. */
function usePrinter() {
  return {
    busy: false,
    open(orderId: number, kind: PrintKind) {
      window.open(orderPrintPath(orderId, kind), '_blank', 'noopener');
    },
  };
}

function PrintDialog({
  print,
  onClose,
}: {
  print: { orderId: number; kinds: PrintKind[] } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const printer = usePrinter();
  return (
    <Dialog open={print !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('sales.boards.printTitle')}</DialogTitle>
          <DialogDescription>{t('sales.boards.printDescription')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {(print?.kinds ?? []).map((kind) => (
            <Button
              key={kind}
              variant="outline"
              disabled={printer.busy}
              onClick={() => print && printer.open(print.orderId, kind)}
            >
              <Printer />
              {t(`sales.printKinds.${kind}`)}
            </Button>
          ))}
        </div>
        <DialogFooter closeLabel={t('common.close')} />
      </DialogContent>
    </Dialog>
  );
}

/** The order beside the board: the pick form for pickers, the documents, the order itself. */
function OrderSheet({
  orderId,
  board,
  onClose,
}: {
  orderId: number | null;
  board: SalesBoard | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const order = useSalesOrder(orderId ?? 0, { enabled: orderId !== null });
  const canPick = useHasPermission('sales.orders.pick');
  const printer = usePrinter();
  const detail = order.data;
  const stage = board?.stages.find((entry) => entry.id === detail?.stageId);
  return (
    <Sheet open={orderId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent closeLabel={t('common.close')} className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {detail ? (detail.number ?? t('sales.order.draftNo', { id: detail.id })) : ''}
          </SheetTitle>
          <SheetDescription>
            {detail ? `${detail.customerName} · ${stage?.name ?? ''}` : ''}
          </SheetDescription>
        </SheetHeader>
        <ProblemAlert problem={problemFromError(order.error)} />
        {detail ? (
          <>
            <div className="flex flex-wrap gap-2">
              {detail.status === 'DRAFT' || detail.status === 'CONFIRMED' ? (
                <Button asChild variant="outline">
                  <Link to={`/sales/orders/${detail.id}`}>{t('sales.boards.openOrder')}</Link>
                </Button>
              ) : null}
              <Button
                variant="outline"
                disabled={printer.busy}
                onClick={() => printer.open(detail.id, 'PICK_LIST')}
              >
                <Printer />
                {t('sales.printKinds.PICK_LIST')}
              </Button>
              {detail.total !== null ? (
                <Button
                  variant="outline"
                  disabled={printer.busy}
                  onClick={() => printer.open(detail.id, 'DELIVERY_NOTE')}
                >
                  <Printer />
                  {t('sales.printKinds.DELIVERY_NOTE')}
                </Button>
              ) : null}
            </div>
            {canPick && (detail.status === 'CONFIRMED' || detail.status === 'PICKING') ? (
              <PickForm order={detail} />
            ) : null}
            <OrderView order={detail} canManage={false} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The picked count and shelf of every line, confirmed at once (ADR-0056 #5). */
function PickForm({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  const info = usePickInfo(order.id);
  const mutations = useBoardMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [lines, setLines] = useState<Record<number, { qty: string; binId: string }>>({});
  useEffect(() => {
    if (!info.data) return;
    setLines(
      Object.fromEntries(
        order.lines.map((line) => {
          const own = info.data?.find((entry) => entry.lineId === line.id);
          return [
            line.id,
            { qty: plainDecimal(line.qtyApproved), binId: String(own?.proposedBinId ?? '') },
          ];
        }),
      ),
    );
  }, [info.data, order.lines]);
  const confirm = () =>
    void action.run(async () => {
      await mutations.pick.mutateAsync({
        orderId: order.id,
        key,
        lines: order.lines.map((line) => ({
          lineId: line.id,
          qty: lines[line.id]?.qty.trim() || '0',
          binId: Number.parseInt(lines[line.id]?.binId ?? '', 10),
        })),
      });
      toast.success(t('sales.pick.done'));
    });
  const complete = order.lines.every((line) => lines[line.id]?.binId);
  return (
    <section className="rounded-xl border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{t('sales.pick.title')}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sales.order.product')}</TableHead>
            <TableHead className="text-right">{t('sales.order.reserved')}</TableHead>
            <TableHead>{t('sales.pick.qty')}</TableHead>
            <TableHead>{t('sales.pick.bin')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.lines.map((line) => {
            const own = info.data?.find((entry) => entry.lineId === line.id);
            return (
              <TableRow key={line.id}>
                <TableCell className="whitespace-normal">{line.productName}</TableCell>
                <TableCell className="text-right font-mono">
                  {t('sales.order.qtyIn', {
                    qty: plainDecimal(line.qtyApproved),
                    unit: line.baseUnitName,
                  })}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`${t('sales.pick.qty')}: ${line.productName}`}
                    inputMode="decimal"
                    className="w-24 text-right font-mono"
                    value={lines[line.id]?.qty ?? ''}
                    onChange={(event) =>
                      setLines((current) => ({
                        ...current,
                        [line.id]: {
                          qty: event.target.value,
                          binId: current[line.id]?.binId ?? '',
                        },
                      }))
                    }
                  />
                </TableCell>
                <TableCell>
                  <NativeSelect
                    aria-label={`${t('sales.pick.bin')}: ${line.productName}`}
                    value={lines[line.id]?.binId ?? ''}
                    onChange={(event) =>
                      setLines((current) => ({
                        ...current,
                        [line.id]: { qty: current[line.id]?.qty ?? '0', binId: event.target.value },
                      }))
                    }
                  >
                    <option value="">{t('sales.pick.chooseBin')}</option>
                    {(own?.bins ?? []).map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {t('sales.pick.binOption', {
                          code: bin.code,
                          onHand: plainDecimal(bin.onHand),
                        })}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ProblemAlert problem={action.problem} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('sales.pick.hint')}</p>
        <Button disabled={!complete || mutations.pick.isPending} onClick={confirm}>
          {t('sales.pick.confirm')}
        </Button>
      </div>
    </section>
  );
}
