import { Decimal } from '@tugeel/shared/money';
import {
  BOARD_LIMITS,
  CARD_SORTS,
  type CardSort,
  PRINT_KINDS,
  type PrintKind,
} from '@tugeel/shared/sales';
import { ArrowRightLeft, Ellipsis, Plus, Printer } from 'lucide-react';
import { type DragEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import { OrderStatusBadge } from './orders-pages';
import {
  batchPrintPath,
  type FilterQuery,
  openPrint,
  type OrderCard,
  orderPrintPath,
  type SalesPipeline,
  type SalesStage,
  type StageCards,
  useSalesMutations,
  useStageCards,
} from './pipelines-api';

const DRAG_TYPE = 'application/x-tugeel-order';

/**
 * «Самбараар» (ADR-0056 #8, ADR-0057 #7): the pipeline's visible stages as columns in their own
 * sort, the cards dragged (or moved through a menu) from stage to stage; a stage header holds «+»
 * (a new order in a stage without an action) and the stage's «⋯» menu.
 */
export function BoardView({
  pipeline,
  filters,
  canCreate,
  onOpen,
}: {
  pipeline: SalesPipeline;
  filters: FilterQuery;
  canCreate: boolean;
  onOpen: (orderId: number) => void;
}) {
  const { t } = useTranslation();
  const cards = useStageCards(pipeline.id, filters);
  const mover = useMover();
  const stages = pipeline.stages.filter((stage) => stage.archivedAt === null && stage.canView);
  const [over, setOver] = useState<number | null>(null);
  const [printing, setPrinting] = useState<{ stage: SalesStage; column: StageCards } | null>(null);
  const [archiving, setArchiving] = useState<{ stage: SalesStage; what: 'cards' | 'stage' } | null>(
    null,
  );
  const mutations = useSalesMutations();
  const action = useAction();

  const dropOn = (stage: SalesStage) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(null);
    const orderId = Number.parseInt(event.dataTransfer.getData(DRAG_TYPE), 10);
    if (orderId) mover.start(orderId, stage);
  };
  const sort = (stage: SalesStage, value: CardSort) =>
    void action.run(async () => {
      await mutations.sortStage.mutateAsync({ id: stage.id, sort: value });
    });
  const archive = () =>
    void action.run(async () => {
      if (!archiving) return;
      if (archiving.what === 'cards') {
        const result = await mutations.archiveCards.mutateAsync(archiving.stage.id);
        toast.success(t('sales.work.archivedCards', { count: result.archived }));
      } else {
        await mutations.archiveStage.mutateAsync(archiving.stage.id);
        toast.success(t('sales.boards.archived'));
      }
      setArchiving(null);
    });

  return (
    <>
      <ProblemAlert
        problem={problemFromError(cards.error) ?? (archiving ? null : action.problem)}
      />
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
              <header className="flex items-center justify-between gap-1 px-2 py-1">
                <h2 className="min-w-0 truncate text-sm font-semibold">
                  {stage.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {column?.count ?? 0}
                  </span>
                </h2>
                <div className="flex shrink-0 items-center">
                  {canCreate && stage.action === 'NONE' && stage.canMove ? (
                    <Button
                      asChild
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('sales.work.addHere')}: ${stage.name}`}
                    >
                      <Link to={`/sales/orders/new?pipeline=${pipeline.id}&stage=${stage.id}`}>
                        <Plus />
                      </Link>
                    </Button>
                  ) : null}
                  <StageMenu
                    stage={stage}
                    canManage={pipeline.canManage}
                    onSort={(value) => sort(stage, value)}
                    onPrint={() =>
                      setPrinting({
                        stage,
                        column: column ?? { stageId: stage.id, count: 0, total: '0', cards: [] },
                      })
                    }
                    onArchiveCards={() => {
                      action.clear();
                      setArchiving({ stage, what: 'cards' });
                    }}
                    onArchiveStage={() => {
                      action.clear();
                      setArchiving({ stage, what: 'stage' });
                    }}
                  />
                </div>
              </header>
              {column && new Decimal(column.total).gt(0) ? (
                <p className="px-2 pb-1 font-mono text-xs text-muted-foreground">
                  {t('pricing.money', { amount: formatMnt(column.total) })}
                </p>
              ) : null}
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
      <StagePrintDialog printing={printing} onClose={() => setPrinting(null)} />
      <ConfirmDialog
        open={archiving !== null}
        title={
          archiving?.what === 'stage'
            ? t('sales.boards.archiveStageTitle', { name: archiving.stage.name })
            : t('sales.work.archiveCardsTitle', { name: archiving?.stage.name ?? '' })
        }
        description={
          archiving?.what === 'stage'
            ? t('sales.boards.archiveStageDescription')
            : t('sales.work.archiveCardsDescription')
        }
        confirmLabel={t('sales.boards.archive')}
        pending={mutations.archiveCards.isPending || mutations.archiveStage.isPending}
        problem={action.problem}
        onConfirm={archive}
        onClose={() => {
          setArchiving(null);
          action.clear();
        }}
      />
    </>
  );
}

/** A stage's «⋯»: its sort for everyone, printing its cards, archiving finished ones or itself. */
function StageMenu({
  stage,
  canManage,
  onSort,
  onPrint,
  onArchiveCards,
  onArchiveStage,
}: {
  stage: SalesStage;
  canManage: boolean;
  onSort: (sort: CardSort) => void;
  onPrint: () => void;
  onArchiveCards: () => void;
  onArchiveStage: () => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sales.work.stageMenu', { name: stage.name })}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('sales.work.sort')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={stage.cardSort}
          onValueChange={(value) => {
            const sort = CARD_SORTS.find((entry) => entry === value);
            if (sort) onSort(sort);
          }}
        >
          {CARD_SORTS.map((sort) => (
            <DropdownMenuRadioItem key={sort} value={sort} disabled={!stage.canEdit}>
              {t(`sales.cardSorts.${sort}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onPrint}>
          <Printer />
          {t('sales.work.printAll')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!stage.canEdit} onSelect={onArchiveCards}>
          {t('sales.work.archiveCards')}
        </DropdownMenuItem>
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onArchiveStage}>
              {t('sales.work.archiveStage')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
function useMover() {
  const mutations = useSalesMutations();
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
      <Dialog
        open={mover.print !== null}
        onOpenChange={(open) => (open ? undefined : mover.closePrint())}
      >
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('sales.boards.printTitle')}</DialogTitle>
            <DialogDescription>{t('sales.boards.printDescription')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {(mover.print?.kinds ?? []).map((kind) => (
              <Button
                key={kind}
                variant="outline"
                onClick={() => mover.print && openPrint(orderPrintPath(mover.print.orderId, kind))}
              >
                <Printer />
                {t(`sales.printKinds.${kind}`)}
              </Button>
            ))}
          </div>
          <DialogFooter closeLabel={t('common.close')} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * «Баримт хэвлэх» for a whole stage (ADR-0057 #7): the kind, then the stage's cards ticked (at
 * most 100; a delivery note needs prices, so drafts are left out), printed on one page.
 */
function StagePrintDialog({
  printing,
  onClose,
}: {
  printing: { stage: SalesStage; column: StageCards } | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={printing !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {printing ? (
        <StagePrintForm key={printing.stage.id} printing={printing} onClose={onClose} />
      ) : (
        <DialogContent closeLabel={t('common.close')} />
      )}
    </Dialog>
  );
}

function StagePrintForm({
  printing,
  onClose,
}: {
  printing: { stage: SalesStage; column: StageCards };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<PrintKind>('PICK_LIST');
  const cards = printing.column.cards.slice(0, BOARD_LIMITS.maxPrint);
  const printable = (card: OrderCard) => kind === 'PICK_LIST' || card.total !== null;
  const [ticked, setTicked] = useState<ReadonlySet<number>>(
    () => new Set(cards.map((card) => card.id)),
  );
  const chosen = cards.filter((card) => ticked.has(card.id) && printable(card));
  const allTicked = cards.filter(printable).every((card) => ticked.has(card.id));
  return (
    <DialogContent closeLabel={t('common.close')} className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t('sales.work.printTitle', { name: printing.stage.name })}</DialogTitle>
        <DialogDescription>
          {printing.column.count > cards.length
            ? t('sales.work.printFirst', { count: cards.length })
            : t('sales.boards.printDescription')}
        </DialogDescription>
      </DialogHeader>
      <SegmentedControl
        options={PRINT_KINDS}
        value={kind}
        label={(value) => t(`sales.printKinds.${value}`)}
        onChange={setKind}
      />
      {kind === 'DELIVERY_NOTE' && cards.some((card) => !printable(card)) ? (
        <p className="text-xs text-muted-foreground">{t('sales.work.printDraftsSkipped')}</p>
      ) : null}
      <fieldset className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
        <legend className="px-1 text-sm font-medium">{t('sales.work.printChoose')}</legend>
        <div className="flex items-center gap-2 py-1">
          <Checkbox
            id="print-all"
            checked={allTicked}
            onCheckedChange={(next) =>
              setTicked(next === true ? new Set(cards.map((card) => card.id)) : new Set())
            }
          />
          <Label htmlFor="print-all" className="font-normal">
            {t('sales.work.printAllTicked')}
          </Label>
        </div>
        {cards.map((card) => {
          const id = `print-card-${card.id}`;
          const title = card.number ?? t('sales.order.draftNo', { id: card.id });
          return (
            <div key={card.id} className="flex items-center gap-2 py-0.5">
              <Checkbox
                id={id}
                disabled={!printable(card)}
                checked={ticked.has(card.id) && printable(card)}
                onCheckedChange={(next) =>
                  setTicked((current) => {
                    const copy = new Set(current);
                    if (next === true) copy.add(card.id);
                    else copy.delete(card.id);
                    return copy;
                  })
                }
              />
              <Label htmlFor={id} className="min-w-0 font-normal">
                <span className="font-mono">{title}</span>
                <span className="truncate text-muted-foreground"> · {card.customerName}</span>
              </Label>
            </div>
          );
        })}
      </fieldset>
      <DialogFooter closeLabel={t('common.cancel')}>
        <Button
          disabled={chosen.length === 0}
          onClick={() => {
            openPrint(
              batchPrintPath(
                kind,
                chosen.map((card) => card.id),
              ),
            );
            onClose();
          }}
        >
          <Printer />
          {t('sales.work.print', { count: chosen.length })}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
