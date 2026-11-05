import { BINS_SOON } from '@/lib/features';
import type { ProblemDetails } from '@tugeel/api-client';
import { markupPct } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import {
  BadgePercent,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Pencil,
  Printer,
  ScanBarcode,
  Trash2,
} from 'lucide-react';
import { Popover } from 'radix-ui';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DENSE_FIELDS, DocumentWindow } from '@/components/document-layout';
import { FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import { EmptyState, ListTable, RowAction, RowActions } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { StickyActions } from '@/components/sticky-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SupplierSelect } from '@/features/partners/party-select';
import type { PickedSupplier } from '@/features/partners/supplier-picker';
import { useCurrentPricesOf } from '@/features/pricing/api';
import type { ColumnSpec } from '@/lib/column-layout';
import type { ValidationMessage } from '@/lib/forms';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type ReceiptDetail,
  type ReceiptLine,
  type ReceiptLineRequest,
  type ReceiptLineUpdate,
  type ReceiptPaymentMethod,
  type ReceiptUpdate,
  type ReceiptCostingLine,
  useInventoryMutations,
  useReceiptCosting,
  useReceiptCounterAccounts,
} from './api';
import { type CostEntry, parseMoney } from './helpers';
import { PriceCells, ReceiptTotals } from './receipt-costing';
import { ReceiptDiscountsCard } from './receipt-discounts';
import { type PanelLine, ReceiptLinePanel } from './receipt-line-panel';
import { ReceiptConfirmations, ReceiptNoteCard } from './receipt-note';
import {
  arrivedLines,
  costsChangeable,
  type DiscountDraft,
  discountsOf,
  toDiscountRequest,
  entryOfLine,
  focusNextPrice,
  usePostedCosts,
} from './receipt-prices';
import { DateInput } from '@/components/date-input';

/** The header fields a refusal may name, with the message each shows under its field. */
const FIELD_MESSAGES: Record<string, ValidationMessage> = {
  supplierId: 'validation.required',
  supplierDocDate: 'validation.date',
  note: 'validation.tooLong',
  moneyAccountId: 'validation.moneyAccountRequired',
};

const fieldError = (problem: ProblemDetails | null, path: string): ValidationMessage | undefined =>
  (problem?.errors ?? []).some((error) => error.path === path) ? FIELD_MESSAGES[path] : undefined;

/** A refusal that names no header field shows above the fields. */
const generalProblem = (problem: ProblemDetails | null) =>
  problem && !(problem.errors ?? []).some((error) => error.path in FIELD_MESSAGES) ? problem : null;

/** The page's title, placed by the form with what only the form knows. */
type ReceiptHead = (extra?: { meta?: ReactNode; actions?: ReactNode }) => ReactNode;

/**
 * One goods receipt in one window, after Erkhet's «Бараа материал орлого» (owner 2026-10-18,
 * 2026-10-23, 2026-11-05, 2026-11-06, ADR-0153, ADR-0156). A new receipt and a draft are edited here
 * by any holder of the receipt right: the document's fields in one strip, then one card where the
 * line editor stands under the columns of the lines it fills and the steps close its foot. The number
 * comes with the first save. No warehouse is chosen: each line goes to its product's home warehouse
 * (ADR-0099 #1). A posted one reads as a page, with its prices and discount still open to cost
 * holders.
 */
export function ReceiptForm(props: {
  detail: ReceiptDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
  head: ReceiptHead;
}) {
  const { detail } = props;
  const canManage = useHasPermission('inventory.receipts.manage');
  const editsDraft = canManage && (detail === null || detail.status === 'DRAFT');
  return editsDraft ? (
    <DraftEditor detail={detail} onCreated={props.onCreated} head={props.head} />
  ) : detail ? (
    <ReceiptView detail={detail} head={props.head} />
  ) : null;
}

/** The header card's frame: «Падааны мэдээлэл», a named region. */
function HeaderCard(props: { children: ReactNode; note?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card size="sm" role="region" aria-labelledby="receipt-header-title">
      <CardHeader>
        <CardTitle id="receipt-header-title">{t('inventory.receipt.form.header')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {props.children}
        {props.note}
      </CardContent>
    </Card>
  );
}

const HEADER_GRID = 'grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';
/**
 * The document's fields in one strip over the lines (ADR-0156): the supplier first, where the cursor
 * starts, then the date, the number, the account and the note.
 */
const STRIP_GRID =
  'grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_9.5rem_10rem_minmax(0,1.7fr)_minmax(0,1.1fr)]';
/** Only the lines scroll: the table's own box stops scrolling and its head stays in view. */
const LINES_SCROLLER =
  'min-h-0 flex-1 overflow-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin] [&_[data-slot=table-container]]:overflow-visible';

/** «Үнэ НӨАТ-тэй (10%)…», for cost holders, when the supplier's prices carry VAT. */
function VatNote({ detail }: { detail: ReceiptDetail | null }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  if (!canCost || !detail?.supplierVatPayer || !new Decimal(detail.vatRatePct).gt(0)) return null;
  return (
    <p className="text-[0.8125rem] text-muted-foreground">
      {t('inventory.receipt.form.vatNote', { rate: new Decimal(detail.vatRatePct).toString() })}
    </p>
  );
}

function ReadOnlyHeader({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const none = t('common.none');
  const items: [string, ReactNode][] = [
    [t('inventory.receipt.form.date'), detail.supplierDocDate ?? none],
    [t('inventory.receipts.supplier'), `${detail.supplierName} · ${detail.supplierCode}`],
    [t('inventory.receipt.supplierDocNo'), detail.number ?? none],
    // A number from a sheet or from before ADR-0153.
    ...(detail.supplierDocNo
      ? [[t('inventory.receipt.form.supplierNote'), detail.supplierDocNo] as [string, ReactNode]]
      : []),
    [
      t('inventory.receipt.form.warehouses'),
      detail.warehouses.map((warehouse) => warehouse.name).join(', ') || none,
    ],
    [t('inventory.receipt.form.note'), detail.note ?? none],
    [
      t('inventory.receipt.form.counterAccount'),
      detail.paymentMethod === 'CREDIT'
        ? (detail.counterAccountName ?? t('inventory.receipt.paymentMethods.CREDIT'))
        : (detail.moneyAccountName ?? none),
    ],
  ];
  return (
    <HeaderCard note={<VatNote detail={detail} />}>
      <dl className={HEADER_GRID}>
        {items.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
            <dd className="text-sm break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </HeaderCard>
  );
}

/** A line's delivery-note price per base unit as typed (before the discount), for its markup. */
function piecePrice(line: ReceiptLine): Decimal | null {
  if (line.freeGoods || line.docAmount == null || new Decimal(line.qtyBase).isZero()) return null;
  return new Decimal(line.docAmount).dividedBy(line.qtyBase);
}

/**
 * The lines table: №, code, product, warehouse, shelf, unit, quantity, the price cells for cost
 * holders and the markup on the sale price in force. A receipt sets no sale price (ADR-0153 #7).
 */
function LinesTable(props: {
  lines: readonly ReceiptLine[];
  table: RefObject<HTMLTableElement | null>;
  prices: boolean;
  actions: boolean;
  selectedId?: number | null;
  onSelect?: (line: ReceiptLine) => void;
  /** The line editor under the column heads, with its name (ADR-0156): the head stays in view. */
  entry?: { label: string; rows: ReactNode };
  /** The line just added: it flashes where it landed. */
  landedId?: number | null;
  /** The line being removed: dimmed until the server answers. */
  removingId?: number | null;
  /** The price check (ADR-0115): each line's previous price and the unit price typed now. */
  previous?: {
    of: (line: ReceiptLine) => ReceiptCostingLine | undefined;
    unitPrice: (line: ReceiptLine) => Decimal | null;
  };
  cells: (
    line: ReceiptLine,
    name: string,
  ) => { prices?: ReactNode; actions?: ReactNode; markupBase?: Decimal | null };
}) {
  const { t } = useTranslation();
  const productIds = [...new Set(props.lines.map((line) => line.productId))].slice(0, 200);
  const current = useCurrentPricesOf(productIds, productIds.length > 0);
  const priceOf = new Map((current.data ?? []).map((row) => [row.productId, row.warehousePrice]));
  const expected = props.lines.some((line) => line.expectedQty !== null);
  const check = props.prices && props.previous !== undefined;
  const { entry } = props;
  // A draft's table: narrow enough for a 1366 window with the editor's fields in its columns; free
  // goods are listed apart, so it has no «Бонус» (ADR-0156). The last two columns hold «Хадгалах».
  const draftColumns: ColumnSpec[] = [
    { key: 'lineNo', kind: 'count', width: 2.75 },
    { key: 'sku', kind: 'code', width: 5 },
    { key: 'product', kind: 'text', weight: 3, min: 13 },
    { key: 'warehouse', kind: 'text', weight: 1, min: 10 },
    ...(BINS_SOON ? [] : [{ key: 'bin', kind: 'code', width: 8 } as const]),
    { key: 'unit', kind: 'code', width: 5 },
    ...(expected ? [{ key: 'expected', kind: 'qty', width: 5.5 } as const] : []),
    { key: 'qty', kind: 'qty', width: 5 },
    { key: 'weight', kind: 'qty', width: 5 },
    ...(props.prices
      ? [
          { key: 'unitPrice', kind: 'money', width: 6 } as const,
          { key: 'amount', kind: 'money', width: 6.25 } as const,
          { key: 'markup', kind: 'percent', width: 5.25 } as const,
        ]
      : []),
    { key: 'actions', kind: 'actions', width: props.prices ? 5 : 10 },
  ];
  // One entry per cell, under the same conditions as the header cells (ADR-0119).
  const columns: ColumnSpec[] = entry
    ? draftColumns
    : [
        { key: 'lineNo', kind: 'count', width: 3 },
        { key: 'sku', kind: 'code' },
        { key: 'product', kind: 'text', weight: 3, min: 14 },
        { key: 'warehouse', kind: 'text', weight: 1 },
        ...(BINS_SOON ? [] : [{ key: 'bin', kind: 'code', width: 8 } as const]),
        { key: 'unit', kind: 'text', weight: 1, min: 4 },
        ...(expected ? [{ key: 'expected', kind: 'qty' } as const] : []),
        { key: 'qty', kind: 'qty' },
        { key: 'weight', kind: 'qty' },
        ...(check
          ? [
              { key: 'previous', kind: 'qty', width: 8 } as const,
              { key: 'diff', kind: 'qty' } as const,
            ]
          : []),
        ...(props.prices
          ? [
              { key: 'unitPrice', kind: 'money' } as const,
              { key: 'amount', kind: 'money' } as const,
              { key: 'freeGoods', kind: 'status', width: 6 } as const,
            ]
          : []),
        ...(props.prices ? [{ key: 'markup', kind: 'percent' } as const] : []),
        ...(props.actions ? [{ key: 'actions', kind: 'actions', actions: 2 } as const] : []),
      ];
  return (
    <ListTable ref={props.table} columns={columns}>
      <TableHeader
        aria-label={entry?.label}
        className={
          entry ? 'sticky top-0 z-10 bg-card shadow-[0_1px_0_var(--color-border)]' : undefined
        }
      >
        <TableRow>
          <TableHead className="text-right">{t('inventory.receipt.form.lineNo')}</TableHead>
          <TableHead>{t('inventory.sku')}</TableHead>
          <TableHead>{t('inventory.product')}</TableHead>
          <TableHead>{t('inventory.warehouse')}</TableHead>
          {BINS_SOON ? null : <TableHead>{t('inventory.bin')}</TableHead>}
          <TableHead>{t('inventory.unit')}</TableHead>
          {expected ? (
            <TableHead className="text-right">{t('inventory.receipt.receive.expected')}</TableHead>
          ) : null}
          <TableHead className="text-right">{t('inventory.qty')}</TableHead>
          <TableHead className="text-right">{t('inventory.receipt.form.weightColumn')}</TableHead>
          {check ? (
            <>
              <TableHead className="text-right">{t('inventory.receipt.check.previous')}</TableHead>
              <TableHead className="text-right">{t('inventory.receipt.check.diff')}</TableHead>
            </>
          ) : null}
          {props.prices ? (
            <>
              <TableHead className="text-right">{t('inventory.receipt.form.unitPrice')}</TableHead>
              <TableHead className="text-right">{t('inventory.receipt.form.amount')}</TableHead>
              {entry ? null : <TableHead>{t('inventory.costing.freeGoods')}</TableHead>}
            </>
          ) : null}
          {props.prices ? (
            <TableHead className="text-right">{t('inventory.receipt.form.markup')}</TableHead>
          ) : null}
          {props.actions ? (
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          ) : null}
        </TableRow>
        {entry?.rows}
      </TableHeader>
      <TableBody>
        {props.lines.map((line, index) => {
          const name = t('inventory.productUnit', {
            product: line.productName,
            unit: line.unitName,
          });
          const cells = props.cells(line, name);
          const sale = priceOf.get(line.productId) ?? null;
          const base = cells.markupBase === undefined ? piecePrice(line) : cells.markupBase;
          const markup = sale !== null && base !== null ? markupPct(sale, base) : null;
          return (
            <TableRow
              key={line.id}
              data-state={props.selectedId === line.id ? 'selected' : undefined}
              className={cn(
                props.onSelect && 'cursor-pointer',
                entry && 'data-[state=selected]:bg-secondary/50',
                props.landedId === line.id && 'row-landed motion-reduce:animate-none',
                props.removingId === line.id && 'opacity-50',
              )}
              onClick={(event) => {
                // Fields and buttons inside the row keep their own clicks.
                if (event.target instanceof HTMLElement && event.target.closest('input,button')) {
                  return;
                }
                props.onSelect?.(line);
              }}
            >
              <TableCell className="text-right font-mono text-muted-foreground">
                {index + 1}
              </TableCell>
              <TableCell className="font-mono text-[0.8125rem]">{line.productSku}</TableCell>
              {/* A draft's rows keep one height: the whole name on hover. */}
              <TableCell
                className={entry ? undefined : 'whitespace-normal'}
                title={entry ? line.productName : undefined}
              >
                {line.productName}
              </TableCell>
              <TableCell title={entry ? line.warehouseName : undefined}>
                {line.warehouseName}
              </TableCell>
              {BINS_SOON ? null : <TableCell className="font-mono">{line.binCode}</TableCell>}
              <TableCell>{line.unitName}</TableCell>
              {expected ? (
                <TableCell className="text-right font-mono text-muted-foreground">
                  {line.expectedQty === null ? t('common.none') : formatQty(line.expectedQty)}
                </TableCell>
              ) : null}
              <TableCell className="text-right font-mono">{formatQty(line.enteredQty)}</TableCell>
              <TableCell className="text-right font-mono">
                {line.weightKg
                  ? formatQty(
                      new Decimal(line.weightKg).times(line.qtyBase).toDecimalPlaces(2).toString(),
                    )
                  : t('common.none')}
              </TableCell>
              {props.prices && props.previous ? (
                <PreviousCells line={line} previous={props.previous} />
              ) : null}
              {props.prices ? cells.prices : null}
              {props.prices ? (
                <TableCell className="text-right font-mono">
                  {markup === null ? t('common.none') : `${markup.toFixed(1)}%`}
                </TableCell>
              ) : null}
              {props.actions ? cells.actions : null}
            </TableRow>
          );
        })}
      </TableBody>
    </ListTable>
  );
}

/**
 * The price check's two cells (ADR-0115): the product's price on the receipt posted before this
 * one (per this line's unit, with its date and supplier) and how far the typed price lies from it,
 * highlighted when they differ.
 */
function PreviousCells(props: {
  line: ReceiptLine;
  previous: NonNullable<Parameters<typeof LinesTable>[0]['previous']>;
}) {
  const { t } = useTranslation();
  const before = props.previous.of(props.line);
  const now = props.previous.unitPrice(props.line);
  const was = before?.previousUnitPrice == null ? null : new Decimal(before.previousUnitPrice);
  const diff =
    was === null || now === null || was.isZero() ? null : now.minus(was).dividedBy(was).times(100);
  return (
    <>
      <TableCell
        className="text-right font-mono"
        title={
          before?.previousDate
            ? t('inventory.receipt.check.previousOf', {
                date: before.previousDate,
                supplier: before.previousSupplierName ?? '',
              })
            : undefined
        }
      >
        {was === null ? t('common.none') : formatMnt(was.toString())}
      </TableCell>
      <TableCell className="text-right font-mono">
        {diff === null ? (
          t('common.none')
        ) : diff.isZero() ? (
          <span className="text-success">
            <Check className="inline size-4" aria-hidden />
          </span>
        ) : (
          <Badge variant={diff.gt(0) ? 'warning' : 'default'}>
            {`${diff.gt(0) ? '+' : ''}${diff.toFixed(1)}%`}
          </Badge>
        )}
      </TableCell>
    </>
  );
}

/** «Хэвлэх»: the priced document and the warehouses' lists, each in a new tab. */
function PrintLinks({ id }: { id: number }) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="outline" asChild>
        <Link to={`/inventory/receipts/${id}/print/document`} target="_blank">
          <Printer />
          {t('inventory.receipt.print.document')}
        </Link>
      </Button>
      <Button variant="outline" asChild>
        <Link to={`/inventory/receipts/${id}/print/warehouse`} target="_blank">
          <Printer />
          {t('inventory.receipt.print.warehouse')}
        </Link>
      </Button>
    </>
  );
}

/** «Хэвлэх» at a draft's foot: the same two papers from one button, each in a new tab. */
function PrintMenu({ id }: { id: number }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Printer />
          {t('common.print')}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        <DropdownMenuItem asChild>
          <Link to={`/inventory/receipts/${id}/print/document`} target="_blank">
            {t('inventory.receipt.print.document')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/inventory/receipts/${id}/print/warehouse`} target="_blank">
            {t('inventory.receipt.print.warehouse')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The foot's count and total: a click opens what makes them up (the totals for cost holders, the
 * lines that have no weight), so the window keeps its height.
 */
function SummaryPopover({ detail, count }: { detail: ReceiptDetail | null; count: number }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  const hasLines = (detail?.lines.length ?? 0) > 0;
  const showsTotals = canCost && hasLines && Boolean(detail?.totals);
  const missing = hasLines ? (detail?.weightMissing ?? 0) : 0;
  const summary = <LinesSummary detail={detail} count={count} />;
  if (!detail || (!showsTotals && missing === 0)) {
    return <span className="px-1 font-medium whitespace-nowrap tabular-nums">{summary}</span>;
  }
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" className="-ml-1 gap-1 px-2 tabular-nums">
          {summary}
          <ChevronUp className="opacity-60" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 flex w-96 flex-col gap-3 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-popover outline-none"
        >
          {showsTotals ? <ReceiptTotals detail={detail} stacked /> : null}
          {missing > 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.receipt.form.weightMissing', { count: missing })}
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** «Хадгалж байна» / «Хадгалсан» beside the title: a header field is saved when left. */
function SaveState(props: { saving: boolean; saved: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1 text-[0.8125rem] whitespace-nowrap text-muted-foreground"
    >
      {props.saving ? (
        <>
          <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
          {t('inventory.receipt.form.saving')}
        </>
      ) : props.saved ? (
        <>
          <Check aria-hidden className="size-3.5 text-success" />
          {t('inventory.receipt.form.saved')}
        </>
      ) : null}
    </span>
  );
}

/** «12 мөр · 340.5 кг», under every receipt. */
function LinesSummary({ detail, count }: { detail: ReceiptDetail | null; count: number }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  const weight = detail ? new Decimal(detail.weightKg) : null;
  const total = canCost && detail?.totals ? new Decimal(detail.totals.netTotal) : null;
  return (
    <>
      {t('inventory.linesCount', { count })}
      {total && total.gt(0)
        ? ` · ${t('inventory.receipt.form.summaryTotal', { amount: formatMnt(total.toString()) })}`
        : null}
      {weight && weight.gt(0)
        ? ` · ${t('inventory.receipt.form.weight', { kg: formatQty(weight.toDecimalPlaces(2).toString()) })}`
        : null}
    </>
  );
}

/**
 * A posted receipt (or a draft the user may only read): the header and quantities read-only. Cost
 * holders see the prices and the totals, and change the prices and the discount while the costs
 * wait or until the re-costing deadline, saved at once with «Өртөг хадгалах» or
 * «Хадгалаад дараагийнх».
 */
function ReceiptView({ detail, head }: { detail: ReceiptDetail; head: ReceiptHead }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  const changeable = canCost && costsChangeable(detail);
  const costs = usePostedCosts(detail, changeable);
  const table = useRef<HTMLTableElement>(null);
  const checking = changeable && detail.costingStatus === 'PENDING';
  const costing = useReceiptCosting(detail.id, canCost && detail.status === 'POSTED');
  const previousOf = new Map((costing.data?.lines ?? []).map((line) => [line.lineId, line]));
  const arrived = arrivedLines(detail);
  const notArrived = detail.lines.length - arrived.length;
  /** The unit price the line holds now: typed per unit, else its amount over the quantity. */
  const unitPriceOf = (line: ReceiptLine): Decimal | null => {
    const entry = changeable
      ? costs.entry(line.id)
      : entryOfLine(line, detail.costingStatus === 'COSTED');
    if (entry.free || entry.value.trim() === '') return null;
    const value = new Decimal(entry.value.trim().replace(',', '.'));
    return entry.source === 'unitPrice' ? value : value.dividedBy(line.enteredQty);
  };
  const differing = arrived.filter((line) => {
    const was = previousOf.get(line.id)?.previousUnitPrice;
    const now = unitPriceOf(line);
    return was != null && now !== null && !now.toDecimalPlaces(2).equals(was);
  }).length;

  return (
    <div className="space-y-3">
      {head()}
      <ReadOnlyHeader detail={detail} />
      <Card role="region" aria-labelledby="receipt-lines-title">
        <CardHeader>
          <CardTitle id="receipt-lines-title">{t('inventory.receipt.form.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {checking ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.receipt.check.hint')}
            </p>
          ) : changeable ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.receipt.form.costHint')}
              {detail.costingStatus === 'COSTED' && detail.recostUntil
                ? ` ${t('inventory.costing.recostUntil', { date: detail.recostUntil })}`
                : null}
            </p>
          ) : null}
          <ProblemAlert problem={costs.problem} />
          {canCost && differing > 0 ? (
            <p className="text-[0.8125rem] text-warning">
              {t('inventory.receipt.check.differing', { count: differing })}
            </p>
          ) : null}
          <LinesTable
            lines={arrived.filter((line) => !line.freeGoods)}
            table={table}
            prices={canCost}
            actions={false}
            previous={{ of: (line) => previousOf.get(line.id), unitPrice: unitPriceOf }}
            cells={(line, name) => ({
              prices: (
                <PriceCells
                  name={name}
                  enteredQty={line.enteredQty}
                  entry={
                    changeable
                      ? costs.entry(line.id)
                      : entryOfLine(line, detail.costingStatus === 'COSTED')
                  }
                  editable={changeable}
                  onChange={(patch) => costs.change(line.id, patch)}
                  onEnter={(column, field) => focusNextPrice(table, column, field)}
                  onFree={(free) => costs.change(line.id, { free })}
                />
              ),
            })}
          />
          {notArrived > 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.receipt.check.notArrived', { count: notArrived })}
            </p>
          ) : null}
          {canCost ? <ReceiptTotals detail={detail} /> : null}
          {canCost ? <NoteAmountCheck detail={detail} costs={costs} editable={changeable} /> : null}
        </CardContent>
      </Card>
      {canCost ? (
        <ReceiptDiscountsCard
          lines={arrived}
          discounts={changeable ? costs.discounts : discountsOf(detail)}
          editable={changeable}
          tooLarge={detail.totals?.discountTooLarge}
          onChange={costs.changeDiscounts}
        />
      ) : null}
      <StickyActions
        summary={
          <LinesSummary
            detail={detail}
            count={detail.lines.filter((line) => !line.freeGoods).length}
          />
        }
      >
        <PrintLinks id={detail.id} />
        {changeable ? (
          <>
            <Button
              variant="outline"
              disabled={!costs.complete || costs.pending}
              onClick={() => costs.save(false)}
            >
              {checking
                ? t('inventory.receipt.check.confirm')
                : t('inventory.receipt.form.saveCosts')}
            </Button>
            <Button disabled={!costs.complete || costs.pending} onClick={() => costs.save(true)}>
              {t('inventory.costing.saveAndNext')}
            </Button>
          </>
        ) : null}
      </StickyActions>
      <LeaveGuard
        when={changeable && costs.dirty && !costs.saved}
        title={t('inventory.costing.unsavedTitle')}
        description={t('inventory.costing.unsavedDescription')}
        leaveLabel={t('inventory.costing.leave')}
      />
    </div>
  );
}

/**
 * The delivery note's total beside the payable (ADR-0115): the price check refuses a payable more
 * than 1₮ from it; the accountant may correct the note's total here (sent with the prices).
 */
function NoteAmountCheck(props: {
  detail: ReceiptDetail;
  costs: ReturnType<typeof usePostedCosts>;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { detail, costs } = props;
  const discount = new Decimal(detail.totals?.discountTotal ?? 0);
  const payable = props.editable
    ? costs.total.minus(discount)
    : new Decimal(detail.totals?.netTotal ?? 0);
  const typed = parseMoney(costs.noteAmount);
  const diff = typed === null ? null : payable.minus(typed);
  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <FormField label={t('inventory.receipt.check.noteAmountFor')} htmlFor="receipt-check-note">
        <Input
          id="receipt-check-note"
          inputMode="decimal"
          className="w-40 font-mono"
          disabled={!props.editable}
          value={costs.noteAmount}
          onChange={(event) => costs.changeNoteAmount(event.target.value)}
        />
      </FormField>
      <span className="pb-2 text-muted-foreground">
        {t('inventory.receipt.check.payable')}:{' '}
        <span className="font-mono">{formatMnt(payable.toString())}</span>
      </span>
      {diff === null ? null : diff.abs().lte(1) ? (
        <Badge variant="success" className="mb-2">
          <Check />
          {t('inventory.receipt.check.amountMatch')}
        </Badge>
      ) : (
        <Badge variant="warning" className="mb-2">
          {t('inventory.receipt.check.amountMismatch', { diff: formatMnt(diff.toString()) })}
        </Badge>
      )}
    </div>
  );
}

/** A dialog or sheet over the window; a popover (the search's list, the totals) is not one. */
function modalOpen(): boolean {
  return Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).some(
    (open) =>
      open.getAttribute('data-state') === 'open' &&
      !open.parentElement?.hasAttribute('data-radix-popper-content-wrapper'),
  );
}

/** A line's price fields as the API takes them, from what the panel holds. */
function priceBody(entry: CostEntry, before: CostEntry | null): ReceiptLineUpdate {
  if (entry.free) return { freeGoods: true };
  const value = entry.value.trim();
  if (value === '') {
    // An emptied field clears a price the line had; a new line simply has none.
    if (!before || before.free || before.value === '') return {};
    return before.source === 'unitPrice' ? { docUnitPrice: null } : { docAmount: null };
  }
  const money = parseMoney(value) ?? value;
  return entry.source === 'unitPrice' ? { docUnitPrice: money } : { docAmount: money };
}

/**
 * A new receipt or a draft (owner, 2026-10-11, 2026-10-23, 2026-11-05). Nothing exists until the
 * first line is saved: then the draft is created with the header and that line, takes its number,
 * and the address becomes the draft's, the page staying as it is. Each header change of a draft is
 * saved at once (selects on change, texts when left). Lines come from the panel (ReceiptLinePanel);
 * every add is a line of its own (ADR-0103); a line chosen in the table opens in the panel.
 * Saves run one after another against the latest copy of the draft.
 */
function DraftEditor(props: {
  detail: ReceiptDetail | null;
  onCreated: (id: number) => void;
  head: ReceiptHead;
}) {
  const { detail } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCost = useHasPermission('inventory.costs.manage');
  const mutations = useInventoryMutations();
  const accounts = useReceiptCounterAccounts();
  const action = useAction();
  const table = useRef<HTMLTableElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const productSearch = useRef<HTMLInputElement>(null);
  const [discountsOpen, setDiscountsOpen] = useState(false);
  const [headerSaved, setHeaderSaved] = useState(false);

  // The header as typed; a draft's copy follows the server through the saves below.
  const [supplier, setSupplier] = useState<PickedSupplier | null>(
    detail ? { id: detail.supplierId, code: detail.supplierCode, name: detail.supplierName } : null,
  );
  const [docDate, setDocDate] = useState(detail ? (detail.supplierDocDate ?? '') : businessDate());
  const [note, setNote] = useState(detail?.note ?? '');
  const [method, setMethod] = useState<ReceiptPaymentMethod>(detail?.paymentMethod ?? 'CREDIT');
  const [counter, setCounter] = useState<string | null>(detail?.counterAccountCode ?? null);
  const [headerProblem, setHeaderProblem] = useState<ProblemDetails | null>(null);
  const [required, setRequired] = useState({ supplier: false, account: false });
  const [editing, setEditing] = useState<ReceiptLine | null>(null);

  const draftId = useRef<number | null>(detail?.id ?? null);
  const createKey = useRef(randomUuid());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [postKey, setPostKey] = useState(randomUuid);
  const started = useRef(false);

  const lines = detail?.lines ?? [];
  const bought = lines.filter((line) => !line.freeGoods);

  // A line added shows where it landed: the lines scroll to it and it flashes once.
  const lastId = bought.at(-1)?.id ?? null;
  const [last, setLast] = useState<{ id: number | null; landed: number | null }>({
    id: lastId,
    landed: null,
  });
  if (last.id !== lastId) {
    const added = lastId !== null && (last.id === null || lastId > last.id);
    setLast({ id: lastId, landed: added ? lastId : null });
  }
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box && last.landed !== null) box.scrollTop = box.scrollHeight;
  }, [last.landed]);

  // Ctrl+Enter takes the step, from anywhere in the window (a scanner's Enter comes alone).
  const postByKey = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    if (detail === null || lines.length === 0 || confirm !== null || modalOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    askPost();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => postByKey(event);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // A new receipt starts with the supplier.
  useEffect(() => {
    if (detail !== null || started.current) return;
    started.current = true;
    const field = document.getElementById('receipt-supplier');
    if (field instanceof HTMLInputElement) field.focus();
  }, [detail]);

  /** Saves a header change of a draft, after the saves queued before it; a refusal undoes it. */
  const patchHeader = (body: ReceiptUpdate, undo?: () => void) => {
    setHeaderProblem(null);
    chain.current = chain.current.then(async () => {
      const id = draftId.current;
      if (id === null) return;
      try {
        await mutations.updateReceipt.mutateAsync({ id, body });
        setHeaderSaved(true);
      } catch (error) {
        setHeaderSaved(false);
        setHeaderProblem(problemFromError(error));
        undo?.();
      }
    });
  };

  /**
   * Creates the draft from the header (and its first line), then takes the draft's address. A
   * refusal that names a header field shows on that field and the draft stays unmade (false).
   */
  const createDraft = async (first?: ReceiptLineRequest): Promise<boolean> => {
    if (supplier === null) return false;
    try {
      const receipt = await mutations.createReceipt.mutateAsync({
        key: createKey.current,
        supplierId: supplier.id,
        ...(docDate ? { supplierDocDate: docDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        paymentMethod: method,
        ...(counter === null ? {} : { counterAccountCode: counter }),
        ...(first ? { lines: [first] } : {}),
      });
      draftId.current = receipt.id;
      props.onCreated(receipt.id);
      await navigate(`/inventory/receipts/${receipt.id}`, { replace: true });
      return true;
    } catch (error) {
      // A refused draft is a new intent once the form changes.
      createKey.current = randomUuid();
      const problem = problemFromError(error);
      if (generalProblem(problem) !== null) throw error;
      setHeaderProblem(problem);
      return false;
    }
  };

  /**
   * The panel's line: a new line (with the draft when there is none yet) or the line being edited
   * (`asNew`: the free goods' panel always adds). False while the header lacks its supplier.
   */
  const submitLine = (line: PanelLine, asNew = false): Promise<boolean> =>
    new Promise((resolve) => {
      if (draftId.current === null && supplier === null) {
        setRequired((previous) => ({ ...previous, supplier: true }));
        resolve(false);
        return;
      }
      let made = true;
      chain.current = chain.current.then(() =>
        action
          .run(async () => {
            if (editing && !asNew) {
              await mutations.updateReceiptLine.mutateAsync({
                id: editing.id,
                body: {
                  enteredQty: line.enteredQty,
                  ...(line.price ? priceBody(line.price, entryOfLine(editing, false)) : {}),
                },
              });
              setEditing(null);
              return;
            }
            const prices = line.price ? priceBody(line.price, null) : {};
            const id = draftId.current;
            if (id === null) {
              made = await createDraft({
                productUnitId: line.productUnitId,
                enteredQty: line.enteredQty,
                ...(line.warehouseId === undefined ? {} : { warehouseId: line.warehouseId }),
                ...prices,
              });
              return;
            }
            // Every add is a line of its own (owner, 2026-10-23, ADR-0103).
            await mutations.addReceiptLine.mutateAsync({
              id,
              body: {
                productUnitId: line.productUnitId,
                enteredQty: line.enteredQty,
                ...(line.warehouseId === undefined ? {} : { warehouseId: line.warehouseId }),
                ...prices,
              },
            });
          })
          .then((done) => resolve(done && made))
          .catch(() => resolve(false)),
      );
    });

  const askPost = () => {
    if (method !== 'CREDIT' && detail?.moneyAccountId == null) {
      setRequired((previous) => ({ ...previous, account: true }));
      return;
    }
    setPostKey(randomUuid());
    action.clear();
    setConfirm('post');
  };
  const post = () =>
    void action.run(async () => {
      const id = draftId.current;
      if (id === null) return;
      try {
        const posted = await mutations.postReceipt.mutateAsync({ id, key: postKey });
        setConfirm(null);
        // The keeper confirms their warehouses; the last confirmation posts (ADR-0115).
        toast.success(
          posted.status === 'POSTED'
            ? t('inventory.receipt.receive.posted', { number: posted.number ?? '' })
            : t('inventory.receipt.receive.confirmed'),
        );
      } catch (error) {
        // A missing or refused account belongs to its field in the header.
        const problem = problemFromError(error);
        if (fieldError(problem, 'moneyAccountId') === undefined) throw error;
        setConfirm(null);
        setHeaderProblem(problem);
      }
    });
  const cancel = () =>
    void action.run(async () => {
      const id = draftId.current;
      if (id === null) return;
      await mutations.cancelReceipt.mutateAsync(id);
      setConfirm(null);
      await navigate('/inventory/receipts');
    });

  /** «Харилцсан данс» (ADR-0154): the account the bill credits, always a payable. */
  const changeCounter = (code: string) => {
    const before = { method, counter };
    setMethod('CREDIT');
    setCounter(code);
    setRequired((previous) => ({ ...previous, account: false }));
    patchHeader({ paymentMethod: 'CREDIT', counterAccountCode: code }, () => {
      setMethod(before.method);
      setCounter(before.counter);
    });
  };

  const leaveNote = (value: string) => {
    if (detail === null) return;
    const text = value.trim();
    if (text === (detail.note ?? '')) return;
    patchHeader({ note: text || null });
  };

  const supplierError = required.supplier
    ? 'validation.required'
    : fieldError(headerProblem, 'supplierId');
  const accountError = required.account
    ? 'validation.moneyAccountRequired'
    : fieldError(headerProblem, 'moneyAccountId');

  const strip = (
    <Card
      size="sm"
      role="region"
      aria-label={t('inventory.receipt.form.header')}
      className="shrink-0 gap-0 py-2"
    >
      <CardContent className={DENSE_FIELDS}>
        <div className={STRIP_GRID}>
          <FormField
            label={t('inventory.receipts.supplier')}
            htmlFor="receipt-supplier"
            error={supplierError}
          >
            <SupplierSelect
              id="receipt-supplier"
              value={supplier}
              invalid={supplierError !== undefined}
              onChange={(next) => {
                const before = supplier;
                setSupplier(next);
                if (next) {
                  setRequired((previous) => ({ ...previous, supplier: false }));
                  if (next.id !== detail?.supplierId) {
                    patchHeader({ supplierId: next.id }, () => setSupplier(before));
                  }
                  // The supplier chosen, the next thing is its first product.
                  if (lines.length === 0) {
                    window.setTimeout(() => productSearch.current?.focus(), 0);
                  }
                }
              }}
            />
          </FormField>
          <FormField
            label={t('inventory.receipt.form.date')}
            htmlFor="receipt-date"
            error={fieldError(headerProblem, 'supplierDocDate')}
          >
            <DateInput
              id="receipt-date"
              value={docDate}
              onChange={(value) => setDocDate(value)}
              onBlur={() => {
                if (detail !== null && docDate !== (detail.supplierDocDate ?? '')) {
                  patchHeader({ supplierDocDate: docDate || null });
                }
              }}
            />
          </FormField>
          <FormField label={t('inventory.receipt.supplierDocNo')} htmlFor="receipt-number">
            <Input
              id="receipt-number"
              readOnly
              tabIndex={-1}
              title={detail?.number ?? undefined}
              className="border-transparent bg-muted/60 font-mono shadow-none"
              placeholder={t('inventory.receipt.form.numberOnSave')}
              value={detail?.number ?? ''}
            />
          </FormField>
          <FormField
            label={t('inventory.receipt.form.counterAccount')}
            htmlFor="receipt-counter"
            error={accountError}
          >
            <SearchSelect
              id="receipt-counter"
              invalid={accountError !== undefined}
              value={
                method === 'CREDIT'
                  ? (counter ?? accounts.data?.find((row) => row.isDefault)?.code ?? '')
                  : ''
              }
              chosenLabel={method === 'CREDIT' ? undefined : (detail?.moneyAccountName ?? '')}
              options={(accounts.data ?? []).map((row) => ({
                value: row.code,
                label: `${row.code} · ${row.name}`,
                keys: [row.code],
              }))}
              placeholder={t('inventory.receipt.form.pickAccount')}
              onChange={changeCounter}
            />
          </FormField>
          <FormField
            label={t('inventory.receipt.form.note')}
            htmlFor="receipt-note"
            error={fieldError(headerProblem, 'note')}
          >
            <Input
              id="receipt-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={() => leaveNote(note)}
            />
          </FormField>
        </div>
      </CardContent>
    </Card>
  );

  const discounts = detail ? discountsOf(detail) : [];
  const freeCount = lines.length - bought.length;
  const expected = bought.some((line) => line.expectedQty !== null);

  return (
    <DocumentWindow>
      {props.head({
        meta: detail ? <ReceiptConfirmations detail={detail} /> : null,
        actions: (
          <>
            <VatNote detail={detail} />
            <SaveState saving={mutations.updateReceipt.isPending} saved={headerSaved} />
          </>
        ),
      })}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <ProblemAlert problem={generalProblem(headerProblem)} />
        <ProblemAlert problem={problemFromError(accounts.error)} onRetry={accounts.refetch} />
        {strip}
        <Card
          size="sm"
          role="region"
          aria-label={t('inventory.receipt.form.linesTitle')}
          className="min-h-0 flex-1 gap-0 py-0"
        >
          <div ref={scroller} className={LINES_SCROLLER}>
            <LinesTable
              lines={bought}
              table={table}
              prices={canCost}
              actions
              selectedId={editing?.id ?? null}
              onSelect={(line) => setEditing(line)}
              landedId={last.landed}
              removingId={
                mutations.removeReceiptLine.isPending ? mutations.removeReceiptLine.variables : null
              }
              entry={{
                label: editing
                  ? t('inventory.receipt.panel.editTitle')
                  : t('inventory.receipt.panel.title'),
                rows: (
                  <ReceiptLinePanel
                    supplierId={supplier?.id}
                    editing={editing}
                    primary={lines.length === 0}
                    expected={expected}
                    searchInput={productSearch}
                    pending={
                      mutations.createReceipt.isPending ||
                      mutations.addReceiptLine.isPending ||
                      mutations.updateReceiptLine.isPending
                    }
                    problem={
                      confirm || discountsOpen ? null : <ProblemAlert problem={action.problem} />
                    }
                    onSubmit={submitLine}
                    onCancelEdit={() => setEditing(null)}
                  />
                ),
              }}
              cells={(line, name) => ({
                prices: (
                  <PriceCells
                    name={name}
                    enteredQty={line.enteredQty}
                    entry={entryOfLine(line, false)}
                    editable={false}
                    noFreeCell
                  />
                ),
                actions: (
                  <RowActions>
                    <RowAction
                      label={`${t('common.edit')}: ${name}`}
                      icon={Pencil}
                      onClick={() => setEditing(line)}
                    />
                    <RowAction
                      label={`${t('inventory.remove')}: ${name}`}
                      icon={Trash2}
                      destructive
                      onClick={() => {
                        if (editing?.id === line.id) setEditing(null);
                        void action.run(() => mutations.removeReceiptLine.mutateAsync(line.id));
                      }}
                    />
                  </RowActions>
                ),
              })}
            />
            {bought.length === 0 ? (
              <EmptyState title={t('inventory.receipt.linesEmpty')} icon={ScanBarcode} />
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border bg-card px-3 py-1.5 text-[0.8125rem]">
            <SummaryPopover detail={detail} count={bought.length} />
            {detail ? <ReceiptNoteCard detail={detail} editable inline /> : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canCost && detail ? (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    detail.totals?.discountTooLarge && 'border-destructive text-destructive',
                  )}
                  onClick={() => {
                    action.clear();
                    setDiscountsOpen(true);
                  }}
                >
                  <BadgePercent />
                  {t('inventory.receipt.discounts.open')}
                  {discounts.length + freeCount > 0 ? (
                    <Badge variant="secondary" className="tabular-nums">
                      {discounts.length + freeCount}
                    </Badge>
                  ) : null}
                </Button>
              ) : null}
              {detail ? <PrintMenu id={detail.id} /> : null}
              {detail?.lines.some((line) => line.expectedQty !== null) ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/inventory/receipts/${detail.id}/receive`}>
                    <ScanBarcode />
                    {t('inventory.receipt.receive.open')}
                  </Link>
                </Button>
              ) : null}
              {detail && detail.origin !== 'ORDER' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    action.clear();
                    setConfirm('cancel');
                  }}
                >
                  {t('inventory.receipt.cancel')}
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={lines.length === 0}
                aria-keyshortcuts="Control+Enter"
                onClick={askPost}
              >
                {t('inventory.receipt.post')}
                <Kbd>{t('inventory.receipt.panel.keys.post')}</Kbd>
              </Button>
            </div>
          </div>
        </Card>
      </div>
      {canCost && detail ? (
        <Sheet open={discountsOpen} onOpenChange={setDiscountsOpen}>
          <SheetContent aria-describedby={undefined} className="sm:max-w-3xl">
            <SheetTitle className="sr-only">{t('inventory.receipt.discounts.title')}</SheetTitle>
            <ProblemAlert problem={action.problem} />
            <ReceiptDiscountsCard
              plain
              lines={lines}
              discounts={discounts}
              editable
              pending={mutations.setReceiptDiscounts.isPending}
              tooLarge={detail.totals?.discountTooLarge}
              onChange={(next: DiscountDraft[]) =>
                void action.run(() =>
                  mutations.setReceiptDiscounts.mutateAsync({
                    id: detail.id,
                    discounts: next.map(toDiscountRequest),
                  }),
                )
              }
              free={{
                supplierId: supplier?.id,
                pending: mutations.addReceiptLine.isPending,
                onAdd: (line) => submitLine(line, true),
                onRemove: (lineId) =>
                  void action.run(() => mutations.removeReceiptLine.mutateAsync(lineId)),
              }}
            />
          </SheetContent>
        </Sheet>
      ) : null}
      <ConfirmDialog
        open={confirm === 'post'}
        variant="default"
        title={t('inventory.receipt.postTitle')}
        description={t('inventory.receipt.postDescription')}
        confirmLabel={t('inventory.receipt.post')}
        pending={mutations.postReceipt.isPending}
        problem={action.problem}
        onConfirm={post}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.receipt.cancelTitle')}
        confirmLabel={t('inventory.receipt.cancel')}
        pending={mutations.cancelReceipt.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </DocumentWindow>
  );
}
