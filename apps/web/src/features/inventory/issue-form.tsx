import type { ProblemDetails } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Check, ClipboardCheck, FilePlus2, ScanBarcode, Search, Trash2 } from 'lucide-react';
import {
  type ReactNode,
  useDeferredValue,
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
import {
  DENSE_FIELDS,
  DocumentWindow,
  ENTRY_CELL,
  ENTRY_ROW,
  ENTRY_SLOT,
  ENTRY_SLOT_CELL,
  LINES_SCROLLER,
  WINDOW_FOOT,
} from '@/components/document-layout';
import { FormField } from '@/components/form';
import { EmptyState, RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { StickyActions } from '@/components/sticky-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { TableCell, TableRow } from '@/components/ui/table';
import { Hint } from '@/components/ui/tooltip';
import { useBarcodeLookup } from '@/features/catalog/api';
import { useIssueExpenseAccounts } from '@/features/finance/api';
import { SupplierPicker } from '@/features/partners/supplier-picker';
import type { ValidationMessage } from '@/lib/forms';
import { formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type IssueDetail,
  type IssueExpenseType,
  type IssueLineRequest,
  type IssueLineUpdate,
  type IssueRecipient,
  type IssueRecipientKind,
  type IssueUpdate,
  useCustomerLookup,
  useIssueExpenseTypes,
  useIssueMutations,
  useIssueSnapshot,
  useUserLookup,
} from './api';
import { modalOpen, parseScanQty, useWarehouseOptions } from './helpers';
import { postedWarehouses } from './issue-helpers';
import {
  CorrectionLinks,
  IssueConfirmations,
  IssueTotals,
  LinesTable,
  ReturnedBanner,
} from './issue-parts';
import { useDefaultWarehouse } from './last-warehouse';
import { useScanQty } from './scan-qty';
import { ProductSearch, QtyInput, SaveState, ScanQtyField, WarehouseSelect } from './shared';
import { DateInput } from '@/components/date-input';

/** Goods leave a wholesale warehouse or a store (ADR-0081). */
const ISSUE_WAREHOUSES = ['WHOLESALE', 'STORE'] as const;
const RECIPIENT_KINDS: readonly IssueRecipientKind[] = ['USER', 'CUSTOMER', 'SUPPLIER', 'OTHER'];
/** The statuses the accountant still edits (ADR-0117 #1): posted parts are frozen line by line. */
const EDITABLE = new Set<IssueDetail['status']>(['DRAFT', 'SENT', 'RETURNED']);
/** Refusals about the header that name no field: they show in the header card. */
const HEADER_CODES = new Set([
  'EXPENSE_TYPE_INACTIVE',
  'CUSTOMER_INACTIVE',
  'SUPPLIER_INACTIVE',
  'WAREHOUSE_KIND_NOT_ALLOWED',
  'ISSUE_WAREHOUSE_CONFIRMED',
]);
const HEADER_GRID = 'grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3';
/**
 * The document's fields in one strip over the lines (ADR-0157): the date, the warehouse, the type,
 * the recipient with its kind, which needs the most room, and the note.
 */
const STRIP_GRID =
  'grid gap-2 sm:grid-cols-2 lg:grid-cols-[9.5rem_minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1.9fr)_minmax(0,1fr)]';
/** The rows' fields a little lower than the entry's, so the lines keep one height and more fit. */
const DENSE_ROWS =
  '[&_tbody_.native-select]:h-7.5 [&_tbody_[data-slot=input]]:h-7.5 [&_tbody_td]:py-0.5';
/** A box of the entry row with its icon inside. */
const ENTRY_FIELD = 'relative min-w-0 flex-1 [&_input]:pl-8!';
const ENTRY_ICON =
  'pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground';

/** The page's title, placed by the form with what only the form knows. */
type IssueHead = (extra?: { meta?: ReactNode; actions?: ReactNode }) => ReactNode;

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

const HEADER_FIELDS = ['issuedOn', 'expenseTypeId', 'recipient', 'note', 'warehouseId'];
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
 * One goods issue in one window, like the receipt (ADR-0081, ADR-0117, ADR-0157): the accountant
 * edits a new issue and one that is DRAFT, SENT or RETURNED (the lines of a confirmed warehouse are
 * frozen) in the work window: the document's fields in one strip, then one card with the entry under
 * the column heads, the lines, and the steps at its foot. A posted or cancelled issue, or one the
 * user may not change, reads as a page of cards, with the keeper's way to the confirmation screen
 * while it is sent.
 */
export function IssueForm(props: {
  detail: IssueDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
  head: IssueHead;
}) {
  const { detail } = props;
  const canManage = useHasPermission('inventory.issues.manage');
  const edits = canManage && (detail === null || EDITABLE.has(detail.status));
  return edits ? (
    <DraftEditor
      detail={detail}
      focusScan={props.focusScan}
      onCreated={props.onCreated}
      head={props.head}
    />
  ) : detail ? (
    <div className="space-y-3">
      {props.head()}
      <IssueView detail={detail} />
    </div>
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

/** «код · нэр» of the account an expense type books to, when the user may read finance. */
function useAccountLabel(): (typeId: number | undefined) => string | null {
  const canRead = useHasPermission('finance.read');
  const accounts = useIssueExpenseAccounts(canRead);
  return (typeId) => {
    if (typeId === undefined) return null;
    const row = accounts.data?.find((entry) => entry.typeId === typeId);
    if (!row?.accountCode) return null;
    return `${row.accountCode} · ${row.accountName ?? ''}`.trim();
  };
}

function ReadOnlyHeader({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  const accountOf = useAccountLabel();
  const none = t('common.none');
  const kind = t(`inventory.issues.recipientKinds.${detail.recipientKind}`);
  const account = accountOf(detail.expenseTypeId);
  const items: [string, ReactNode][] = [
    [t('inventory.date'), detail.issuedOn],
    [t('inventory.issues.defaultWarehouse'), detail.warehouseName],
    [
      t('inventory.issues.expenseType'),
      account ? (
        <>
          {detail.expenseTypeName}{' '}
          <span className="font-mono text-[0.8125rem] text-muted-foreground">{account}</span>
        </>
      ) : (
        detail.expenseTypeName
      ),
    ],
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
            <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
            <dd className="text-sm break-words">{value}</dd>
          </div>
        ))}
      </dl>
    </HeaderCard>
  );
}

/**
 * A posted, sent or cancelled issue read by someone who does not edit it: the keeper finds the
 * confirmation screen here while it is sent; the accountant makes a correction of a posted one.
 */
function IssueView({ detail }: { detail: IssueDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canManage = useHasPermission('inventory.issues.manage');
  const canConfirm = useHasPermission('inventory.issues.confirm');
  const mutations = useIssueMutations();
  const action = useAction();
  const [correctionKey, setCorrectionKey] = useState(randomUuid);
  const correct = () =>
    void action.run(async () => {
      const child = await mutations.createCorrection.mutateAsync({
        id: detail.id,
        key: correctionKey,
      });
      setCorrectionKey(randomUuid());
      toast.success(t('inventory.issues.correctionCreated'));
      await navigate(`/inventory/issues/${child.id}`);
    });
  const showCorrection = canManage && detail.status === 'POSTED';
  const showConfirm = canConfirm && detail.status === 'SENT';
  return (
    <>
      <ReturnedBanner detail={detail} />
      <ReadOnlyHeader detail={detail} />
      <Card role="region" aria-labelledby="issue-lines-title">
        <CardHeader>
          <CardTitle id="issue-lines-title">{t('inventory.issues.linesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <CorrectionLinks detail={detail} />
          <IssueConfirmations detail={detail} />
          <LinesTable
            detail={detail}
            lines={detail.lines}
            actions={false}
            cells={(line) => ({
              qty: <span className="font-mono">{formatQty(line.enteredQty)}</span>,
            })}
          />
          <IssueTotals detail={detail} />
        </CardContent>
      </Card>
      {showCorrection || showConfirm ? (
        <StickyActions summary={t('inventory.linesCount', { count: detail.lines.length })}>
          <ProblemAlert problem={action.problem} />
          {showConfirm ? (
            <Button asChild>
              <Link to={`/inventory/issues/${detail.id}/confirm`}>
                <ClipboardCheck />
                {t('inventory.issues.openConfirm')}
              </Link>
            </Button>
          ) : null}
          {showCorrection ? (
            <Button
              type="button"
              variant="outline"
              disabled={detail.correctedByIssueId !== null}
              pending={mutations.createCorrection.isPending}
              onClick={correct}
            >
              <FilePlus2 />
              {t('inventory.issues.createCorrection')}
            </Button>
          ) : null}
        </StickyActions>
      ) : null}
    </>
  );
}

/** The chosen user or customer, read-only, with «Солих». */
function ChosenRecipient(props: { id: string; value: Picked; onChange: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1.5">
      <Input
        id={props.id}
        readOnly
        title={props.value.name}
        value={props.value.code ? `${props.value.name} · ${props.value.code}` : props.value.name}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 px-2.5"
        onClick={props.onChange}
      >
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
      <ProblemAlert problem={problemFromError(query.error)} onRetry={query.refetch} />
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
 * A new issue, or one the accountant still edits (DRAFT, SENT, RETURNED). Nothing exists until the
 * first product is added or «Хадгалах» is pressed: then the draft is created with the header (and
 * that line) and the address becomes the draft's, the page staying as it is. Each header change of
 * a draft is saved at once (selects and picks on change, texts when left). One scan box: a product
 * barcode adds «Тоо» of its unit to its product's home warehouse (else the default), a repeat adds
 * to its line; scans run one after another against the latest copy of the draft. «Илгээх» hands
 * the document to the keepers (ADR-0117 #1).
 */
function DraftEditor(props: {
  detail: IssueDetail | null;
  focusScan: boolean;
  onCreated: (id: number) => void;
  head: IssueHead;
}) {
  const { detail } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useIssueMutations();
  const lookupBarcode = useBarcodeLookup();
  const snapshot = useIssueSnapshot();
  const types = useIssueExpenseTypes();
  const accountOf = useAccountLabel();
  const warehouses = useWarehouseOptions(ISSUE_WAREHOUSES);
  const { defaultId, remember } = useDefaultWarehouse(warehouses.options, 'issue');
  const action = useAction();
  const qty = useScanQty();
  const scanArea = useRef<HTMLDivElement>(null);
  const searchArea = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [headerSaved, setHeaderSaved] = useState(false);

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
  const [missing, setMissing] = useState<string | null>(null);
  const [invalidQty, setInvalidQty] = useState(false);
  const [needHeader, setNeedHeader] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [confirm, setConfirm] = useState<'send' | 'cancel' | null>(null);
  const [sendKey, setSendKey] = useState(randomUuid);

  const lines = detail?.lines ?? [];
  const frozen = postedWarehouses(detail);
  const partlyPosted = frozen.size > 0;
  const dateError = dateMessage(issuedOn) ?? fieldError(headerProblem, 'issuedOn');
  const request = recipientRequest(recipient);
  const ready =
    warehouseId !== undefined &&
    expenseTypeId !== undefined &&
    request !== null &&
    dateMessage(issuedOn) === undefined;
  const choices = typeChoices(types.data ?? [], detail?.expenseTypeId);
  const account = accountOf(expenseTypeId);

  // A line added shows where it landed: the lines scroll to it and it flashes once.
  const lastId = lines.at(-1)?.id ?? null;
  const [last, setLast] = useState<{ id: number | null; landed: number | null }>({
    id: lastId,
    landed: null,
  });
  if (last.id !== lastId) {
    const landed = lastId !== null && (last.id === null || lastId > last.id);
    setLast({ id: lastId, landed: landed ? lastId : null });
  }
  useLayoutEffect(() => {
    const box = scroller.current;
    if (box && last.landed !== null) box.scrollTop = box.scrollHeight;
  }, [last.landed]);

  // F2 returns to the product search; Ctrl+Enter takes the step, from anywhere in the window (a
  // scanner's Enter comes alone).
  const keyDown = useEffectEvent((event: KeyboardEvent) => {
    if (confirm !== null || modalOpen()) return;
    if (event.key === 'F2') {
      event.preventDefault();
      searchArea.current?.querySelector('input')?.focus();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
    if (detail === null) {
      event.preventDefault();
      event.stopPropagation();
      saveNew();
    } else if (detail.status !== 'SENT' && lines.length > 0 && request !== null) {
      event.preventDefault();
      event.stopPropagation();
      askSend();
    }
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyDown(event);
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // «Солих» hands the focus to the search box it brings back.
  useEffect(() => {
    if (!focusRecipient) return;
    document.getElementById('issue-recipient')?.focus();
    setFocusRecipient(false);
  }, [focusRecipient]);

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
        setHeaderSaved(true);
      } catch (error) {
        setHeaderSaved(false);
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

  /** Adds to the product's line (unless its warehouse is frozen), or a new line. */
  const addUnit = async (productUnitId: number, amount: string): Promise<boolean> => {
    const id = draftId.current;
    if (id === null) return createDraft({ productUnitId, enteredQty: amount });
    const issue = snapshot(id) ?? detail;
    const locked = postedWarehouses(issue ?? null);
    const same = issue?.lines.find(
      (line) => line.productUnitId === productUnitId && !locked.has(line.warehouseId),
    );
    if (same) {
      await mutations.updateLine.mutateAsync({
        id: same.id,
        body: { enteredQty: new Decimal(same.enteredQty).plus(amount).toString() },
      });
    } else {
      await mutations.addLine.mutateAsync({ id, body: { productUnitId, enteredQty: amount } });
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
      const resolved = await orNull(lookupBarcode.mutateAsync(code));
      if (!resolved) {
        setMissing(code);
        entry.giveBack();
        return;
      }
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

  const askSend = () => {
    if (!ready) {
      flagHeader();
      return;
    }
    setSendKey(randomUuid());
    action.clear();
    setConfirm('send');
  };
  const send = () =>
    void action.run(async () => {
      const id = draftId.current;
      if (id === null) return;
      await mutations.send.mutateAsync({ id, key: sendKey });
      setConfirm(null);
      toast.success(t('inventory.issues.sent'));
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

  const strip = (
    <Card
      size="sm"
      role="region"
      aria-label={t('inventory.issues.header')}
      // The recipient's matches float over the lines below.
      className="shrink-0 gap-0 overflow-visible py-2"
    >
      <CardContent className={DENSE_FIELDS}>
        <div className={STRIP_GRID}>
          <FormField label={t('inventory.date')} htmlFor="issue-date" error={dateError}>
            <DateInput
              id="issue-date"
              max={businessDate()}
              aria-invalid={dateError !== undefined || undefined}
              value={issuedOn}
              onChange={(value) => setIssuedOn(value)}
              onBlur={() => {
                if (detail !== null && issuedOn !== detail.issuedOn && !dateMessage(issuedOn)) {
                  const before = detail.issuedOn;
                  patchHeader({ issuedOn }, () => setIssuedOn(before));
                }
              }}
            />
          </FormField>
          <FormField
            label={t('inventory.issues.defaultWarehouse')}
            htmlFor="issue-warehouse"
            error={required.warehouse ? 'validation.required' : undefined}
          >
            <Hint label={t('inventory.issues.defaultWarehouseHint')}>
              <div>
                <WarehouseSelect
                  id="issue-warehouse"
                  options={warehouses.options}
                  value={warehouseId}
                  emptyLabel={t('inventory.pickWarehouse')}
                  onChange={(id) => {
                    if (id === undefined) {
                      if (detail === null) setPickedWarehouse(undefined);
                      return;
                    }
                    setRequired((previous) => ({ ...previous, warehouse: false }));
                    if (detail === null) setPickedWarehouse(id);
                    else if (id !== detail.warehouseId) patchHeader({ warehouseId: id });
                  }}
                />
              </div>
            </Hint>
          </FormField>
          <FormField
            label={t('inventory.issues.expenseType')}
            htmlFor="issue-type"
            error={typeError}
          >
            <NativeSelect
              id="issue-type"
              aria-invalid={typeError !== undefined || undefined}
              disabled={partlyPosted}
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
          <FormField
            label={t('inventory.issues.recipient')}
            htmlFor="issue-recipient"
            error={recipientError}
          >
            {/* The kind and the name share one field's line: the name takes what is left. */}
            <div className="flex min-w-0 [&>:last-child]:min-w-0 [&>:last-child]:flex-1 [&>:last-child_[data-slot=input]]:rounded-l-none [&>[data-slot=input]]:rounded-l-none">
              <NativeSelect
                aria-label={t('inventory.issues.recipientKind')}
                className="w-[7.25rem] shrink-0 rounded-r-none border-r-0"
                disabled={partlyPosted}
                value={recipient.kind}
                onChange={(event) => {
                  const kind = RECIPIENT_KINDS.find((entry) => entry === event.target.value);
                  if (!kind) return;
                  setRecipientState({ ...recipient, kind });
                  setRequired((previous) => ({ ...previous, recipient: false }));
                  // A kind with a choice kept from before is that choice again.
                  const body = recipientRequest({ ...recipient, kind });
                  if (detail !== null && body !== null) {
                    patchHeader({ recipient: body }, () => setRecipientState(recipient));
                  }
                }}
              >
                {RECIPIENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`inventory.issues.recipientKinds.${kind}`)}
                  </option>
                ))}
              </NativeSelect>
              {recipientControl()}
            </div>
          </FormField>
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
      </CardContent>
    </Card>
  );

  return (
    <DocumentWindow>
      {props.head({
        meta: detail ? <IssueConfirmations detail={detail} /> : null,
        actions: (
          <>
            {account ? (
              <span className="font-mono text-[0.8125rem] text-muted-foreground">{account}</span>
            ) : null}
            <SaveState saving={mutations.update.isPending} saved={headerSaved} />
          </>
        ),
      })}
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {detail ? <ReturnedBanner detail={detail} /> : null}
        <ProblemAlert
          problem={
            (headerProblem && !namesField(headerProblem) ? headerProblem : null) ??
            problemFromError(warehouses.error) ??
            problemFromError(types.error)
          }
        />
        {detail?.correctsIssueId !== null && detail?.correctsIssueId !== undefined ? (
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 px-1">
            <CorrectionLinks detail={detail} />
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('inventory.issues.correctionHint')}
            </p>
          </div>
        ) : null}
        {strip}
        <Card
          size="sm"
          role="region"
          aria-label={t('inventory.issues.linesTitle')}
          className="min-h-0 flex-1 gap-0 py-0"
        >
          <div ref={scroller} className={`${LINES_SCROLLER} ${DENSE_ROWS}`}>
            <LinesTable
              detail={detail}
              lines={lines}
              actions
              landedId={last.landed}
              removingId={mutations.removeLine.isPending ? mutations.removeLine.variables : null}
              entry={{
                label: t('inventory.receipt.panel.title'),
                rows: ({ before, after }) => (
                  <>
                    <TableRow className={ENTRY_ROW}>
                      <TableCell colSpan={before} className={ENTRY_CELL}>
                        <div className="flex min-w-0 items-center gap-1.5">
                          <div ref={scanArea} className={ENTRY_FIELD}>
                            <ScanBarcode aria-hidden className={ENTRY_ICON} />
                            <ScanBox
                              compact
                              autoFocus={props.focusScan}
                              label={t('inventory.scanLabel')}
                              placeholder={t('inventory.scanPlaceholder')}
                              onScan={onScan}
                            />
                          </div>
                          <div ref={searchArea} className={ENTRY_FIELD}>
                            <Search aria-hidden className={ENTRY_ICON} />
                            <ProductSearch
                              className="max-w-none"
                              onScan={onScan}
                              onPick={(product) =>
                                pick(product.baseUnit.id, product.baseUnit.uomName, product.name)
                              }
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className={ENTRY_CELL}>
                        <ScanQtyField
                          id="issue-scan-qty"
                          label={t('inventory.scanQty')}
                          className="ml-auto w-24"
                          qty={qty}
                          onScan={onScan}
                        />
                      </TableCell>
                      <TableCell colSpan={after} className={ENTRY_CELL} />
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={before + 1 + after} className={ENTRY_SLOT_CELL}>
                        <div className={ENTRY_SLOT}>
                          <div
                            aria-live="polite"
                            className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 has-data-[slot=alert]:basis-full"
                          >
                            {added ? (
                              <span className="inline-flex min-w-0 items-center gap-1 font-medium">
                                <Check aria-hidden className="size-3.5 shrink-0 text-success" />
                                <span className="truncate">
                                  {added.base
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
                                      })}
                                </span>
                              </span>
                            ) : null}
                            {needHeader ? (
                              <span className="text-destructive">
                                {t('inventory.issues.needHeader')}
                              </span>
                            ) : null}
                            {invalidQty ? (
                              <span className="text-destructive">
                                {t('inventory.scanQtyInvalid')}
                              </span>
                            ) : null}
                            {missing ? (
                              <span className="text-destructive">
                                {t('inventory.scanNotFound', { code: missing })}
                              </span>
                            ) : null}
                            {qty.value !== '1' ? (
                              <span className="text-muted-foreground">
                                {t('inventory.scanQtyHint')}
                              </span>
                            ) : null}
                            <ProblemAlert problem={confirm ? null : action.problem} />
                          </div>
                          <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
                            <Kbd>{t('inventory.receipt.panel.keys.search')}</Kbd>
                            {t('inventory.receipt.panel.hints.search')}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  </>
                ),
              }}
              cells={(line, name) => {
                const locked = frozen.has(line.warehouseId);
                return {
                  warehouse: locked ? undefined : (
                    <WarehouseSelect
                      options={warehouses.options.filter((option) => !frozen.has(option.id))}
                      value={line.warehouseId}
                      label={t('inventory.issues.moveLineTo', { product: name })}
                      emptyLabel={line.warehouseName}
                      className="min-w-36"
                      onChange={(id) => {
                        if (id !== undefined && id !== line.warehouseId)
                          saveLine(line.id, { warehouseId: id });
                      }}
                    />
                  ),
                  qty: locked ? (
                    <span className="font-mono">{formatQty(line.enteredQty)}</span>
                  ) : (
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
                      {locked ? null : (
                        <RowAction
                          label={`${t('inventory.remove')}: ${name}`}
                          icon={Trash2}
                          destructive
                          onClick={() =>
                            void action.run(() => mutations.removeLine.mutateAsync(line.id))
                          }
                        />
                      )}
                    </RowActions>
                  ),
                };
              }}
            />
            {lines.length === 0 ? (
              <EmptyState title={t('inventory.issues.linesEmpty')} icon={ScanBarcode} />
            ) : null}
          </div>
          <div className={WINDOW_FOOT}>
            <span className="font-medium">
              {t('inventory.linesCount', { count: lines.length })}
            </span>
            {detail ? <IssueTotals detail={detail} inline /> : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {detail === null ? (
                <Button
                  type="button"
                  size="sm"
                  pending={mutations.create.isPending}
                  aria-keyshortcuts="Control+Enter"
                  onClick={saveNew}
                >
                  {t('common.save')}
                  <Kbd>{t('inventory.receipt.panel.keys.post')}</Kbd>
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={partlyPosted}
                    title={partlyPosted ? t('inventory.issues.cancelBlocked') : undefined}
                    onClick={() => {
                      action.clear();
                      setConfirm('cancel');
                    }}
                  >
                    {t('inventory.issues.cancel')}
                  </Button>
                  {detail.status === 'SENT' ? null : (
                    <Button
                      type="button"
                      size="sm"
                      disabled={lines.length === 0 || request === null}
                      aria-keyshortcuts="Control+Enter"
                      onClick={askSend}
                    >
                      {t('inventory.issues.send')}
                      <Kbd>{t('inventory.receipt.panel.keys.post')}</Kbd>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
      <ConfirmDialog
        open={confirm === 'send'}
        variant="default"
        title={t('inventory.issues.sendTitle')}
        description={t('inventory.issues.sendDescription')}
        confirmLabel={t('inventory.issues.send')}
        pending={mutations.send.isPending}
        problem={action.problem}
        onConfirm={send}
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
    </DocumentWindow>
  );
}
