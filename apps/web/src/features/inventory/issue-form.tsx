import type { ProblemDetails } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Trash2 } from 'lucide-react';
import { type ReactNode, useDeferredValue, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { RowAction, RowActions, SegmentedControl } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
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
import { useBarcodeLookup } from '@/features/catalog/api';
import { SupplierPicker } from '@/features/partners/supplier-picker';
import type { ValidationMessage } from '@/lib/forms';
import { formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type Bin,
  type IssueDetail,
  type IssueExpenseType,
  type IssueLine,
  type IssueLineRequest,
  type IssueLineUpdate,
  type IssueRecipient,
  type IssueRecipientKind,
  type IssueUpdate,
  useBinLookup,
  useCustomerLookup,
  useIssueExpenseTypes,
  useIssueMutations,
  useIssueSnapshot,
  useUserLookup,
} from './api';
import { looksLikeLabel, parseScanQty, useCanWrite, useWarehouseOptions } from './helpers';
import { useDefaultWarehouse } from './last-warehouse';
import { useScanQty } from './scan-qty';
import { ProductSearch, QtyInput, ScanQtyControl, ScanToolbar, WarehouseSelect } from './shared';

/** Goods leave a wholesale warehouse or a store (ADR-0081). */
const ISSUE_WAREHOUSES = ['WHOLESALE', 'STORE'] as const;
const RECIPIENT_KINDS: readonly IssueRecipientKind[] = ['USER', 'CUSTOMER', 'SUPPLIER', 'OTHER'];
/** Refusals about the header that name no field: they show in the header card. */
const HEADER_CODES = new Set([
  'EXPENSE_TYPE_INACTIVE',
  'CUSTOMER_INACTIVE',
  'SUPPLIER_INACTIVE',
  'WAREHOUSE_KIND_NOT_ALLOWED',
]);
const HEADER_GRID = 'grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3';

/** A chosen recipient record (a user, a customer or a supplier) as the header keeps it. */
interface Picked {
  id: number;
  name: string;
  code?: string;
}

const errorsAt = (problem: ProblemDetails | null, prefix: string) =>
  (problem?.errors ?? []).filter(
    (error) => error.path === prefix || error.path.startsWith(`${prefix}.`),
  );

/** The message a refusal shows under a header field, or undefined. */
function fieldError(problem: ProblemDetails | null, path: string): ValidationMessage | undefined {
  const [error] = errorsAt(problem, path);
  if (!error) return undefined;
  if (path === 'issuedOn') return 'validation.date';
  if (path === 'note' || error.constraint === 'length') return 'validation.tooLong';
  return 'validation.required';
}

const HEADER_FIELDS = ['issuedOn', 'expenseTypeId', 'recipient', 'note'];
const namesField = (problem: ProblemDetails | null) =>
  HEADER_FIELDS.some((path) => errorsAt(problem, path).length > 0);
/** Whether a refusal belongs to the header card (a field or a header code). */
const belongsToHeader = (problem: ProblemDetails | null) =>
  problem !== null && (namesField(problem) || HEADER_CODES.has(problem.code));

/** A lookup that answers 404 for an unknown code: null instead of an error. */
async function orNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (problemFromError(error)?.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/** The types a select offers: the active ones, plus the issue's own type when it was retired. */
function typeChoices(types: readonly IssueExpenseType[], currentId: number | undefined) {
  return types.filter((type) => type.active || type.id === currentId);
}

/**
 * One goods issue in one window, like the receipt (ADR-0078, ADR-0081): the header — date,
 * warehouse, expense type, recipient, note — on top, its lines below. A new issue and a draft are
 * edited here; a posted or cancelled one, or one the user may not change, reads the same way.
 */
export function IssueForm(props: {
  detail: IssueDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { detail } = props;
  const canManage = useHasPermission('inventory.issues.manage');
  const canWrite = useCanWrite();
  const editsDraft =
    canManage && (detail === null || (detail.status === 'DRAFT' && canWrite(detail.warehouseId)));
  return editsDraft ? (
    <DraftEditor detail={detail} focusScan={props.focusScan} onCreated={props.onCreated} />
  ) : detail ? (
    <IssueView detail={detail} />
  ) : null;
}

function HeaderCard(props: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card role="region" aria-labelledby="issue-header-title">
      <CardHeader>
        <CardTitle id="issue-header-title">{t('inventory.issues.header')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{props.children}</CardContent>
    </Card>
  );
}

function ReadOnlyHeader({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  const none = t('common.none');
  const kind = t(`inventory.issues.recipientKinds.${detail.recipientKind}`);
  const items: [string, ReactNode][] = [
    [t('inventory.date'), detail.issuedOn],
    [t('inventory.warehouse'), detail.warehouseName],
    [t('inventory.issues.expenseType'), detail.expenseTypeName],
    [
      t('inventory.issues.recipient'),
      detail.recipientName ? `${kind} · ${detail.recipientName}` : kind,
    ],
    [t('inventory.issues.note'), detail.note ?? none],
  ];
  return (
    <HeaderCard>
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

/** Whether the API sent the costs (only to holders of inventory.costs.manage). */
const hasCosts = (detail: IssueDetail | null) =>
  detail !== null &&
  (detail.total !== undefined || detail.lines.some((line) => line.unitCost !== undefined));

/** The lines table: №, product, unit, shelf, quantity, then the costs when the API sent them. */
function LinesTable(props: {
  lines: readonly IssueLine[];
  costs: boolean;
  actions: boolean;
  cells: (line: IssueLine, name: string) => { bin: ReactNode; qty: ReactNode; actions?: ReactNode };
}) {
  const { t } = useTranslation();
  const none = t('common.none');
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 text-right">{t('inventory.receipt.form.lineNo')}</TableHead>
          <TableHead>{t('inventory.product')}</TableHead>
          <TableHead>{t('inventory.unit')}</TableHead>
          <TableHead>{t('inventory.bin')}</TableHead>
          <TableHead className="text-right">{t('inventory.qty')}</TableHead>
          {props.costs ? (
            <>
              <TableHead className="text-right">{t('inventory.issues.unitCost')}</TableHead>
              <TableHead className="text-right">{t('inventory.issues.amount')}</TableHead>
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
              {props.costs ? (
                <>
                  <TableCell className="text-right font-mono">
                    {line.unitCost ? formatTugrik(line.unitCost) : none}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.amount ? formatTugrik(line.amount) : none}
                  </TableCell>
                </>
              ) : null}
              {props.actions ? cells.actions : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** «Нийт өртөг» under the lines, for cost holders once the issue has one. */
function IssueTotal({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  if (!hasCosts(detail)) return null;
  return detail.total ? (
    <p className="text-right text-sm">
      {t('inventory.issues.total')}:{' '}
      <span className="font-mono font-medium">{formatTugrik(detail.total)}</span>
    </p>
  ) : (
    <p className="text-[13px] text-muted-foreground">{t('inventory.issues.costHint')}</p>
  );
}

/** A posted or cancelled issue (or a draft the user may only read). */
function IssueView({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  return (
    <>
      <ReadOnlyHeader detail={detail} />
      <Card role="region" aria-labelledby="issue-lines-title">
        <CardHeader>
          <CardTitle id="issue-lines-title">{t('inventory.issues.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <LinesTable
            lines={detail.lines}
            costs={hasCosts(detail)}
            actions={false}
            cells={(line) => ({
              bin: <span className="font-mono">{line.binCode}</span>,
              qty: <span className="font-mono">{formatQty(line.enteredQty)}</span>,
            })}
          />
          <IssueTotal detail={detail} />
        </CardContent>
      </Card>
    </>
  );
}

/** The chosen user or customer, read-only, with «Солих». */
function ChosenRecipient(props: { id: string; value: Picked; onChange: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      <Input
        id={props.id}
        readOnly
        value={props.value.code ? `${props.value.name} · ${props.value.code}` : props.value.name}
      />
      <Button type="button" variant="outline" onClick={props.onChange}>
        {t('inventory.issues.picker.change')}
      </Button>
    </div>
  );
}

/**
 * A staff member (`/users/lookup`) or a customer (`/customers/lookup`, open to every signed-in
 * user, ADR-0081 #6) by name: the first matches float under the box while it has the focus.
 */
function LookupPicker(props: {
  id: string;
  kind: 'USER' | 'CUSTOMER';
  invalid: boolean;
  onPick: (picked: Picked) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const q = useDeferredValue(search.trim());
  const users = useUserLookup(q, props.kind === 'USER' && focused);
  const customers = useCustomerLookup(q, props.kind === 'CUSTOMER' && focused);
  const query = props.kind === 'USER' ? users : customers;
  const rows: Picked[] =
    props.kind === 'USER'
      ? (users.data ?? []).map((user) => ({ id: user.id, name: user.fullName }))
      : (customers.data ?? []).map((customer) => ({
          id: customer.id,
          name: customer.name,
          code: customer.code,
        }));
  return (
    <div
      className="relative"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <Input
        id={props.id}
        type="search"
        autoComplete="off"
        placeholder={t(
          props.kind === 'USER'
            ? 'inventory.issues.picker.searchUser'
            : 'inventory.issues.picker.searchCustomer',
        )}
        aria-invalid={props.invalid || undefined}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <ProblemAlert problem={problemFromError(query.error)} />
      {!focused || query.isPending ? null : rows.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 flex max-h-72 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border bg-popover shadow-popover">
          {rows.slice(0, 8).map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => {
                  setSearch('');
                  setFocused(false);
                  props.onPick(row);
                }}
              >
                {row.code ? (
                  <span className="font-mono text-muted-foreground">{row.code}</span>
                ) : null}
                <span>{row.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-popover">
          {t('inventory.issues.picker.none')}
        </p>
      )}
    </div>
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

/** The recipient as the header holds it: one choice per kind, so switching back keeps it. */
interface RecipientState {
  kind: IssueRecipientKind;
  user: Picked | null;
  customer: Picked | null;
  supplier: Picked | null;
  name: string;
}

function recipientOf(detail: IssueDetail | null): RecipientState {
  const state: RecipientState = {
    kind: detail?.recipientKind ?? 'USER',
    user: null,
    customer: null,
    supplier: null,
    name: '',
  };
  if (!detail) return state;
  const name = detail.recipientName ?? '';
  if (detail.recipientKind === 'USER' && detail.recipientUserId !== null) {
    state.user = { id: detail.recipientUserId, name };
  } else if (detail.recipientKind === 'CUSTOMER' && detail.recipientCustomerId !== null) {
    state.customer = { id: detail.recipientCustomerId, name };
  } else if (detail.recipientKind === 'SUPPLIER' && detail.recipientSupplierId !== null) {
    state.supplier = { id: detail.recipientSupplierId, name };
  } else if (detail.recipientKind === 'OTHER') {
    state.name = name;
  }
  return state;
}

/** The request for the chosen recipient, or null while the chosen kind has none yet. */
function recipientRequest(state: RecipientState): IssueRecipient | null {
  switch (state.kind) {
    case 'USER':
      return state.user ? { kind: 'USER', userId: state.user.id } : null;
    case 'CUSTOMER':
      return state.customer ? { kind: 'CUSTOMER', customerId: state.customer.id } : null;
    case 'SUPPLIER':
      return state.supplier ? { kind: 'SUPPLIER', supplierId: state.supplier.id } : null;
    case 'OTHER': {
      const name = state.name.trim();
      return name ? { kind: 'OTHER', name } : null;
    }
  }
}

/** The date check of the header: a business date, never after today. */
function dateMessage(value: string): ValidationMessage | undefined {
  if (value === '') return 'validation.required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'validation.date';
  return value > businessDate() ? 'validation.notFuture' : undefined;
}

/**
 * A new issue or a draft. Nothing exists until the first product is added or «Хадгалах» is
 * pressed: then the draft is created with the header (and that line) and the address becomes the
 * draft's, the page staying as it is. Each header change of a draft is saved at once (selects and
 * picks on change, texts when left). One scan box: a shelf label makes that shelf the source of the
 * next lines, a product barcode adds «Тоо» of its unit, a repeat adds to its line; scans run one
 * after another against the latest copy of the draft.
 */
function DraftEditor(props: {
  detail: IssueDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
}) {
  const { detail } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useIssueMutations();
  const lookupBin = useBinLookup();
  const lookupBarcode = useBarcodeLookup();
  const snapshot = useIssueSnapshot();
  const types = useIssueExpenseTypes();
  const warehouses = useWarehouseOptions(ISSUE_WAREHOUSES, true);
  const { defaultId, remember } = useDefaultWarehouse(warehouses.options, 'issue');
  const action = useAction();
  const qty = useScanQty();
  const scanArea = useRef<HTMLDivElement>(null);

  const [pickedWarehouse, setPickedWarehouse] = useState<number | undefined>();
  const warehouseId = detail?.warehouseId ?? pickedWarehouse ?? defaultId;
  const [issuedOn, setIssuedOn] = useState(detail?.issuedOn ?? businessDate());
  const [expenseTypeId, setExpenseTypeId] = useState<number | undefined>(detail?.expenseTypeId);
  const [recipient, setRecipientState] = useState<RecipientState>(() => recipientOf(detail));
  const [note, setNote] = useState(detail?.note ?? '');
  const [headerProblem, setHeaderProblem] = useState<ProblemDetails | null>(null);
  const [required, setRequired] = useState({ warehouse: false, type: false, recipient: false });
  const [focusRecipient, setFocusRecipient] = useState(false);

  const draftId = useRef<number | null>(detail?.id ?? null);
  const createKey = useRef(randomUuid());
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const bin = useRef<Bin | null>(null);
  const [activeBin, setActiveBinState] = useState<Bin | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [invalidQty, setInvalidQty] = useState(false);
  const [needHeader, setNeedHeader] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [confirm, setConfirm] = useState<'post' | 'cancel' | null>(null);
  const [postKey, setPostKey] = useState(randomUuid);

  const lines = detail?.lines ?? [];
  const costs = hasCosts(detail);
  const dateError = dateMessage(issuedOn) ?? fieldError(headerProblem, 'issuedOn');
  const request = recipientRequest(recipient);
  const ready =
    warehouseId !== undefined &&
    expenseTypeId !== undefined &&
    request !== null &&
    dateMessage(issuedOn) === undefined;
  const choices = typeChoices(types.data ?? [], detail?.expenseTypeId);

  // «Солих» hands the focus to the search box it brings back.
  useEffect(() => {
    if (!focusRecipient) return;
    document.getElementById('issue-recipient')?.focus();
    setFocusRecipient(false);
  }, [focusRecipient]);

  const setActiveBin = (next: Bin | null) => {
    bin.current = next;
    setActiveBinState(next);
  };
  const enqueue = (work: () => Promise<void>) => {
    chain.current = chain.current.then(() => action.run(work));
  };

  /** Saves a header change of a draft, after the scans queued before it; a refusal undoes it. */
  const patchHeader = (body: IssueUpdate, undo?: () => void) => {
    setHeaderProblem(null);
    chain.current = chain.current.then(async () => {
      const id = draftId.current;
      if (id === null) return;
      try {
        await mutations.update.mutateAsync({ id, body });
      } catch (error) {
        setHeaderProblem(problemFromError(error));
        undo?.();
      }
    });
  };

  const flagHeader = () => {
    setRequired({
      warehouse: warehouseId === undefined,
      type: expenseTypeId === undefined,
      recipient: request === null,
    });
    setNeedHeader(true);
  };

  /** Creates the draft from the header (and its first line), then takes the draft's address. */
  const createDraft = async (first?: IssueLineRequest): Promise<boolean> => {
    if (warehouseId === undefined || expenseTypeId === undefined || request === null) return false;
    try {
      const issue = await mutations.create.mutateAsync({
        key: createKey.current,
        warehouseId,
        issuedOn,
        expenseTypeId,
        recipient: request,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(first ? { lines: [first] } : {}),
      });
      draftId.current = issue.id;
      remember(warehouseId);
      props.onCreated(issue.id);
      await navigate(`/inventory/issues/${issue.id}`, { replace: true });
      return true;
    } catch (error) {
      // A refused draft is a new intent once the form changes.
      createKey.current = randomUuid();
      const problem = problemFromError(error);
      if (!belongsToHeader(problem)) throw error;
      setHeaderProblem(problem);
      return false;
    }
  };

  /** Adds to the product's line on the active shelf, or a new line; false when nothing was added. */
  const addUnit = async (productUnitId: number, amount: string): Promise<boolean> => {
    const shelf = bin.current;
    const id = draftId.current;
    if (id === null) {
      return createDraft({
        productUnitId,
        enteredQty: amount,
        ...(shelf ? { binId: shelf.id } : {}),
      });
    }
    const issue = snapshot(id) ?? detail;
    const same = issue?.lines.find(
      (line) => line.productUnitId === productUnitId && (shelf === null || line.binId === shelf.id),
    );
    if (same) {
      await mutations.updateLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(amount).toString() },
      });
    } else {
      await mutations.addLine.mutateAsync({
        id,
        body: { productUnitId, enteredQty: amount, ...(shelf ? { binId: shelf.id } : {}) },
      });
    }
    return true;
  };

  /** «Тоо» belongs to this product: it goes back to 1 at once and returns if unused. */
  const takeQty = () => {
    const typed = qty.read();
    qty.reset();
    return {
      amount: parseScanQty(typed),
      giveBack: () => {
        if (qty.read() === '1') qty.set(typed);
      },
    };
  };

  const onScan = (code: string) => {
    const entry = takeQty();
    enqueue(async () => {
      setMissing(null);
      setInvalidQty(false);
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
        if (entry.amount === null) {
          setInvalidQty(true);
          entry.giveBack();
          return;
        }
        if (draftId.current === null && !ready) {
          flagHeader();
          entry.giveBack();
          return;
        }
        if (!(await addUnit(resolved.unit.id, entry.amount))) {
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
    const entry = takeQty();
    if (entry.amount === null) {
      setInvalidQty(true);
      entry.giveBack();
      return;
    }
    if (draftId.current === null && !ready) {
      flagHeader();
      entry.giveBack();
      return;
    }
    const amount = entry.amount;
    enqueue(async () => {
      setInvalidQty(false);
      setNeedHeader(false);
      if (await addUnit(productUnitId, amount)) setAdded({ qty: amount, unit, name });
    });
  };

  /** «Хадгалах» on a new issue: the draft with its header alone; the scan box takes the cursor. */
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

  const saveLine = (lineId: number, body: IssueLineUpdate) =>
    void action.run(() => mutations.updateLine.mutateAsync({ id: lineId, body }));

  const askPost = () => {
    if (!ready) {
      flagHeader();
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
      const posted = await mutations.post.mutateAsync({ id, key: postKey });
      setConfirm(null);
      toast.success(t('inventory.issues.posted', { number: posted.number ?? '' }));
    });
  const cancel = () =>
    void action.run(async () => {
      const id = draftId.current;
      if (id === null) return;
      await mutations.cancel.mutateAsync(id);
      setConfirm(null);
      toast.success(t('inventory.issues.cancelled'));
      await navigate('/inventory/issues');
    });

  /** A new choice of recipient: kept, and saved on a draft once it names someone. */
  const changeRecipient = (next: RecipientState) => {
    const before = recipient;
    setRecipientState(next);
    const body = recipientRequest(next);
    if (body === null) return;
    setRequired((previous) => ({ ...previous, recipient: false }));
    if (detail !== null) patchHeader({ recipient: body }, () => setRecipientState(before));
  };

  const leaveName = () => {
    if (detail === null || recipient.kind !== 'OTHER') return;
    const name = recipient.name.trim();
    if (name === '' || (detail.recipientKind === 'OTHER' && name === detail.recipientName)) return;
    patchHeader({ recipient: { kind: 'OTHER', name } });
  };

  const leaveNote = () => {
    if (detail === null) return;
    const text = note.trim();
    if (text === (detail.note ?? '')) return;
    patchHeader({ note: text || null });
  };

  const recipientError = required.recipient
    ? 'validation.required'
    : fieldError(headerProblem, 'recipient');
  const typeError = required.type
    ? 'validation.required'
    : fieldError(headerProblem, 'expenseTypeId');

  const recipientControl = () => {
    switch (recipient.kind) {
      case 'USER':
      case 'CUSTOMER': {
        const chosen = recipient.kind === 'USER' ? recipient.user : recipient.customer;
        const field = recipient.kind === 'USER' ? 'user' : 'customer';
        return chosen ? (
          <ChosenRecipient
            id="issue-recipient"
            value={chosen}
            onChange={() => {
              setRecipientState({ ...recipient, [field]: null });
              setFocusRecipient(true);
            }}
          />
        ) : (
          <LookupPicker
            key={recipient.kind}
            id="issue-recipient"
            kind={recipient.kind}
            invalid={recipientError !== undefined}
            onPick={(picked) => changeRecipient({ ...recipient, [field]: picked })}
          />
        );
      }
      case 'SUPPLIER':
        return recipient.supplier ? (
          <ChosenRecipient
            id="issue-recipient"
            value={recipient.supplier}
            onChange={() => {
              setRecipientState({ ...recipient, supplier: null });
              setFocusRecipient(true);
            }}
          />
        ) : (
          <SupplierPicker
            floating
            id="issue-recipient"
            value={null}
            invalid={recipientError !== undefined}
            onChange={(next) => {
              if (next) changeRecipient({ ...recipient, supplier: next });
            }}
          />
        );
      case 'OTHER':
        return (
          <Input
            id="issue-recipient"
            maxLength={200}
            autoComplete="off"
            placeholder={t('inventory.issues.recipientNamePlaceholder')}
            aria-invalid={recipientError !== undefined || undefined}
            value={recipient.name}
            onChange={(event) => {
              const next = { ...recipient, name: event.target.value };
              setRecipientState(next);
              if (next.name.trim()) setRequired((previous) => ({ ...previous, recipient: false }));
            }}
            onBlur={leaveName}
          />
        );
    }
  };

  return (
    <>
      <HeaderCard>
        <ProblemAlert
          problem={
            (headerProblem && !namesField(headerProblem) ? headerProblem : null) ??
            problemFromError(warehouses.error) ??
            problemFromError(types.error)
          }
        />
        <div className={HEADER_GRID}>
          <FormField label={t('inventory.date')} htmlFor="issue-date" error={dateError}>
            <Input
              id="issue-date"
              type="date"
              max={businessDate()}
              aria-invalid={dateError !== undefined || undefined}
              value={issuedOn}
              onChange={(event) => setIssuedOn(event.target.value)}
              onBlur={() => {
                if (detail !== null && issuedOn !== detail.issuedOn && !dateMessage(issuedOn)) {
                  const before = detail.issuedOn;
                  patchHeader({ issuedOn }, () => setIssuedOn(before));
                }
              }}
            />
          </FormField>
          <FormField
            label={t('inventory.warehouse')}
            htmlFor="issue-warehouse"
            hint={detail ? t('inventory.issues.warehouseFixed') : undefined}
            error={required.warehouse ? 'validation.required' : undefined}
          >
            {detail ? (
              <Input id="issue-warehouse" readOnly value={detail.warehouseName} />
            ) : (
              <WarehouseSelect
                id="issue-warehouse"
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
            label={t('inventory.issues.expenseType')}
            htmlFor="issue-type"
            error={typeError}
          >
            <NativeSelect
              id="issue-type"
              aria-invalid={typeError !== undefined || undefined}
              value={expenseTypeId ?? ''}
              onChange={(event) => {
                const next = event.target.value
                  ? Number.parseInt(event.target.value, 10)
                  : undefined;
                const before = expenseTypeId;
                setExpenseTypeId(next);
                if (next === undefined) return;
                setRequired((previous) => ({ ...previous, type: false }));
                if (detail !== null && next !== detail.expenseTypeId) {
                  patchHeader({ expenseTypeId: next }, () => setExpenseTypeId(before));
                }
              }}
            >
              <option value="">{t('inventory.issues.pickExpenseType')}</option>
              {choices.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.active ? type.name : t('inventory.issues.retiredType', { name: type.name })}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              label={t('inventory.issues.recipient')}
              htmlFor="issue-recipient"
              error={recipientError}
            >
              <div className="flex flex-col gap-2">
                <SegmentedControl
                  name={t('inventory.issues.recipientKind')}
                  options={RECIPIENT_KINDS}
                  value={recipient.kind}
                  label={(kind) => t(`inventory.issues.recipientKinds.${kind}`)}
                  onChange={(kind) => {
                    setRecipientState({ ...recipient, kind });
                    setRequired((previous) => ({ ...previous, recipient: false }));
                    // A kind with a choice kept from before is that choice again.
                    const body = recipientRequest({ ...recipient, kind });
                    if (detail !== null && body !== null) {
                      patchHeader({ recipient: body }, () => setRecipientState(recipient));
                    }
                  }}
                />
                {recipientControl()}
              </div>
            </FormField>
          </div>
          <FormField
            label={t('inventory.issues.note')}
            htmlFor="issue-note"
            error={fieldError(headerProblem, 'note')}
          >
            <Input
              id="issue-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              onBlur={leaveNote}
            />
          </FormField>
        </div>
      </HeaderCard>
      <Card role="region" aria-labelledby="issue-lines-title">
        <CardHeader>
          <CardTitle id="issue-lines-title">{t('inventory.issues.linesTitle')}</CardTitle>
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
            qty={<ScanQtyControl id="issue-scan-qty" qty={qty} onScan={onScan} />}
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
                    : t('inventory.issues.activeBinNone')}
                  {activeBin ? (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      onClick={() => setActiveBin(null)}
                    >
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
                  <span className="text-destructive">{t('inventory.issues.needHeader')}</span>
                ) : null}
                {invalidQty ? (
                  <span className="text-destructive">{t('inventory.scanQtyInvalid')}</span>
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
            <p className="text-sm text-muted-foreground">{t('inventory.issues.linesEmpty')}</p>
          ) : (
            <LinesTable
              lines={lines}
              costs={costs}
              actions
              cells={(line, name) => ({
                bin: (
                  <>
                    <span className="font-mono">{line.binCode}</span>
                    {activeBin && activeBin.id !== line.binId ? (
                      <Button
                        type="button"
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
                actions: (
                  <RowActions>
                    <RowAction
                      label={`${t('inventory.remove')}: ${name}`}
                      icon={Trash2}
                      destructive
                      onClick={() =>
                        void action.run(() => mutations.removeLine.mutateAsync(line.id))
                      }
                    />
                  </RowActions>
                ),
              })}
            />
          )}
          {detail ? <IssueTotal detail={detail} /> : null}
        </CardContent>
      </Card>
      <StickyActions summary={t('inventory.linesCount', { count: lines.length })}>
        {detail === null ? (
          <Button type="button" disabled={mutations.create.isPending} onClick={saveNew}>
            {t('common.save')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                action.clear();
                setConfirm('cancel');
              }}
            >
              {t('inventory.issues.cancel')}
            </Button>
            <Button type="button" disabled={lines.length === 0} onClick={askPost}>
              {t('inventory.issues.post')}
            </Button>
          </>
        )}
      </StickyActions>
      <ConfirmDialog
        open={confirm === 'post'}
        variant="default"
        title={t('inventory.issues.postTitle')}
        description={t('inventory.issues.postDescription')}
        confirmLabel={t('inventory.issues.post')}
        pending={mutations.post.isPending}
        problem={action.problem}
        onConfirm={post}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={t('inventory.issues.cancelTitle')}
        confirmLabel={t('inventory.issues.cancel')}
        pending={mutations.cancel.isPending}
        problem={action.problem}
        onConfirm={cancel}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
