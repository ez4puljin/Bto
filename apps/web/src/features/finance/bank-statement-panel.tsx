import {
  BANK_EXPORT_FILES,
  BANK_EXPORT_TYPES,
  BANK_LINE_ACTIONS,
  type BankExportType,
  type BankLineAction,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDateTime } from '@tugeel/shared/time';
import {
  ArrowLeftRight,
  BookCheck,
  Check,
  CircleAlert,
  Download,
  Landmark,
  Lock,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { EmptyState, ListCard, ListTable, SegmentedControl, SkeletonRows } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCustomers, useSuppliers } from '@/features/partners/api';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { accountOption } from './account-option';
import { useGlAccounts, useMoneyAccounts } from './api';
import {
  type BankLine,
  type BankLinePatch,
  type BankPostResult,
  useBankMutations,
  useBankRules,
  useBankStatement,
} from './bank-api';
import { save } from './report-helpers';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'select', kind: 'check' },
  { key: 'no', kind: 'count', width: 2.75 },
  { key: 'date', kind: 'date', width: 6 },
  { key: 'credit', kind: 'money', width: 6.75 },
  { key: 'debit', kind: 'money', width: 6.75 },
  { key: 'bankText', kind: 'text', weight: 2, min: 8 },
  { key: 'party', kind: 'text', weight: 2, min: 8.5 },
  { key: 'account', kind: 'text', weight: 2, min: 8 },
  { key: 'description', kind: 'text', weight: 3, min: 8.5 },
  { key: 'action', kind: 'status', width: 6.5 },
  { key: 'export', kind: 'status', width: 5.5 },
  { key: 'status', kind: 'status', width: 4.5 },
];

/** Every cell's control is the height of a compact row, so a statement reads as a table. */
const COMPACT = 'h-8 text-[0.8125rem] md:text-[0.8125rem]';
const COMPACT_SELECT = '[&_input]:h-8 [&_input]:text-[0.8125rem] md:[&_input]:text-[0.8125rem]';

/** A statement's lines to fill and write to the books (ADR-0169). */
export function BankStatementPanel(props: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const canWork = useHasPermission('finance.journal.manage');
  const canPost = useHasPermission('finance.payments.record') && canWork;
  const statement = useBankStatement(props.id);
  const mutations = useBankMutations();
  const action = useAction();
  const rules = useBankRules();
  const accounts = useGlAccounts();
  const [view, setView] = useState<'main' | 'fees'>('main');
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [confirm, setConfirm] = useState<'post' | 'swap' | null>(null);
  const [reversing, setReversing] = useState<BankLine | null>(null);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<BankPostResult | null>(null);

  const lines = statement.data?.lines ?? [];
  const visible = lines.filter((line) => (line.kind === 'FEE') === (view === 'fees'));
  const editable = (line: BankLine) => canWork && line.postedAt === null && line.kind === 'NORMAL';
  const bankAccountId = statement.data?.moneyAccountId ?? null;

  const accountOptions = useMemo(() => {
    const all = (accounts.data ?? []).filter(
      (account) => account.status === 'ACTIVE' && account.journal !== 'INVENTORY',
    );
    const first = rules.data?.counterAccountIds ?? [];
    const rank = (id: number) => {
      const at = first.indexOf(id);
      return at === -1 ? first.length : at;
    };
    return [...all]
      .sort((a, b) => rank(a.id) - rank(b.id) || a.code.localeCompare(b.code))
      .map(accountOption);
  }, [accounts.data, rules.data]);

  const ready = lines.filter((line) => line.postedAt === null && line.missing.length === 0).length;

  const saveLine = (line: BankLine, patch: BankLinePatch) =>
    void action.run(() =>
      mutations.updateLine.mutateAsync({ id: props.id, lineId: line.id, patch }),
    );

  const exportFiles = async () => {
    await action.run(async () => {
      const files = BANK_EXPORT_FILES.filter((file) =>
        lines.some(
          (line) =>
            line.kind !== 'FEE' &&
            (file === 'RECEIVABLE'
              ? new Decimal(line.credit).gt(0)
              : new Decimal(line.debit).gt(0) && line.exportType === file),
        ),
      );
      if (files.length === 0) {
        toast.info(t('finance.bankStatements.statement.exportEmpty'));
        return;
      }
      for (const file of files) {
        const blob = await mutations.exportStatement.mutateAsync({ id: props.id, file });
        const data = statement.data;
        save(
          blob,
          `${data?.accountNumber ?? ''}_${data?.statementDate ?? ''}_${t(`finance.bankStatements.erkhet.files.${file}`)}.xlsx`,
        );
      }
      toast.success(t('finance.bankStatements.statement.exported', { count: files.length }));
    });
  };

  const toggle = (id: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const editableVisible = visible.filter(editable);
  const allChecked =
    editableVisible.length > 0 && editableVisible.every((line) => selected.has(line.id));

  if (statement.error) {
    return (
      <ProblemAlert
        problem={problemFromError(statement.error)}
        onRetry={() => void statement.refetch()}
      />
    );
  }
  const data = statement.data;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3 shadow-card ring-1 ring-black/[0.06]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Landmark aria-hidden className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold tabular-nums">{data?.accountNumber}</span>
            {data?.accountCode ? <Badge variant="secondary">{data.accountCode}</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {data
              ? t('finance.bankStatements.statement.period', {
                  from: data.statementDate,
                  to: data.dateTo,
                  currency: data.currency,
                })
              : null}
          </div>
        </div>
        {data ? (
          <div className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] tabular-nums">
            <Stat
              label={t('finance.bankStatements.statement.statCredit')}
              value={formatMnt(data.totalCredit)}
              tone="text-success"
            />
            <Stat
              label={t('finance.bankStatements.statement.statDebit')}
              value={formatMnt(data.totalDebit)}
              tone="text-destructive"
            />
            <Stat
              label={t('finance.bankStatements.statement.statFilled')}
              value={`${data.filledCount}/${data.lineCount}`}
              tone="text-link"
            />
            <Stat
              label={t('finance.bankStatements.statement.statPosted')}
              value={`${data.postedCount}/${data.lineCount}`}
              tone="text-foreground"
            />
          </div>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedControl
            name={t('finance.bankStatements.statement.viewsLabel')}
            options={['main', 'fees'] as const}
            value={view}
            label={(value) => t(`finance.bankStatements.statement.views.${value}`)}
            onChange={(value) => {
              setView(value);
              setSelected(new Set());
            }}
          />
          {canWork ? (
            <Button
              variant="outline"
              title={t('finance.bankStatements.statement.swapHint')}
              disabled={(data?.postedCount ?? 0) > 0}
              onClick={() => setConfirm('swap')}
            >
              <ArrowLeftRight />
              {t('finance.bankStatements.statement.swap')}
            </Button>
          ) : null}
          <Button
            variant="outline"
            pending={mutations.exportStatement.isPending}
            onClick={() => void exportFiles()}
          >
            <Download />
            {t('finance.bankStatements.statement.export')}
          </Button>
          {canPost ? (
            <Button disabled={ready === 0 || !bankAccountId} onClick={() => setConfirm('post')}>
              <BookCheck />
              {t('finance.bankStatements.statement.post')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('finance.bankStatements.statement.close')}
            onClick={props.onClose}
          >
            <X />
          </Button>
        </div>
      </div>

      {data && bankAccountId === null ? (
        <LinkAccount id={props.id} number={data.accountNumber} disabled={!canWork} />
      ) : null}
      <ProblemAlert problem={action.problem} />
      {result ? <PostOutcome result={result} /> : null}

      {selected.size > 0 ? (
        <BulkBar
          statementId={props.id}
          lineIds={[...selected]}
          accountOptions={accountOptions}
          onClear={() => setSelected(new Set())}
        />
      ) : null}

      <ListCard scroll>
        <ListTable columns={COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>
                {view === 'main' && canWork ? (
                  <Checkbox
                    aria-label={t('finance.bankStatements.columns.select')}
                    checked={allChecked}
                    disabled={editableVisible.length === 0}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked === true
                          ? new Set(editableVisible.map((line) => line.id))
                          : new Set(),
                      )
                    }
                  />
                ) : null}
              </TableHead>
              <TableHead>{t('finance.bankStatements.columns.no')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.date')}</TableHead>
              <TableHead className="text-right">
                {t('finance.bankStatements.columns.credit')}
              </TableHead>
              <TableHead className="text-right">
                {t('finance.bankStatements.columns.debit')}
              </TableHead>
              <TableHead>{t('finance.bankStatements.columns.bankText')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.party')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.account')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.description')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.action')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.export')}</TableHead>
              <TableHead>{t('finance.bankStatements.columns.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statement.isPending ? <SkeletonRows columns={COLUMNS.length} /> : null}
            {visible.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                accountOptions={accountOptions}
                manyDays={data ? data.statementDate !== data.dateTo : false}
                editable={editable(line)}
                canReverse={canPost}
                selected={selected.has(line.id)}
                onToggle={() => toggle(line.id)}
                onSave={(patch) => saveLine(line, patch)}
                onReverse={() => {
                  setReason('');
                  setReversing(line);
                }}
              />
            ))}
          </TableBody>
        </ListTable>
        {!statement.isPending && visible.length === 0 ? (
          <EmptyState
            title={
              view === 'main'
                ? t('finance.bankStatements.statement.noLines')
                : t('finance.bankStatements.statement.noFees')
            }
          />
        ) : null}
      </ListCard>

      <ConfirmDialog
        open={confirm === 'post'}
        variant="default"
        title={t('finance.bankStatements.statement.postTitle')}
        description={t('finance.bankStatements.statement.postBody', { count: ready })}
        confirmLabel={t('finance.bankStatements.statement.post')}
        pending={mutations.post.isPending}
        problem={problemFromError(mutations.post.error)}
        onClose={() => {
          setConfirm(null);
          mutations.post.reset();
        }}
        onConfirm={() =>
          mutations.post.mutate(props.id, {
            onSuccess: (outcome) => {
              setConfirm(null);
              setResult(outcome);
              setSelected(new Set());
              if (outcome.posted > 0) {
                toast.success(
                  t('finance.bankStatements.statement.posted', { count: outcome.posted }),
                );
              }
            },
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'swap'}
        variant="default"
        title={t('finance.bankStatements.statement.swapTitle')}
        description={t('finance.bankStatements.statement.swapBody')}
        confirmLabel={t('finance.bankStatements.statement.swap')}
        pending={mutations.swap.isPending}
        problem={problemFromError(mutations.swap.error)}
        onClose={() => {
          setConfirm(null);
          mutations.swap.reset();
        }}
        onConfirm={() =>
          mutations.swap.mutate(props.id, {
            onSuccess: () => {
              setConfirm(null);
              toast.success(t('finance.bankStatements.statement.swapped'));
            },
          })
        }
      />
      <ConfirmDialog
        open={reversing !== null}
        initialFocus="first"
        title={t('finance.bankStatements.statement.reverseTitle')}
        description={t('finance.bankStatements.statement.reverseBody')}
        confirmLabel={t('finance.bankStatements.statement.reverse')}
        pending={mutations.reverse.isPending}
        disabled={reason.trim() === ''}
        problem={problemFromError(mutations.reverse.error)}
        onClose={() => {
          setReversing(null);
          mutations.reverse.reset();
        }}
        onConfirm={() => {
          if (!reversing) return;
          mutations.reverse.mutate(
            { id: props.id, lineId: reversing.id, reason: reason.trim() },
            {
              onSuccess: () => {
                setReversing(null);
                setResult(null);
                toast.success(t('finance.bankStatements.statement.reversed'));
              },
            },
          );
        }}
      >
        <FormField
          htmlFor="bank-line-reason"
          label={t('finance.bankStatements.statement.reverseReason')}
        >
          <Input
            id="bank-line-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}

function Stat(props: { label: string; value: string; tone: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md bg-canvas px-2 py-0.5">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span className={cn('font-medium', props.tone)}>{props.value}</span>
    </span>
  );
}

function PostOutcome({ result }: { result: BankPostResult }) {
  const { t } = useTranslation();
  if (result.failures.length === 0 && result.skipped === 0) return null;
  return (
    <Alert variant={result.failures.length > 0 ? 'destructive' : 'default'}>
      <CircleAlert />
      {result.failures.length > 0 ? (
        <AlertTitle>{t('finance.bankStatements.statement.failedTitle')}</AlertTitle>
      ) : null}
      <AlertDescription>
        {result.failures.map((failure) => (
          <div key={failure.lineId}>
            {t('finance.bankStatements.statement.failedLine', {
              lineNo: failure.lineNo,
              message: t(`errors.${failure.code}`, { defaultValue: failure.detail }),
            })}
          </div>
        ))}
        {result.skipped > 0 ? (
          <div>{t('finance.bankStatements.statement.skipped', { count: result.skipped })}</div>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

function LineRow(props: {
  line: BankLine;
  accountOptions: readonly { value: string; label: string; keys: readonly string[] }[];
  /** A statement of one day shows only the time; the date is in its header. */
  manyDays: boolean;
  editable: boolean;
  canReverse: boolean;
  selected: boolean;
  onToggle: () => void;
  onSave: (patch: BankLinePatch) => void;
  onReverse: () => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const label = (field: string) =>
    t('finance.bankStatements.statement.lineLabel', { lineNo: line.lineNo, field });
  const credit = new Decimal(line.credit);
  const debit = new Decimal(line.debit);
  const posted = line.postedAt !== null;
  const lockHint =
    line.kind === 'SETTLEMENT'
      ? t('finance.bankStatements.statement.lockedSettlement')
      : line.kind === 'FEE'
        ? t('finance.bankStatements.statement.lockedFee')
        : undefined;
  const time = businessDateTime(new Date(line.txnAt)).slice(11);
  const partyName = line.customerName ?? line.supplierName;
  const partyCode = line.customerCode ?? line.supplierCode;
  const partyText = partyName ? `${partyName} · ${partyCode ?? ''}` : '';
  const accountText = line.counterAccountCode
    ? `${line.counterAccountCode} · ${line.counterAccountName ?? ''}`
    : '';

  return (
    <TableRow
      data-state={props.selected ? 'selected' : undefined}
      className={cn(posted && 'bg-canvas/60')}
    >
      <TableCell>
        {props.editable ? (
          <Checkbox
            aria-label={label(t('finance.bankStatements.columns.select'))}
            checked={props.selected}
            onCheckedChange={props.onToggle}
          />
        ) : null}
      </TableCell>
      <TableCell className="text-muted-foreground tabular-nums">{line.lineNo}</TableCell>
      <TableCell
        className="text-xs text-muted-foreground tabular-nums"
        title={`${line.businessDate} ${time}`}
      >
        {props.manyDays ? `${line.businessDate.slice(5)} ` : null}
        {time}
      </TableCell>
      <TableCell className="text-right font-medium text-success tabular-nums">
        {credit.gt(0) ? formatMnt(line.credit) : null}
      </TableCell>
      <TableCell className="text-right font-medium text-destructive tabular-nums">
        {debit.gt(0) ? formatMnt(line.debit) : null}
      </TableCell>
      <TableCell title={line.bankDescription}>
        <div className="truncate text-[0.8125rem]">{line.bankDescription}</div>
        {line.bankCounterpart ? (
          <div className="truncate text-xs text-muted-foreground tabular-nums">
            {line.bankCounterpart}
          </div>
        ) : null}
      </TableCell>
      {props.editable ? (
        <>
          <TableCell>
            <PartyCell
              ariaLabel={label(t('finance.bankStatements.columns.party'))}
              chosen={
                line.customerId !== null
                  ? `C:${line.customerId}`
                  : line.supplierId !== null
                    ? `S:${line.supplierId}`
                    : ''
              }
              chosenLabel={partyText}
              invalid={line.missing.includes('party')}
              onChange={(party) => props.onSave(party)}
            />
          </TableCell>
          <TableCell>
            <SearchSelect
              aria-label={label(t('finance.bankStatements.columns.account'))}
              className={COMPACT_SELECT}
              value={line.counterAccountId === null ? '' : String(line.counterAccountId)}
              options={props.accountOptions}
              invalid={line.missing.includes('account')}
              onChange={(value) => props.onSave({ counterAccountId: Number.parseInt(value, 10) })}
              onClear={() => props.onSave({ counterAccountId: null })}
            />
          </TableCell>
          <TableCell>
            <DescriptionCell
              ariaLabel={label(t('finance.bankStatements.columns.description'))}
              value={line.description}
              invalid={line.missing.includes('description')}
              onSave={(description) => props.onSave({ description })}
            />
          </TableCell>
          <TableCell>
            <NativeSelect
              aria-label={label(t('finance.bankStatements.columns.action'))}
              className={cn(COMPACT, 'pl-2.5')}
              value={line.action ?? ''}
              aria-invalid={line.missing.includes('action') ? true : undefined}
              onChange={(event) =>
                props.onSave({ action: (event.target.value || null) as BankLineAction | null })
              }
            >
              <option value="">{t('finance.bankStatements.empty')}</option>
              {BANK_LINE_ACTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`finance.bankStatements.actions.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </TableCell>
          <TableCell>
            {debit.gt(0) ? (
              <NativeSelect
                aria-label={label(t('finance.bankStatements.columns.export'))}
                className={cn(COMPACT, 'pl-2.5')}
                value={line.exportType ?? ''}
                aria-invalid={line.missing.includes('export') ? true : undefined}
                onChange={(event) =>
                  props.onSave({
                    exportType: (event.target.value || null) as BankExportType | null,
                  })
                }
              >
                <option value="">{t('finance.bankStatements.empty')}</option>
                {BANK_EXPORT_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`finance.bankStatements.exportTypes.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <span className="text-xs text-muted-foreground">
                {t('finance.bankStatements.receivableExport')}
              </span>
            )}
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="truncate text-[0.8125rem]" title={partyText}>
            {partyText}
          </TableCell>
          <TableCell className="truncate text-[0.8125rem]" title={accountText}>
            {accountText}
          </TableCell>
          <TableCell className="truncate text-[0.8125rem]" title={line.description}>
            {line.description}
          </TableCell>
          <TableCell className="text-xs">
            {line.action ? t(`finance.bankStatements.actions.${line.action}`) : null}
          </TableCell>
          <TableCell className="text-xs">
            {debit.gt(0) && line.exportType
              ? t(`finance.bankStatements.exportTypes.${line.exportType}`)
              : credit.gt(0)
                ? t('finance.bankStatements.receivableExport')
                : null}
          </TableCell>
        </>
      )}
      <TableCell>
        {posted ? (
          <span className="flex items-center gap-0.5">
            <Link
              className="inline-flex size-7 items-center justify-center rounded-full text-success hover:bg-accent"
              aria-label={t('finance.bankStatements.statement.inBooks')}
              title={t('finance.bankStatements.statement.openDocument')}
              to={
                line.paymentId !== null
                  ? `/finance/payments?payment=${line.paymentId}`
                  : `/finance/journal?entry=${line.journalEntryId ?? ''}`
              }
            >
              <Check aria-hidden className="size-4 shrink-0" />
            </Link>
            {props.canReverse ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t('finance.bankStatements.statement.reverseOf', {
                  lineNo: line.lineNo,
                })}
                onClick={props.onReverse}
              >
                <Undo2 />
              </Button>
            ) : null}
          </span>
        ) : lockHint ? (
          <span className="text-muted-foreground" title={lockHint}>
            <Lock aria-label={lockHint} className="size-3.5" />
          </span>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

/** A text saved when the field is left: only the cell that changed goes to the server. */
function DescriptionCell(props: {
  ariaLabel: string;
  value: string;
  invalid: boolean;
  onSave: (value: string) => void;
}) {
  const [text, setText] = useState(props.value);
  const [seen, setSeen] = useState(props.value);
  if (seen !== props.value) {
    setSeen(props.value);
    setText(props.value);
  }
  return (
    <Input
      aria-label={props.ariaLabel}
      aria-invalid={props.invalid ? true : undefined}
      className={COMPACT}
      title={text}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text.trim() !== props.value.trim()) props.onSave(text);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

/** A customer or a supplier typed into one field: the old tool's single list of parties. */
function PartyCell(props: {
  ariaLabel: string;
  chosen: string;
  chosenLabel: string;
  invalid?: boolean;
  className?: string;
  placeholder?: string;
  onChange: (patch: BankLinePatch, label: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const customers = useCustomers({ q, status: 'ACTIVE' }, { enabled: q !== '', limit: 15 });
  const suppliers = useSuppliers({ q, status: 'ACTIVE' }, { enabled: q !== '', limit: 15 });
  const options =
    q === ''
      ? []
      : [
          ...(customers.data?.pages[0]?.data ?? []).map((row) => ({
            value: `C:${row.id}`,
            label: `${row.name} · ${row.code}`,
          })),
          ...(suppliers.data?.pages[0]?.data ?? []).map((row) => ({
            value: `S:${row.id}`,
            label: `${row.name} · ${row.code} (${t('finance.bankStatements.party.supplier')})`,
          })),
        ];
  return (
    <SearchSelect
      aria-label={props.ariaLabel}
      className={cn(COMPACT_SELECT, props.className)}
      value={props.chosen}
      chosenLabel={props.chosenLabel}
      placeholder={props.placeholder ?? t('finance.bankStatements.party.search')}
      options={options}
      {...(props.invalid === undefined ? {} : { invalid: props.invalid })}
      searching={customers.isFetching || suppliers.isFetching}
      onSearch={setSearch}
      onClear={() => props.onChange({ customerId: null, supplierId: null }, '')}
      onChange={(value) => {
        const id = Number.parseInt(value.slice(2), 10);
        const label = options.find((option) => option.value === value)?.label ?? '';
        props.onChange(value.startsWith('C:') ? { customerId: id } : { supplierId: id }, label);
      }}
    />
  );
}

/** The same fields on every ticked line, or each line's text from its own bank text. */
function BulkBar(props: {
  statementId: number;
  lineIds: number[];
  accountOptions: readonly { value: string; label: string; keys: readonly string[] }[];
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useBankMutations();
  const action = useAction();
  const [party, setParty] = useState<{ patch: BankLinePatch; value: string; label: string } | null>(
    null,
  );
  const [account, setAccount] = useState('');
  const [description, setDescription] = useState('');
  const [lineAction, setLineAction] = useState('');
  const [exportType, setExportType] = useState('');

  const apply = async (fromBank: boolean) => {
    const patch: BankLinePatch = {
      ...(party ? party.patch : {}),
      ...(account ? { counterAccountId: Number.parseInt(account, 10) } : {}),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(lineAction ? { action: lineAction as BankLineAction } : {}),
      ...(exportType ? { exportType: exportType as BankExportType } : {}),
    };
    await action.run(async () => {
      const done = await mutations.bulk.mutateAsync({
        id: props.statementId,
        lineIds: props.lineIds,
        patch,
        ...(fromBank ? { descriptionFromBank: true } : {}),
      });
      toast.success(t('finance.bankStatements.bulk.applied', { count: done.updated }));
      props.onClear();
    });
  };
  const nothing = !party && !account && !description.trim() && !lineAction && !exportType;

  return (
    <div
      role="region"
      aria-label={t('finance.bankStatements.bulk.selected', { count: props.lineIds.length })}
      className="space-y-2 rounded-xl bg-secondary p-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{t('finance.bankStatements.bulk.selected', { count: props.lineIds.length })}</Badge>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={t('finance.bankStatements.bulk.clear')}
          onClick={props.onClear}
        >
          <X />
        </Button>
        <PartyCell
          ariaLabel={t('finance.bankStatements.bulk.party')}
          placeholder={t('finance.bankStatements.bulk.party')}
          className="w-56"
          chosen={party?.value ?? ''}
          chosenLabel={party?.label ?? ''}
          onChange={(patch, partyLabel) => {
            const id = patch.customerId ?? patch.supplierId;
            setParty(
              id
                ? { patch, value: `${patch.customerId ? 'C' : 'S'}:${id}`, label: partyLabel }
                : null,
            );
          }}
        />
        <SearchSelect
          aria-label={t('finance.bankStatements.bulk.account')}
          placeholder={t('finance.bankStatements.bulk.account')}
          className={cn(COMPACT_SELECT, 'w-56')}
          value={account}
          options={props.accountOptions}
          onChange={setAccount}
          onClear={() => setAccount('')}
        />
        <Input
          aria-label={t('finance.bankStatements.bulk.description')}
          placeholder={t('finance.bankStatements.bulk.description')}
          className={cn(COMPACT, 'w-56')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <NativeSelect
          aria-label={t('finance.bankStatements.bulk.action')}
          className={cn(COMPACT, 'w-32')}
          value={lineAction}
          onChange={(event) => setLineAction(event.target.value)}
        >
          <option value="">{t('finance.bankStatements.bulk.action')}</option>
          {BANK_LINE_ACTIONS.map((value) => (
            <option key={value} value={value}>
              {t(`finance.bankStatements.actions.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('finance.bankStatements.bulk.export')}
          className={cn(COMPACT, 'w-32')}
          value={exportType}
          onChange={(event) => setExportType(event.target.value)}
        >
          <option value="">{t('finance.bankStatements.bulk.export')}</option>
          {BANK_EXPORT_TYPES.map((value) => (
            <option key={value} value={value}>
              {t(`finance.bankStatements.exportTypes.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <Button
          size="sm"
          disabled={nothing}
          pending={mutations.bulk.isPending}
          onClick={() => void apply(false)}
        >
          {t('finance.bankStatements.bulk.apply')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          title={t('finance.bankStatements.bulk.fillHint')}
          pending={mutations.bulk.isPending}
          onClick={() => void apply(true)}
        >
          <Wand2 />
          {t('finance.bankStatements.bulk.fill')}
        </Button>
      </div>
      <ProblemAlert problem={action.problem} />
    </div>
  );
}

/** A number Bto does not know: the accountant names its bank account once. */
function LinkAccount(props: { id: number; number: string; disabled: boolean }) {
  const { t } = useTranslation();
  const money = useMoneyAccounts();
  const mutations = useBankMutations();
  const [chosen, setChosen] = useState('');
  const banks = (money.data ?? []).filter(
    (account) => account.kind === 'BANK' && account.status === 'ACTIVE',
  );
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertTitle>{t('finance.bankStatements.link.title')}</AlertTitle>
      <AlertDescription>
        <p>{t('finance.bankStatements.link.hint', { number: props.number })}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-foreground">
          <NativeSelect
            aria-label={t('finance.bankStatements.link.pick')}
            className={cn(COMPACT, 'w-72')}
            disabled={props.disabled}
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">{t('finance.bankStatements.link.pick')}</option>
            {banks.map((account) => (
              <option key={account.id} value={account.id}>
                {account.code} · {account.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            disabled={chosen === '' || props.disabled}
            pending={mutations.link.isPending}
            onClick={() =>
              mutations.link.mutate(
                { id: props.id, moneyAccountId: Number.parseInt(chosen, 10) },
                { onSuccess: () => toast.success(t('finance.bankStatements.link.linked')) },
              )
            }
          >
            {t('finance.bankStatements.link.action')}
          </Button>
        </div>
        <p className="mt-1 text-xs">{t('finance.bankStatements.link.settings')}</p>
        <ProblemAlert problem={problemFromError(mutations.link.error)} />
      </AlertDescription>
    </Alert>
  );
}
