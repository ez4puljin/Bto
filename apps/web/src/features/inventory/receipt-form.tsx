import type { ProblemDetails } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Trash2 } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { LeaveGuard } from '@/components/leave-guard';
import { RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBarcodeLookup } from '@/features/catalog/api';
import { type PickedSupplier, SupplierPicker } from '@/features/partners/supplier-picker';
import type { ValidationMessage } from '@/lib/forms';
import { formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useScanGuard } from '@/lib/scan/use-wedge-scanner';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type ReceiptDetail,
  type ReceiptLine,
  type ReceiptLineRequest,
  type ReceiptLineUpdate,
  type ReceiptPaymentMethod,
  type ReceiptUpdate,
  useBinLookup,
  useInventoryMutations,
  useReceiptPaymentAccounts,
  useReceiptSnapshot,
} from './api';
import {
  looksLikeLabel,
  parseMoney,
  parseScanQty,
  useCanWrite,
  useWarehouseOptions,
} from './helpers';
import { useDefaultWarehouse } from './last-warehouse';
import { DraftPriceCells, PriceCells, ReceiptTotals } from './receipt-costing';
import { costsChangeable, entryOfLine, focusNextPrice, usePostedCosts } from './receipt-prices';
import { type ScanQty, useScanQty } from './scan-qty';
import { ProductSearch, QtyInput, ScanQtyControl, ScanToolbar, WarehouseSelect } from './shared';

const WHOLESALE = ['WHOLESALE'] as const;
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

/** A lookup that answers 404 for an unknown code: null instead of an error. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (problemFromError(error)?.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * One goods receipt in one window, after Erkhet's «Бараа материал орлого» (owner 2026-10-18): the
 * delivery note's header on top, its lines below. A new receipt and a draft are edited here; a
 * posted one reads the same way, with its prices still open to cost holders.
 */
export function ReceiptForm(props: {
  detail: ReceiptDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { detail } = props;
  const canManage = useHasPermission('inventory.receipts.manage');
  const canWrite = useCanWrite();
  const editsDraft =
    canManage && (detail === null || (detail.status === 'DRAFT' && canWrite(detail.warehouseId)));
  return editsDraft ? (
    <DraftEditor detail={detail} focusScan={props.focusScan} onCreated={props.onCreated} />
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
    [t('inventory.warehouse'), detail.warehouseName],
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

/** The lines table: №, product, unit, shelf, quantity, then the price cells for cost holders. */
function LinesTable(props: {
  lines: readonly ReceiptLine[];
  table: RefObject<HTMLTableElement | null>;
  prices: boolean;
  actions: boolean;
  cells: (
    line: ReceiptLine,
    name: string,
  ) => { bin: ReactNode; qty: ReactNode; prices?: ReactNode; actions?: ReactNode };
}) {
  const { t } = useTranslation();
  return (
    <Table ref={props.table}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 text-right">{t('inventory.receipt.form.lineNo')}</TableHead>
          <TableHead>{t('inventory.product')}</TableHead>
          <TableHead>{t('inventory.unit')}</TableHead>
          <TableHead>{t('inventory.bin')}</TableHead>
          <TableHead className="text-right">{t('inventory.qty')}</TableHead>
          {props.prices ? (
            <>
              <TableHead className="text-right">{t('inventory.receipt.form.unitPrice')}</TableHead>
              <TableHead className="text-right">{t('inventory.receipt.form.amount')}</TableHead>
              <TableHead>{t('inventory.costing.freeGoods')}</TableHead>
            </>
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
          const cells = props.cells(
            line,
            t('inventory.productUnit', { product: line.productName, unit: line.unitName }),
          );
          return (
            <TableRow key={line.id}>
              <TableCell className="text-right font-mono text-muted-foreground">
                {index + 1}
              </TableCell>
              <TableCell className="min-w-40 whitespace-normal">
                {line.productName}{' '}
                <span className="font-mono text-[13px] text-muted-foreground">
                  {line.productSku}
                </span>
              </TableCell>
              <TableCell>{line.unitName}</TableCell>
              <TableCell>{cells.bin}</TableCell>
              <TableCell className="text-right">{cells.qty}</TableCell>
              {props.prices ? cells.prices : null}
              {props.actions ? cells.actions : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/**
 * A posted receipt (or a draft the user may only read): the header and quantities read-only. Cost
 * holders see the prices and the totals, and change the prices while the costs wait or until the
 * re-costing deadline, saved at once with «Өртөг хадгалах» or «Хадгалаад дараагийнх».
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
            lines={detail.lines}
            table={table}
            prices={canCost}
            actions={false}
            cells={(line, name) => ({
              bin: <span className="font-mono">{line.binCode}</span>,
              qty: <span className="font-mono">{formatQty(line.enteredQty)}</span>,
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
      {changeable ? (
        <StickyActions
          summary={
            <>
              {t('inventory.receipt.form.typedTotal')}:{' '}
              <span className="font-mono font-medium text-foreground">
                {formatTugrik(costs.total.toString())}
              </span>
            </>
          }
        >
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
        </StickyActions>
      ) : null}
      <LeaveGuard
        when={changeable && costs.dirty && !costs.saved}
        title={t('inventory.costing.unsavedTitle')}
        description={t('inventory.costing.unsavedDescription')}
        leaveLabel={t('inventory.costing.leave')}
      />
    </>
  );
}

/** What a scan added, for the line under the scan box. */
interface Added {
  qty: string;
  unit: string;
  name: string;
  /** In base units when the scanned unit is a pack. */
  base?: { qty: string; unit: string };
}

/** «Нэгж үнэ» beside «Тоо»: the price the next product is added at; a scan here goes to the scanner. */
function ScanPriceControl(props: {
  id: string;
  price: ScanQty;
  invalid: boolean;
  onScan: (code: string) => void;
}) {
  const { t } = useTranslation();
  const guard = useScanGuard(props.onScan, { letters: true });
  return (
    <div className="flex shrink-0 items-center gap-2 lg:h-9">
      <Label htmlFor={props.id}>{t('inventory.receipt.form.unitPrice')}</Label>
      <Input
        id={props.id}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={props.invalid || undefined}
        className="w-28 text-right font-mono"
        value={props.price.value}
        onChange={(event) => props.price.set(event.target.value)}
        onKeyDown={(event) => guard(event, props.price.value, props.price.set)}
      />
    </div>
  );
}

/**
 * A new receipt or a draft (owner, 2026-10-11: the warehouse counts and registers, goods go straight
 * onto their shelf). Nothing exists until the first product is added or «Хадгалах» is pressed: then
 * the draft is created with the header (and that line) and the address becomes the draft's, the page
 * staying as it is. Each header change of a draft is saved at once (selects on change, texts when
 * left). One scan box: a shelf label makes that shelf active, a product barcode adds «Тоо» of its
 * unit (ADR-0047 #2) at «Нэгж үнэ» for cost holders, a repeat adds to its line; scans are handled
 * one after another against the latest copy of the draft.
 */
function DraftEditor(props: {
  detail: ReceiptDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { detail } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canCost = useHasPermission('inventory.costs.manage');
  const mutations = useInventoryMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const snapshot = useReceiptSnapshot();
  const accounts = useReceiptPaymentAccounts();
  const warehouses = useWarehouseOptions(WHOLESALE, true);
  const { defaultId, remember } = useDefaultWarehouse(warehouses.options, 'receipt');
  const action = useAction();
  const qty = useScanQty();
  const price = useScanQty('');
  const table = useRef<HTMLTableElement>(null);
  const scanArea = useRef<HTMLDivElement>(null);

  // The header as typed; a draft's copy follows the server through the saves below.
  const [pickedWarehouse, setPickedWarehouse] = useState<number | undefined>();
  const warehouseId = detail?.warehouseId ?? pickedWarehouse ?? defaultId;
  const [supplier, setSupplier] = useState<PickedSupplier | null>(
    detail ? { id: detail.supplierId, code: detail.supplierCode, name: detail.supplierName } : null,
  );
  const [docDate, setDocDate] = useState(detail ? (detail.supplierDocDate ?? '') : businessDate());
  const [docNo, setDocNo] = useState(detail?.supplierDocNo ?? '');
  const [note, setNote] = useState(detail?.note ?? '');
  const [method, setMethod] = useState<ReceiptPaymentMethod>(detail?.paymentMethod ?? 'CREDIT');
  const [accountId, setAccountId] = useState<number | null>(detail?.moneyAccountId ?? null);
  const [headerProblem, setHeaderProblem] = useState<ProblemDetails | null>(null);
  const [required, setRequired] = useState({ supplier: false, warehouse: false, account: false });

  const draftId = useRef<number | null>(detail?.id ?? null);
  const createKey = useRef(randomUuid());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const bin = useRef<Bin | null>(null);
  const [activeBin, setActiveBinState] = useState<Bin | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [invalidQty, setInvalidQty] = useState(false);
  const [invalidPrice, setInvalidPrice] = useState(false);
  const [needHeader, setNeedHeader] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [postKey, setPostKey] = useState(randomUuid);
  const started = useRef(false);

  const lines = detail?.lines ?? [];
  const typesPrices = canCost;
  const ready = warehouseId !== undefined && supplier !== null;
  const methodAccounts = (accounts.data ?? []).filter((account) => account.kind === method);

  // A new receipt starts with the supplier once the warehouse is chosen (the list may still load).
  useEffect(() => {
    if (detail !== null || started.current || warehouseId === undefined) return;
    started.current = true;
    const field = document.getElementById('receipt-supplier');
    const active = document.activeElement;
    const untouched =
      active === null || active === document.body || active.id === 'receipt-warehouse';
    if (field instanceof HTMLInputElement && untouched) field.focus();
  }, [detail, warehouseId]);

  const setActiveBin = (next: Bin | null) => {
    bin.current = next;
    setActiveBinState(next);
  };
  const enqueue = (work: () => Promise<void>) => {
    chain.current = chain.current.then(() => action.run(work));
  };

  /** Saves a header change of a draft, after the scans queued before it; a refusal undoes it. */
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

  const flagHeader = () => {
    setRequired((previous) => ({
      ...previous,
      supplier: supplier === null,
      warehouse: warehouseId === undefined,
    }));
    setNeedHeader(true);
  };

  /**
   * Creates the draft from the header (and its first line), then takes the draft's address. A
   * refusal that names a header field shows on that field and the draft stays unmade (false).
   */
  const createDraft = async (first?: ReceiptLineRequest): Promise<boolean> => {
    if (warehouseId === undefined || supplier === null) return false;
    try {
      const receipt = await mutations.createReceipt.mutateAsync({
        key: createKey.current,
        warehouseId,
        supplierId: supplier.id,
        ...(docNo.trim() ? { supplierDocNo: docNo.trim() } : {}),
        ...(docDate ? { supplierDocDate: docDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        paymentMethod: method,
        ...(method !== 'CREDIT' && accountId !== null ? { moneyAccountId: accountId } : {}),
        ...(first ? { lines: [first] } : {}),
      });
      draftId.current = receipt.id;
      remember(warehouseId);
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

  /** Adds to the product's line on the active shelf, or a new line; false when nothing was added. */
  const addUnit = async (
    productUnitId: number,
    amount: string,
    unitPrice: string | null,
  ): Promise<boolean> => {
    const shelf = bin.current;
    const priced = unitPrice === null ? {} : { docUnitPrice: unitPrice };
    const id = draftId.current;
    if (id === null) {
      return createDraft({
        productUnitId,
        enteredQty: amount,
        ...(shelf ? { binId: shelf.id } : {}),
        ...priced,
      });
    }
    const receipt = snapshot(id) ?? detail;
    const same = receipt?.lines.find(
      (line) => line.productUnitId === productUnitId && (shelf === null || line.binId === shelf.id),
    );
    if (same) {
      await mutations.updateReceiptLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(amount).toString(), ...priced },
      });
    } else {
      await mutations.addReceiptLine.mutateAsync({
        id,
        body: {
          productUnitId,
          enteredQty: amount,
          ...(shelf ? { binId: shelf.id } : {}),
          ...priced,
        },
      });
    }
    return true;
  };

  /** «Тоо» and «Нэгж үнэ» belong to this product; both go back at once and return if unused. */
  const takeEntry = () => {
    const typedQty = qty.read();
    const typedPrice = typesPrices ? price.read() : '';
    qty.reset();
    price.reset();
    const giveBack = () => {
      if (qty.read() === '1') qty.set(typedQty);
      if (price.read() === '') price.set(typedPrice);
    };
    const unitPrice = typedPrice.trim() === '' ? null : parseMoney(typedPrice);
    return {
      amount: parseScanQty(typedQty),
      unitPrice,
      priceInvalid: typedPrice.trim() !== '' && unitPrice === null,
      giveBack,
    };
  };

  const onScan = (code: string) => {
    const entry = takeEntry();
    enqueue(async () => {
      setMissing(null);
      setInvalidQty(false);
      setInvalidPrice(false);
      setNeedHeader(false);
      if (warehouseId === undefined) {
        flagHeader();
        entry.giveBack();
        return;
      }
      const asBin = () => orNull(lookupBin.mutateAsync({ warehouseId, code }));
      const label = looksLikeLabel(code);
      const shelf = label ? await asBin() : null;
      if (shelf) {
        setActiveBin(shelf);
        entry.giveBack();
        return;
      }
      const resolved = await orNull(lookupBarcode.mutateAsync(code));
      if (resolved) {
        if (entry.amount === null || entry.priceInvalid) {
          setInvalidQty(entry.amount === null);
          setInvalidPrice(entry.priceInvalid);
          entry.giveBack();
          return;
        }
        if (draftId.current === null && !ready) {
          flagHeader();
          entry.giveBack();
          return;
        }
        if (!(await addUnit(resolved.unit.id, entry.amount, entry.unitPrice))) {
          entry.giveBack();
          return;
        }
        const factor = new Decimal(resolved.unit.factorToBase);
        setAdded({
          qty: entry.amount,
          unit: resolved.unit.uomName,
          name: resolved.product.name,
          ...(factor.equals(1)
            ? {}
            : {
                base: {
                  qty: factor.times(entry.amount).toString(),
                  unit: resolved.product.baseUnit.uomName,
                },
              }),
        });
        return;
      }
      const lateShelf = label ? null : await asBin();
      if (lateShelf) setActiveBin(lateShelf);
      else setMissing(code);
      entry.giveBack();
    });
  };

  const pick = (productUnitId: number, unit: string, name: string) => {
    const entry = takeEntry();
    if (entry.amount === null || entry.priceInvalid) {
      setInvalidQty(entry.amount === null);
      setInvalidPrice(entry.priceInvalid);
      entry.giveBack();
      return;
    }
    if (draftId.current === null && !ready) {
      flagHeader();
      entry.giveBack();
      return;
    }
    const { amount, unitPrice } = entry;
    enqueue(async () => {
      setInvalidQty(false);
      setInvalidPrice(false);
      setNeedHeader(false);
      if (await addUnit(productUnitId, amount, unitPrice)) setAdded({ qty: amount, unit, name });
    });
  };

  /** «Хадгалах» on a new receipt: the draft with its header alone; the scan box takes the cursor. */
  const saveNew = () => {
    if (!ready) {
      flagHeader();
      return;
    }
    enqueue(async () => {
      setNeedHeader(false);
      if (draftId.current === null && !(await createDraft())) return;
      scanArea.current?.querySelector('input')?.focus();
    });
  };

  const saveLine = (lineId: number, body: ReceiptLineUpdate) =>
    void action.run(() => mutations.updateReceiptLine.mutateAsync({ id: lineId, body }));

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
        <ProblemAlert
          problem={generalProblem(headerProblem) ?? problemFromError(warehouses.error)}
        />
        <div className={HEADER_GRID}>
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
            label={t('inventory.warehouse')}
            htmlFor="receipt-warehouse"
            hint={detail ? t('inventory.receipt.warehouseFixed') : undefined}
            error={required.warehouse ? 'validation.required' : undefined}
          >
            {detail ? (
              <Input id="receipt-warehouse" readOnly value={detail.warehouseName} />
            ) : (
              <WarehouseSelect
                id="receipt-warehouse"
                options={warehouses.options}
                value={warehouseId}
                emptyLabel={t('inventory.pickWarehouse')}
                onChange={(id) => {
                  setPickedWarehouse(id);
                  setActiveBin(null);
                  if (id !== undefined)
                    setRequired((previous) => ({ ...previous, warehouse: false }));
                }}
              />
            )}
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
        <ProblemAlert problem={problemFromError(accounts.error)} />
      </HeaderCard>
      <Card role="region" aria-labelledby="receipt-lines-title">
        <CardHeader>
          <CardTitle id="receipt-lines-title">{t('inventory.receipt.form.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ScanToolbar
            scanBox={
              <div ref={scanArea}>
                <ScanBox
                  letters
                  autoFocus={props.focusScan}
                  label={t('inventory.scanLabel')}
                  placeholder={t('inventory.scanPlaceholder')}
                  onScan={onScan}
                />
              </div>
            }
            qty={
              <>
                <ScanQtyControl id="receipt-scan-qty" qty={qty} onScan={onScan} />
                {typesPrices ? (
                  <ScanPriceControl
                    id="receipt-scan-price"
                    price={price}
                    invalid={invalidPrice}
                    onScan={onScan}
                  />
                ) : null}
              </>
            }
            search={
              <ProductSearch
                onScan={onScan}
                onPick={(product) =>
                  pick(product.baseUnit.id, product.baseUnit.uomName, product.name)
                }
              />
            }
            status={
              <>
                <span className="flex items-center gap-1 font-medium">
                  {activeBin
                    ? t('inventory.activeBin', { code: activeBin.code })
                    : t('inventory.activeBinNone')}
                  {activeBin ? (
                    <Button size="xs" variant="ghost" onClick={() => setActiveBin(null)}>
                      {t('inventory.clearBin')}
                    </Button>
                  ) : null}
                </span>
                <span aria-live="polite" className="font-medium">
                  {added
                    ? added.base
                      ? t('inventory.scanAddedBase', {
                          qty: added.qty,
                          unit: added.unit,
                          base: added.base.qty,
                          baseUnit: added.base.unit,
                          name: added.name,
                        })
                      : t('inventory.scanAdded', {
                          qty: added.qty,
                          unit: added.unit,
                          name: added.name,
                        })
                    : null}
                </span>
                {needHeader ? (
                  <span className="text-destructive">{t('inventory.receipt.form.needHeader')}</span>
                ) : null}
                {invalidQty ? (
                  <span className="text-destructive">{t('inventory.scanQtyInvalid')}</span>
                ) : null}
                {invalidPrice ? (
                  <span className="text-destructive">
                    {t('inventory.receipt.form.scanPriceInvalid')}
                  </span>
                ) : null}
                {missing ? (
                  <span className="text-destructive">
                    {t('inventory.scanNotFound', { code: missing })}
                  </span>
                ) : null}
                {qty.value !== '1' ? (
                  <span className="text-[13px] text-muted-foreground">
                    {t('inventory.scanQtyHint')}
                  </span>
                ) : null}
              </>
            }
          />
          <ProblemAlert problem={confirm ? null : action.problem} />
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('inventory.receipt.linesEmpty')}</p>
          ) : (
            <LinesTable
              lines={lines}
              table={table}
              prices={typesPrices}
              actions
              cells={(line, name) => ({
                bin: (
                  <>
                    <span className="font-mono">{line.binCode}</span>
                    {activeBin && activeBin.id !== line.binId ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="ml-1"
                        onClick={() => saveLine(line.id, { binId: activeBin.id })}
                      >
                        {t('inventory.moveToBin', { code: activeBin.code })}
                      </Button>
                    ) : null}
                  </>
                ),
                qty: (
                  <QtyInput
                    key={line.enteredQty}
                    label={`${t('inventory.qty')}: ${name}`}
                    value={line.enteredQty}
                    onScan={onScan}
                    onSave={(enteredQty) => saveLine(line.id, { enteredQty })}
                  />
                ),
                prices: (
                  <DraftPriceCells
                    line={line}
                    name={name}
                    table={table}
                    onSave={(body) => saveLine(line.id, body)}
                  />
                ),
                actions: (
                  <RowActions>
                    <RowAction
                      label={`${t('inventory.remove')}: ${name}`}
                      icon={Trash2}
                      destructive
                      onClick={() =>
                        void action.run(() => mutations.removeReceiptLine.mutateAsync(line.id))
                      }
                    />
                  </RowActions>
                ),
              })}
            />
          )}
          {typesPrices && detail ? <ReceiptTotals detail={detail} /> : null}
        </CardContent>
      </Card>
      <StickyActions summary={t('inventory.linesCount', { count: lines.length })}>
        {detail === null ? (
          <Button disabled={mutations.createReceipt.isPending} onClick={saveNew}>
            {t('common.save')}
          </Button>
        ) : (
          <>
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
    </>
  );
}
