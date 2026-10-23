import { Decimal } from '@tugeel/shared/money';
import {
  BOARD_LIMITS,
  CARD_SORTS,
  type CardSort,
  PRINT_KINDS,
  type PrintKind,
} from '@tugeel/shared/sales';
import { AlertTriangle, ArrowRightLeft, Ellipsis, Plus, Printer } from 'lucide-react';
import {
  type DragEvent,
  type MouseEvent,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { SegmentedControl } from '@/components/list';
import { PrintFormatToggle } from '@/components/print-format-toggle';
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
import { formatTugrik } from '@/lib/money';
import { usePrintFormat } from '@/lib/print-format';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { MoveDialogs } from './move-dialogs';
import { OrderStatusBadge, PaymentLabel } from './order-badges';
import {
  batchPrintPath,
  type FilterQuery,
  openPrint,
  type OrderCard,
  type SalesPipeline,
  type SalesStage,
  type StageCards,
  useSalesMutations,
  useStageCards,
} from './pipelines-api';
import { useMover } from './use-mover';

const DRAG_TYPE = 'application/x-tugeel-order';
/** Space kept under the board: the page's bottom padding (`pb-10`). */
const BELOW_BOARD = 40;
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="menuitem"]';

/**
 * «Самбараар» (ADR-0056 #8, ADR-0057 #7): the pipeline's visible stages as columns in their own
 * sort, the cards dragged (or moved through a menu) from stage to stage; a stage header holds its
 * count and total, «+» (a new order in a stage without an action) and the stage's «⋯» menu. On a
 * desktop the board fits the window (ADR-0066): each column scrolls its own cards under its header
 * and the sideways scrollbar stays in view.
 */
export function BoardView({
  pipeline,
  filters,
  canCreate,
  onOpen,
  onNew,
  onShowStage,
}: {
  pipeline: SalesPipeline;
  filters: FilterQuery;
  canCreate: boolean;
  onOpen: (orderId: number) => void;
  /** «+» on a stage: a new order landing there (ADR-0059: the create dialog). */
  onNew: (stageId: number) => void;
  /** «Дахин N карт жагсаалтад»: the list view narrowed to that stage. */
  onShowStage: (stageId: number) => void;
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
  const board = useRef<HTMLDivElement>(null);
  const height = useBoardHeight(board);

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

  const problem = problemFromError(cards.error) ?? (archiving ? null : action.problem);

  return (
    <>
      {problem ? (
        <div className="mb-3">
          <ProblemAlert problem={problem} />
        </div>
      ) : null}
      <div
        ref={board}
        style={height === null ? undefined : { height }}
        className="flex gap-3 overflow-x-auto overscroll-x-contain pb-3"
      >
        {stages.map((stage) => {
          const column = cards.data?.find((entry) => entry.stageId === stage.id);
          const more = column ? column.count - column.cards.length : 0;
          return (
            <section
              key={stage.id}
              aria-label={stage.name}
              data-over={over === stage.id ? 'true' : undefined}
              className="flex min-h-0 w-72 shrink-0 flex-col rounded-xl bg-fill/60 p-2 data-[over=true]:ring-2 data-[over=true]:ring-ring/40"
              onDragOver={(event) => {
                if (!stage.canMove) return;
                event.preventDefault();
                if (over !== stage.id) setOver(stage.id);
              }}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={stage.canMove ? dropOn(stage) : undefined}
            >
              <header className="flex h-9 shrink-0 items-center justify-between gap-1 pr-0.5 pl-2">
                <h2 className="min-w-0 truncate text-sm font-semibold" title={stage.name}>
                  {stage.name}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {column?.count ?? 0}
                  </span>
                </h2>
                <div className="flex shrink-0 items-center">
                  {column && new Decimal(column.total).gt(0) ? (
                    <span className="mr-1 font-mono text-xs text-muted-foreground">
                      {formatTugrik(column.total)}
                    </span>
                  ) : null}
                  {canCreate && stage.action === 'NONE' && stage.canMove ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t('sales.work.addHere')}: ${stage.name}`}
                      title={`${t('sales.work.addHere')}: ${stage.name}`}
                      onClick={() => onNew(stage.id)}
                    >
                      <Plus />
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
              <div className="-mx-1 flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1 py-0.5 [scrollbar-width:thin]">
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
                {more > 0 ? (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-7 shrink-0 self-start px-2"
                    onClick={() => onShowStage(stage.id)}
                  >
                    {t('sales.boards.more', { count: more })}
                  </Button>
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

/**
 * The board's height on a desktop: what the window leaves below its top, so the columns scroll
 * their own cards and the board's sideways scrollbar stays above the window's edge. Phones and
 * tablets keep the board's natural height.
 */
function useBoardHeight(ref: RefObject<HTMLElement | null>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof window.matchMedia !== 'function') return undefined;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const measure = () => {
      if (!desktop.matches) {
        setHeight(null);
        return;
      }
      const top = element.getBoundingClientRect().top + window.scrollY;
      const next = Math.max(360, Math.floor(window.innerHeight - top - BELOW_BOARD));
      setHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    window.addEventListener('resize', measure);
    desktop.addEventListener('change', measure);
    // Content above the board (an alert, the filter chips wrapping) moves it: the main resizes.
    const main = element.closest('main');
    const observer =
      typeof ResizeObserver === 'undefined' || !main ? null : new ResizeObserver(measure);
    if (observer && main) observer.observe(main);
    return () => {
      window.removeEventListener('resize', measure);
      desktop.removeEventListener('change', measure);
      observer?.disconnect();
    };
  }, [ref]);
  return height;
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
          title={t('sales.work.stageMenu', { name: stage.name })}
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

/** A plain left click on the card itself, not on its controls or its menu, with no text selected. */
function opensCard(event: MouseEvent<HTMLElement>): boolean {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return false;
  return !window.getSelection()?.toString();
}

/**
 * A card: a click anywhere opens the order (its number stays the keyboard's button), the «Зөөх»
 * menu moves it without dragging.
 */
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
      className="shrink-0 cursor-pointer rounded-lg border border-border bg-card p-3 text-sm shadow-card transition-shadow hover:shadow-popover has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/30"
      onClick={(event) => {
        if (opensCard(event)) onOpen();
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(card.id));
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <button
            type="button"
            className="text-left font-medium underline-offset-4 outline-none hover:underline"
            onClick={onOpen}
          >
            {title}
          </button>
          <PaymentLabel method={card.paymentMethod} />
        </div>
        {targets.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mt-1 -mr-1 size-7 text-muted-foreground"
                aria-label={`${t('sales.boards.move')}: ${title}`}
                title={`${t('sales.boards.move')}: ${title}`}
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
      {/* The status beside the customer: the money line never wraps, so cards keep one height. */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate" title={card.customerName}>
            {card.customerName}
          </span>
          {card.customerOverdue ? (
            // ADR-0101: the customer's overdue debt, a red reminder that never blocks.
            <span
              role="img"
              className="shrink-0 text-destructive"
              aria-label={t('sales.overdue.amount', {
                amount: formatTugrik(card.customerOverdue.amount),
              })}
              title={t('sales.overdue.amount', {
                amount: formatTugrik(card.customerOverdue.amount),
              })}
            >
              <AlertTriangle className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </span>
        <OrderStatusBadge status={card.status} />
      </div>
      <div className="mt-1 flex items-center gap-x-3 text-xs whitespace-nowrap text-muted-foreground">
        {card.total !== null ? (
          <span className="font-mono text-foreground">{formatTugrik(card.total)}</span>
        ) : null}
        <span className="font-mono">{card.deliveryDate}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
        {card.createdByName ? (
          <span className="text-foreground">
            {t('sales.work.cardCreatedBy', { name: card.createdByName })}
          </span>
        ) : null}
        <span>
          {card.createdByName ? '· ' : ''}
          {t(`sales.channels.${card.channel}`)}
        </span>
      </div>
    </article>
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
  const [format, setFormat] = usePrintFormat();
  const cards = printing.column.cards.slice(0, BOARD_LIMITS.maxPrint);
  const printable = (card: OrderCard) => kind === 'PICK_LIST' || card.total !== null;
  const [ticked, setTicked] = useState<ReadonlySet<number>>(
    () => new Set(cards.map((card) => card.id)),
  );
  const chosen = cards.filter((card) => ticked.has(card.id) && printable(card));
  const allTicked = cards.filter(printable).every((card) => ticked.has(card.id));
  return (
    <DialogContent closeLabel={t('common.close')} size="md">
      <DialogHeader>
        <DialogTitle>{t('sales.work.printTitle', { name: printing.stage.name })}</DialogTitle>
        <DialogDescription>
          {printing.column.count > cards.length
            ? t('sales.work.printFirst', { count: cards.length })
            : t('sales.work.printDescription')}
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          options={PRINT_KINDS}
          value={kind}
          label={(value) => t(`sales.printKinds.${value}`)}
          onChange={setKind}
        />
        <PrintFormatToggle value={format} onChange={setFormat} />
      </div>
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
                format,
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
