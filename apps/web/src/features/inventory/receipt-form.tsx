import type { ProblemDetails } from '@tugeel/api-client';
import { markupPct } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Pencil, Printer, Trash2 } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import { RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { StickyActions } from '@/components/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import { useCurrentPricesOf } from '@/features/pricing/api';
import type { ValidationMessage } from '@/lib/forms';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type ReceiptDetail,
  type ReceiptLine,
  type ReceiptLineRequest,
  type ReceiptLineUpdate,
  type ReceiptPaymentMethod,
  type ReceiptUpdate,
  useInventoryMutations,
  useReceiptPaymentAccounts,
} from './api';
import { type CostEntry, parseMoney } from './helpers';
import { PriceCells, ReceiptTotals } from './receipt-costing';
import { ReceiptDiscountsCard } from './receipt-discounts';
import { type PanelLine, ReceiptLinePanel } from './receipt-line-panel';
import {
  costsChangeable,
  type DiscountDraft,
  discountsOf,
  toDiscountRequest,
  entryOfLine,
  focusNextPrice,
  usePostedCosts,
} from './receipt-prices';

const PAYMENT_METHODS: readonly ReceiptPaymentMethod[] = ['CREDIT', 'CASH', 'BANK'];

/** The header fields a refusal may name, with the message each shows under its field. */
const FIELD_MESSAGES: Record<string, ValidationMessage> = {
  supplierId: 'validation.required',
  supplierDocDate: 'validation.date',
  supplierDocNo: 'validation.tooLong',
  note: 'validation.tooLong',
  moneyAccountId: 'validation.moneyAccountRequired',
};

const fieldError = (problem: ProblemDetails | null, path: string): ValidationMessage | undefined =>
  (problem?.errors ?? []).some((error) => error.path === path) ? FIELD_MESSAGES[path] : undefined;

/** A refusal that names no header field shows above the fields. */
const generalProblem = (problem: ProblemDetails | null) =>
  problem && !(problem.errors ?? []).some((error) => error.path in FIELD_MESSAGES) ? problem : null;

/**
 * One goods receipt in one window, after Erkhet's «Бараа материал орлого» (owner 2026-10-18,
 * 2026-10-23): the delivery note's header on top, the line panel, the lines below. No warehouse is
 * chosen: each line goes to its product's home warehouse (ADR-0099 #1). A new receipt and a draft
 * are edited here by any holder of the receipt right; a posted one reads the same way, with its
 * prices and discount still open to cost holders.
 */
export function ReceiptForm(props: {
  detail: ReceiptDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { detail } = props;
  const canManage = useHasPermission('inventory.receipts.manage');
  const editsDraft = canManage && (detail === null || detail.status === 'DRAFT');
  return editsDraft ? (
    <DraftEditor detail={detail} onCreated={props.onCreated} />
  ) : detail ? (
    <ReceiptView detail={detail} />
  ) : null;
}

/** The header card's frame: «Падааны мэдээлэл», a named region. */
function HeaderCard(props: { children: ReactNode; note?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card role="region" aria-labelledby="receipt-header-title">
      <CardHeader>
        <CardTitle id="receipt-header-title">{t('inventory.receipt.form.header')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {props.children}
        {props.note}
      </CardContent>
    </Card>
  );
}

const HEADER_GRID = 'grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4';
/**
 * The draft's six fields (date, supplier, delivery note, note, payment, account) in one row from
 * `xl`, so a 1366 laptop shows the first lines (ADR-0113).
 */
const EDITOR_GRID =
  'grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[9.5rem_minmax(13rem,2fr)_minmax(7rem,1fr)_minmax(8rem,1.2fr)_minmax(10rem,1fr)_minmax(8.5rem,1fr)]';

/** «Үнэ НӨАТ-тэй (10%)…», for cost holders, when the supplier's prices carry VAT. */
function VatNote({ detail }: { detail: ReceiptDetail | null }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  if (!canCost || !detail?.supplierVatPayer || !new Decimal(detail.vatRatePct).gt(0)) return null;
  return (
    <p className="text-[13px] text-muted-foreground">
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
    [t('inventory.receipt.supplierDocNo'), detail.supplierDocNo ?? none],
    [
      t('inventory.receipt.form.warehouses'),
      detail.warehouses.map((warehouse) => warehouse.name).join(', ') || none,
    ],
    [t('inventory.receipt.form.note'), detail.note ?? none],
    [
      t('inventory.receipt.form.payment'),
      t(`inventory.receipt.paymentMethods.${detail.paymentMethod}`),
    ],
    ...(detail.paymentMethod === 'CREDIT'
      ? []
      : [
          [t('inventory.receipt.form.account'), detail.moneyAccountName ?? none] as [
            string,
            ReactNode,
          ],
        ]),
  ];
  return (
    <HeaderCard note={<VatNote detail={detail} />}>
      <dl className={HEADER_GRID}>
        {items.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
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
 * holders, the sale price per piece (a new one bold, else the one in force) and the markup.
 */
function LinesTable(props: {
  lines: readonly ReceiptLine[];
  table: RefObject<HTMLTableElement | null>;
  prices: boolean;
  actions: boolean;
  selectedId?: number | null;
  onSelect?: (line: ReceiptLine) => void;
  cells: (
    line: ReceiptLine,
    name: string,
  ) => { prices?: ReactNode; actions?: ReactNode; markupBase?: Decimal | null };
}) {
  const { t } = useTranslation();
  const productIds = [...new Set(props.lines.map((line) => line.productId))].slice(0, 200);
  const current = useCurrentPricesOf(productIds, productIds.length > 0);
  const priceOf = new Map((current.data ?? []).map((row) => [row.productId, row.warehousePrice]));
  return (
    <Table ref={props.table}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 text-right">{t('inventory.receipt.form.lineNo')}</TableHead>
          <TableHead>{t('inventory.sku')}</TableHead>
          <TableHead>{t('inventory.product')}</TableHead>
          <TableHead>{t('inventory.warehouse')}</TableHead>
          <TableHead>{t('inventory.bin')}</TableHead>
          <TableHead>{t('inventory.unit')}</TableHead>
          <TableHead className="text-right">{t('inventory.qty')}</TableHead>
          <TableHead className="text-right">{t('inventory.receipt.form.weightColumn')}</TableHead>
          {props.prices ? (
            <>
              <TableHead className="text-right">{t('inventory.receipt.form.unitPrice')}</TableHead>
              <TableHead className="text-right">{t('inventory.receipt.form.amount')}</TableHead>
              <TableHead>{t('inventory.costing.freeGoods')}</TableHead>
            </>
          ) : null}
          <TableHead className="text-right">{t('inventory.receipt.form.salePrice')}</TableHead>
          {props.prices ? (
            <TableHead className="text-right">{t('inventory.receipt.form.markup')}</TableHead>
          ) : null}
          {props.actions ? (
            <TableHead>
              <span className="sr-only">{t('common.actions')}</span>
            </TableHead>
          ) : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.lines.map((line, index) => {
          const name = t('inventory.productUnit', {
            product: line.productName,
            unit: line.unitName,
          });
          const cells = props.cells(line, name);
          const sale = line.salePrice ?? priceOf.get(line.productId) ?? null;
          const base = cells.markupBase === undefined ? piecePrice(line) : cells.markupBase;
          const markup = sale !== null && base !== null ? markupPct(sale, base) : null;
          return (
            <TableRow
              key={line.id}
              data-state={props.selectedId === line.id ? 'selected' : undefined}
              className={props.onSelect ? 'cursor-pointer' : undefined}
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
              <TableCell className="font-mono text-[13px]">{line.productSku}</TableCell>
              <TableCell className="min-w-40 whitespace-normal">{line.productName}</TableCell>
              <TableCell>{line.warehouseName}</TableCell>
              <TableCell className="font-mono">{line.binCode}</TableCell>
              <TableCell>{line.unitName}</TableCell>
              <TableCell className="text-right font-mono">{formatQty(line.enteredQty)}</TableCell>
              <TableCell className="text-right font-mono">
                {line.weightKg
                  ? formatQty(
                      new Decimal(line.weightKg).times(line.qtyBase).toDecimalPlaces(2).toString(),
                    )
                  : t('common.none')}
              </TableCell>
              {props.prices ? cells.prices : null}
              <TableCell className="text-right font-mono">
                {sale === null ? (
                  t('common.none')
                ) : line.salePrice ? (
                  <span className="font-semibold" title={t('inventory.receipt.form.newSalePrice')}>
                    {formatMnt(sale)}
                  </span>
                ) : (
                  formatMnt(sale)
                )}
              </TableCell>
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
    </Table>
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

/** «12 мөр · 340.5 кг», under every receipt. */
function LinesSummary({ detail, count }: { detail: ReceiptDetail | null; count: number }) {
  const { t } = useTranslation();
  const weight = detail ? new Decimal(detail.weightKg) : null;
  return (
    <>
      {t('inventory.linesCount', { count })}
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
function ReceiptView({ detail }: { detail: ReceiptDetail }) {
  const { t } = useTranslation();
  const canCost = useHasPermission('inventory.costs.manage');
  const changeable = canCost && costsChangeable(detail);
  const costs = usePostedCosts(detail, changeable);
  const table = useRef<HTMLTableElement>(null);

  return (
    <>
      <ReadOnlyHeader detail={detail} />
      <Card role="region" aria-labelledby="receipt-lines-title">
        <CardHeader>
          <CardTitle id="receipt-lines-title">{t('inventory.receipt.form.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {changeable ? (
            <p className="text-[13px] text-muted-foreground">
              {t('inventory.receipt.form.costHint')}
              {detail.costingStatus === 'COSTED' && detail.recostUntil
                ? ` ${t('inventory.costing.recostUntil', { date: detail.recostUntil })}`
                : null}
            </p>
          ) : null}
          <ProblemAlert problem={costs.problem} />
          <LinesTable
            lines={detail.lines.filter((line) => !line.freeGoods)}
            table={table}
            prices={canCost}
            actions={false}
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
          {canCost ? <ReceiptTotals detail={detail} /> : null}
        </CardContent>
      </Card>
      {canCost ? (
        <ReceiptDiscountsCard
          lines={detail.lines}
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
              {t('inventory.receipt.form.saveCosts')}
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
    </>
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
 * A new receipt or a draft (owner, 2026-10-11 and 2026-10-23). Nothing exists until the first line
 * is added or «Хадгалах» is pressed: then the draft is created with the header (and that line) and
 * the address becomes the draft's, the page staying as it is. Each header change of a draft is
 * saved at once (selects on change, texts when left). Lines come from the panel (ReceiptLinePanel);
 * every add is a line of its own (ADR-0103); a line chosen in the table opens in the panel.
 * Saves run one after another against the latest copy of the draft.
 */
function DraftEditor(props: { detail: ReceiptDetail | null; onCreated: (id: number) => void }) {
  const { detail } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCost = useHasPermission('inventory.costs.manage');
  const mutations = useInventoryMutations();
  const accounts = useReceiptPaymentAccounts();
  const action = useAction();
  const table = useRef<HTMLTableElement>(null);

  // The header as typed; a draft's copy follows the server through the saves below.
  const [supplier, setSupplier] = useState<PickedSupplier | null>(
    detail ? { id: detail.supplierId, code: detail.supplierCode, name: detail.supplierName } : null,
  );
  const [docDate, setDocDate] = useState(detail ? (detail.supplierDocDate ?? '') : businessDate());
  const [docNo, setDocNo] = useState(detail?.supplierDocNo ?? '');
  const [note, setNote] = useState(detail?.note ?? '');
  const [method, setMethod] = useState<ReceiptPaymentMethod>(detail?.paymentMethod ?? 'CREDIT');
  const [accountId, setAccountId] = useState<number | null>(detail?.moneyAccountId ?? null);
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
  const methodAccounts = (accounts.data ?? []).filter((account) => account.kind === method);

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
      } catch (error) {
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
        ...(docNo.trim() ? { supplierDocNo: docNo.trim() } : {}),
        ...(docDate ? { supplierDocDate: docDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        paymentMethod: method,
        ...(method !== 'CREDIT' && accountId !== null ? { moneyAccountId: accountId } : {}),
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
            const sale = line.salePrice === null ? {} : { salePrice: line.salePrice || null };
            if (editing && !asNew) {
              await mutations.updateReceiptLine.mutateAsync({
                id: editing.id,
                body: {
                  enteredQty: line.enteredQty,
                  ...(line.price ? priceBody(line.price, entryOfLine(editing, false)) : {}),
                  ...sale,
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
                ...(line.salePrice ? { salePrice: line.salePrice } : {}),
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
                ...(line.salePrice ? { salePrice: line.salePrice } : {}),
              },
            });
          })
          .then((done) => resolve(done && made))
          .catch(() => resolve(false)),
      );
    });

  /** «Хадгалах» on a new receipt: the draft with its header alone. */
  const saveNew = () => {
    if (supplier === null) {
      setRequired((previous) => ({ ...previous, supplier: true }));
      return;
    }
    chain.current = chain.current.then(() =>
      action.run(async () => {
        if (draftId.current === null) await createDraft();
      }),
    );
  };

  const askPost = () => {
    if (method !== 'CREDIT' && accountId === null) {
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
        toast.success(t('inventory.receipt.posted', { number: posted.number ?? '' }));
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

  const changeMethod = (next: ReceiptPaymentMethod) => {
    const before = { method, accountId };
    const only = (accounts.data ?? []).filter((account) => account.kind === next);
    const account = next === 'CREDIT' || only.length !== 1 ? null : (only[0]?.id ?? null);
    setMethod(next);
    setAccountId(account);
    setRequired((previous) => ({ ...previous, account: false }));
    patchHeader(
      next === 'CREDIT'
        ? { paymentMethod: next }
        : { paymentMethod: next, moneyAccountId: account },
      () => {
        setMethod(before.method);
        setAccountId(before.accountId);
      },
    );
  };

  const leaveText = (field: 'supplierDocNo' | 'note', value: string) => {
    if (detail === null) return;
    const text = value.trim();
    if (text === (detail[field] ?? '')) return;
    patchHeader(field === 'note' ? { note: text || null } : { supplierDocNo: text || null });
  };

  const supplierError = required.supplier
    ? 'validation.required'
    : fieldError(headerProblem, 'supplierId');
  const accountError = required.account
    ? 'validation.moneyAccountRequired'
    : fieldError(headerProblem, 'moneyAccountId');

  return (
    <>
      <HeaderCard note={<VatNote detail={detail} />}>
        <ProblemAlert problem={generalProblem(headerProblem)} />
        <div className={EDITOR_GRID}>
          <FormField
            label={t('inventory.receipt.form.date')}
            htmlFor="receipt-date"
            error={fieldError(headerProblem, 'supplierDocDate')}
          >
            <Input
              id="receipt-date"
              type="date"
              value={docDate}
              onChange={(event) => setDocDate(event.target.value)}
              onBlur={() => {
                if (detail !== null && docDate !== (detail.supplierDocDate ?? '')) {
                  patchHeader({ supplierDocDate: docDate || null });
                }
              }}
            />
          </FormField>
          <FormField
            label={t('inventory.receipts.supplier')}
            htmlFor="receipt-supplier"
            error={supplierError}
          >
            <SupplierPicker
              floating
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
                }
              }}
            />
          </FormField>
          <FormField
            label={t('inventory.receipt.supplierDocNo')}
            htmlFor="receipt-doc-no"
            error={fieldError(headerProblem, 'supplierDocNo')}
          >
            <Input
              id="receipt-doc-no"
              maxLength={50}
              value={docNo}
              onChange={(event) => setDocNo(event.target.value)}
              onBlur={() => leaveText('supplierDocNo', docNo)}
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
              onBlur={() => leaveText('note', note)}
            />
          </FormField>
          <FormField label={t('inventory.receipt.form.payment')} htmlFor="receipt-payment">
            <NativeSelect
              id="receipt-payment"
              value={method}
              onChange={(event) => {
                const next = PAYMENT_METHODS.find((value) => value === event.target.value);
                if (next) changeMethod(next);
              }}
            >
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {t(`inventory.receipt.paymentMethods.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {method === 'CREDIT' ? null : (
            <FormField
              label={t('inventory.receipt.form.account')}
              htmlFor="receipt-account"
              error={accountError}
            >
              <NativeSelect
                id="receipt-account"
                aria-invalid={accountError !== undefined || undefined}
                value={accountId ?? ''}
                onChange={(event) => {
                  const next = event.target.value ? Number.parseInt(event.target.value, 10) : null;
                  const before = accountId;
                  setAccountId(next);
                  setRequired((previous) => ({ ...previous, account: false }));
                  patchHeader({ moneyAccountId: next }, () => setAccountId(before));
                }}
              >
                <option value="">{t('inventory.receipt.form.pickAccount')}</option>
                {methodAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          )}
        </div>
        <ProblemAlert problem={problemFromError(accounts.error)} onRetry={accounts.refetch} />
      </HeaderCard>
      <ReceiptLinePanel
        supplierId={supplier?.id}
        editing={editing}
        pending={mutations.addReceiptLine.isPending || mutations.updateReceiptLine.isPending}
        problem={confirm ? null : <ProblemAlert problem={action.problem} />}
        onSubmit={submitLine}
        onCancelEdit={() => setEditing(null)}
      />
      <Card role="region" aria-labelledby="receipt-lines-title">
        <CardHeader>
          <CardTitle id="receipt-lines-title">{t('inventory.receipt.form.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('inventory.receipt.linesEmpty')}</p>
          ) : (
            <LinesTable
              lines={lines.filter((line) => !line.freeGoods)}
              table={table}
              prices={canCost}
              actions
              selectedId={editing?.id ?? null}
              onSelect={(line) => setEditing(line)}
              cells={(line, name) => ({
                prices: (
                  <PriceCells
                    name={name}
                    enteredQty={line.enteredQty}
                    entry={entryOfLine(line, false)}
                    editable={false}
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
          )}
          {canCost && detail ? <ReceiptTotals detail={detail} /> : null}
          {detail && detail.weightMissing > 0 && lines.length > 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {t('inventory.receipt.form.weightMissing', { count: detail.weightMissing })}
            </p>
          ) : null}
        </CardContent>
      </Card>
      {canCost && detail ? (
        <ReceiptDiscountsCard
          lines={lines}
          discounts={discountsOf(detail)}
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
      ) : null}
      <StickyActions
        summary={
          <LinesSummary detail={detail} count={lines.filter((line) => !line.freeGoods).length} />
        }
      >
        {detail === null ? (
          <Button disabled={mutations.createReceipt.isPending} onClick={saveNew}>
            {t('common.save')}
          </Button>
        ) : (
          <>
            <PrintLinks id={detail.id} />
            <Button
              variant="ghost"
              onClick={() => {
                action.clear();
                setConfirm('cancel');
              }}
            >
              {t('inventory.receipt.cancel')}
            </Button>
            <Button disabled={lines.length === 0} onClick={askPost}>
              {t('inventory.receipt.post')}
            </Button>
          </>
        )}
      </StickyActions>
      <ConfirmDialog
        open={confirm === 'post'}
        variant="default"
        title={t('inventory.receipt.postTitle')}
        description={
          lines.some((line) => line.salePrice)
            ? `${t('inventory.receipt.postDescription')} ${t('inventory.receipt.postSalePrices')}`
            : t('inventory.receipt.postDescription')
        }
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
    </>
  );
}
