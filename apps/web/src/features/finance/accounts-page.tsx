import type { components } from '@tugeel/api-client';
import {
  ACCOUNT_CURRENCIES,
  ACCOUNT_JOURNALS,
  type AccountCurrency,
  type AccountJournal,
  GL_ROLES,
} from '@tugeel/shared/finance';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Ellipsis, ListTree, Plus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  FilterToggle,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { Combobox } from '@/components/combobox';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { DateRangeFilter } from './date-range-filter';
import {
  type GlAccount,
  type GlRole,
  useAccountLedger,
  useAccountParties,
  useFinanceMutations,
  useGlAccountGroups,
  useGlAccounts,
} from './api';
import { SourceBadge } from './badges';
import { IssueAccountsDialog } from './issue-accounts-dialog';
import { StockCountAccountsDialog } from './stock-count-accounts-dialog';

const CODE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$/;
const isRole = (value: string): value is GlRole => GL_ROLES.some((role) => role === value);

/** The chart's columns (ADR-0119): the code, the name, the kind and role, three amounts, the menu. */
const ACCOUNT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code', width: 11 },
  { key: 'name', kind: 'text', weight: 4, min: 18 },
  { key: 'journal', kind: 'text', weight: 2, min: 13 },
  { key: 'currency', kind: 'code', width: 4.5 },
  { key: 'role', kind: 'text', weight: 1, min: 6 },
  { key: 'debit', kind: 'money' },
  { key: 'credit', kind: 'money' },
  { key: 'balance', kind: 'money', width: 10 },
  { key: 'actions', kind: 'actions', actions: 1 },
  { key: 'chevron', kind: 'chevron' },
];

/** The account ledger's columns: date, entry number, description, source, two sides, balance. */
const LEDGER_COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'date' },
  { key: 'number', kind: 'number' },
  { key: 'description', kind: 'text', weight: 3, min: 14 },
  { key: 'source', kind: 'status' },
  { key: 'debit', kind: 'money' },
  { key: 'credit', kind: 'money' },
  { key: 'balanceAfter', kind: 'money', width: 10 },
];

type GroupRow = components['schemas']['GlAccountGroup'];
type ChartLine =
  | { group: GroupRow; account?: undefined; depth: number }
  | { group?: undefined; account: GlAccount; depth: number };

/**
 * The chart as Erkhet shows it (ADR-0148): the group tree in its order with each group's accounts
 * under it, ungrouped accounts last. `keepEmpty` shows the groups without accounts too; a search
 * or the inactive view shows only the groups that hold a row.
 */
function chartLines(
  groups: readonly GroupRow[],
  accounts: readonly GlAccount[],
  keepEmpty: boolean,
): ChartLine[] {
  const children = new Map<number | null, GroupRow[]>();
  for (const group of groups) {
    children.set(group.parentId, [...(children.get(group.parentId) ?? []), group]);
  }
  const held = new Map<number | null, GlAccount[]>();
  for (const account of accounts) {
    held.set(account.groupId, [...(held.get(account.groupId) ?? []), account]);
  }
  const walk = (parent: number | null, depth: number): ChartLine[] =>
    [...(children.get(parent) ?? [])]
      .sort((a, b) => a.sort - b.sort)
      .flatMap((group) => {
        const own = [...(held.get(group.id) ?? [])].sort((a, b) => a.code.localeCompare(b.code));
        const below = walk(group.id, depth + 1);
        if (!keepEmpty && own.length === 0 && below.length === 0) return [];
        return [
          { group, depth },
          ...own.map((account) => ({ account, depth: depth + 1 })),
          ...below,
        ];
      });
  const loose = [...(held.get(null) ?? [])]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((account) => ({ account, depth: 0 }));
  return [...walk(null, 0), ...loose];
}

/** One account's row: it opens the ledger, its code stays the keyboard's link. */
function AccountRow(props: {
  account: GlAccount;
  depth: number;
  canEdit: boolean;
  canRole: boolean;
  onEdit: (account: GlAccount) => void;
  onRole: (account: GlAccount) => void;
}) {
  const { t } = useTranslation();
  const { account, canEdit, canRole } = props;
  return (
    <LinkRow
      to={`/finance/accounts/${account.id}`}
      className={account.status === 'INACTIVE' ? 'text-muted-foreground' : undefined}
    >
      <TableCell className="font-mono" style={{ paddingLeft: `${0.75 + props.depth * 0.875}rem` }}>
        <Link
          className="font-medium underline-offset-4 hover:underline"
          to={`/finance/accounts/${account.id}`}
        >
          {account.code}
        </Link>
      </TableCell>
      <TruncateCell text={account.name}>
        {account.name}
        {account.status === 'INACTIVE' ? (
          <Badge variant="secondary" className="ml-2">
            {t('finance.accountStatuses.INACTIVE')}
          </Badge>
        ) : null}
      </TruncateCell>
      <TableCell className="truncate">{t(`finance.accountJournals.${account.journal}`)}</TableCell>
      <TableCell className="font-mono">{account.currency}</TableCell>
      <TableCell>{account.role ? t(`finance.roles.${account.role}`) : ''}</TableCell>
      <TableCell className="text-right font-mono">{formatMnt(account.debit)}</TableCell>
      <TableCell className="text-right font-mono">{formatMnt(account.credit)}</TableCell>
      <TableCell className="text-right font-mono">{formatMnt(account.balance)}</TableCell>
      <TableCell>
        {canEdit || canRole ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${account.code}: ${t('common.actions')}`}
              >
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit ? (
                <DropdownMenuItem onSelect={() => props.onEdit(account)}>
                  {t('common.edit')}
                </DropdownMenuItem>
              ) : null}
              {canRole ? (
                <DropdownMenuItem onSelect={() => props.onRole(account)}>
                  {t('finance.actions.setRole')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem asChild>
                <Link to={`/finance/accounts/${account.id}`}>{t('finance.actions.ledger')}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </LinkRow>
  );
}

/**
 * The chart of accounts (ADR-0060 #7) with each account's turnover and balance; the accountant
 * adds and edits accounts, an admin moves the roles the automatic entries post to.
 */
export function AccountsPage() {
  const { t } = useTranslation();
  const canEdit = useHasPermission('finance.journal.manage');
  const canRole = useHasPermission('finance.settings.manage');
  const [creating, setCreating] = useCreateParam();
  const [editing, setEditing] = useState<GlAccount | null>(null);
  const [roling, setRoling] = useState<GlAccount | null>(null);
  const [issueAccounts, setIssueAccounts] = useState(false);
  const [countAccounts, setCountAccounts] = useState(false);
  const accounts = useGlAccounts();
  const groups = useGlAccountGroups();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const rows = useMemo(() => accounts.data ?? [], [accounts.data]);
  const lines = useMemo(() => {
    const terms = queryTerms(search);
    return chartLines(
      groups.data ?? [],
      rows.filter(
        (account) =>
          (showInactive || account.status === 'ACTIVE') &&
          (terms.length === 0 || matchesQuery(searchKeys(account.name, [account.code]), terms)),
      ),
      terms.length === 0 && !showInactive,
    );
  }, [groups.data, rows, search, showInactive]);

  return (
    <div>
      <PageHeader
        title={t('finance.accounts.title')}
        actions={
          <>
            <Button variant="outline" onClick={() => setIssueAccounts(true)}>
              {t('finance.accounts.issueAccounts.open')}
            </Button>
            <Button variant="outline" onClick={() => setCountAccounts(true)}>
              {t('finance.accounts.countAccounts.open')}
            </Button>
            {canEdit ? (
              <Button onClick={() => setCreating(true)}>
                <Plus />
                {t('finance.actions.newAccount')}
              </Button>
            ) : null}
          </>
        }
      />
      <IssueAccountsDialog
        open={issueAccounts}
        accounts={rows}
        onClose={() => setIssueAccounts(false)}
      />
      <StockCountAccountsDialog
        open={countAccounts}
        accounts={rows}
        onClose={() => setCountAccounts(false)}
      />
      <FilterBar>
        <SearchField
          aria-label={t('finance.accounts.search')}
          placeholder={t('finance.accounts.search')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <FilterToggle
          label={t('finance.accounts.showInactive')}
          checked={showInactive}
          onCheckedChange={setShowInactive}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(accounts.error)} onRetry={accounts.refetch} />
      <ListCard scroll>
        <ListTable columns={ACCOUNT_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.code')}</TableHead>
              <TableHead>{t('finance.fields.name')}</TableHead>
              <TableHead>{t('finance.fields.kind')}</TableHead>
              <TableHead>{t('finance.accounts.currency')}</TableHead>
              <TableHead>{t('finance.fields.role')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.balance')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.isPending ? <SkeletonRows columns={10} /> : null}
            {lines.map((line) =>
              line.group ? (
                <TableRow key={`g${line.group.id}`} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell
                    colSpan={10}
                    className="py-1.5 font-semibold"
                    style={{ paddingLeft: `${0.75 + line.depth * 0.875}rem` }}
                  >
                    <span className="mr-2 font-mono text-muted-foreground">{line.group.code}</span>
                    {line.group.name}
                  </TableCell>
                </TableRow>
              ) : (
                // A row opens the account's ledger; its code stays the keyboard's link.
                <AccountRow
                  key={line.account.id}
                  account={line.account}
                  depth={line.depth}
                  canEdit={canEdit}
                  canRole={canRole}
                  onEdit={setEditing}
                  onRole={setRoling}
                />
              ),
            )}
          </TableBody>
        </ListTable>
        {!accounts.isPending && lines.length === 0 ? (
          <EmptyState icon={ListTree} title={t('finance.accounts.empty')} />
        ) : null}
      </ListCard>
      {creating ? <AccountDialog open account={null} onClose={() => setCreating(false)} /> : null}
      {editing ? <AccountDialog open account={editing} onClose={() => setEditing(null)} /> : null}
      {roling ? <RoleDialog open account={roling} onClose={() => setRoling(null)} /> : null}
    </div>
  );
}

function AccountDialog({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account: GlAccount | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [journal, setJournal] = useState<AccountJournal>(account?.journal ?? 'GENERAL');
  const [currency, setCurrency] = useState<AccountCurrency>(
    ACCOUNT_CURRENCIES.find((value) => value === account?.currency) ?? 'MNT',
  );
  const [status, setStatus] = useState<GlAccount['status']>(account?.status ?? 'ACTIVE');
  const [checked, setChecked] = useState(false);
  const codeOk = CODE.test(code.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!codeOk || !name.trim()) return;
    void action
      .run(async () => {
        if (account) {
          await mutations.updateAccount.mutateAsync({
            id: account.id,
            body: { code: code.trim(), name: name.trim(), journal, currency, status },
          });
        } else {
          await mutations.createAccount.mutateAsync({
            code: code.trim(),
            name: name.trim(),
            journal,
            currency,
          });
        }
        toast.success(t('finance.accounts.dialog.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {account
              ? t('finance.accounts.dialog.editTitle')
              : t('finance.accounts.dialog.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {account ? `${account.code} · ${account.name}` : ''}
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField
            label={t('finance.accounts.dialog.code')}
            htmlFor="account-code"
            error={checked && !codeOk ? 'validation.required' : undefined}
          >
            <Input
              id="account-code"
              className="font-mono sm:w-44"
              value={code}
              maxLength={16}
              onChange={(event) => setCode(event.target.value)}
            />
          </FormField>
          <FormField
            label={t('finance.accounts.dialog.name')}
            htmlFor="account-name"
            error={checked && !name.trim() ? 'validation.required' : undefined}
          >
            <Input
              id="account-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField label={t('finance.fields.kind')} htmlFor="account-journal">
            <NativeSelect
              id="account-journal"
              value={journal}
              onChange={(event) => setJournal(event.target.value as AccountJournal)}
            >
              {ACCOUNT_JOURNALS.map((value) => (
                <option key={value} value={value}>
                  {t(`finance.accountJournals.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label={t('finance.accounts.currency')} htmlFor="account-currency">
            <NativeSelect
              id="account-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value as AccountCurrency)}
            >
              {ACCOUNT_CURRENCIES.map((value) => (
                <option key={value} value={value}>
                  {value} · {t(`finance.currencies.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {account ? (
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="account-active">{t('finance.accountStatuses.ACTIVE')}</Label>
              <Switch
                id="account-active"
                checked={status === 'ACTIVE'}
                onCheckedChange={(on) => setStatus(on ? 'ACTIVE' : 'INACTIVE')}
              />
            </div>
          ) : null}
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter
            pending={mutations.createAccount.isPending || mutations.updateAccount.isPending}
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account: GlAccount;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [role, setRole] = useState<GlRole | null>(account.role ?? null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        await mutations.setRole.mutateAsync({ id: account.id, role });
        toast.success(t('finance.accounts.roleDialog.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.accounts.roleDialog.title')}</DialogTitle>
          <DialogDescription>{t('finance.accounts.roleDialog.description')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <FormField label={`${account.code} · ${account.name}`} htmlFor="account-role">
            <NativeSelect
              id="account-role"
              value={role ?? ''}
              onChange={(event) => setRole(isRole(event.target.value) ? event.target.value : null)}
            >
              <option value="">{t('finance.roles.none')}</option>
              {GL_ROLES.map((value) => (
                <option key={value} value={value}>
                  {t(`finance.roles.${value}`)}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter pending={mutations.setRole.isPending} onCancel={onClose} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One account's lines newest first with the balance after each (`/finance/accounts/:id`). */
export function AccountLedgerPage() {
  const { t } = useTranslation();
  const accountId = Number.parseInt(useParams().id ?? '', 10);
  const [params] = useSearchParams();
  const setParam = useSetParam();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const partyId = params.get('partyId') ?? undefined;
  const accounts = useGlAccounts();
  const account = accounts.data?.find((entry) => entry.id === accountId);
  // The account report by account and party (ADR-0117 #2).
  const parties = useAccountParties(accountId > 0 ? accountId : null);
  const ledger = useAccountLedger(accountId > 0 ? accountId : null, { from, to, partyId });
  const rows = ledger.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader
        title={account ? `${account.code} · ${account.name}` : t('finance.accounts.ledgerTitle')}
        crumbs={[{ label: t('finance.accounts.title'), to: '/finance/accounts' }]}
        meta={
          account ? (
            <>
              <Badge variant="outline">{t(`finance.accountKinds.${account.kind}`)}</Badge>
              <span className="font-mono">
                {t('finance.fields.balance')}: {formatMnt(account.balance)}
              </span>
            </>
          ) : undefined
        }
      />
      <FilterBar>
        <DateRangeFilter
          label={t('finance.fields.date')}
          fromLabel={t('finance.fields.from')}
          toLabel={t('finance.fields.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
        <Combobox
          aria-label={t('finance.accounts.partyFilter')}
          value={partyId ?? ''}
          options={(parties.data ?? []).map((party) => ({
            value: String(party.partyId),
            label: party.name,
          }))}
          emptyLabel={t('finance.accounts.allParties')}
          onChange={(value) => setParam('partyId', value)}
        />
        {ledger.data?.pages[0] && from ? (
          <span className="text-sm text-muted-foreground">
            {t('finance.fields.opening')}:{' '}
            <span className="font-mono">{formatMnt(ledger.data.pages[0].opening)}</span>
          </span>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={problemFromError(ledger.error ?? accounts.error)} />
      <ListCard scroll>
        <ListTable columns={LEDGER_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.date')}</TableHead>
              <TableHead>{t('finance.fields.number')}</TableHead>
              <TableHead>{t('finance.fields.description')}</TableHead>
              <TableHead>{t('finance.fields.source')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.balanceAfter')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-mono">{line.entryDate}</TableCell>
                <TableCell className="font-mono">
                  <Link
                    className="text-link underline-offset-2 hover:underline"
                    to={`/finance/journal?entry=${line.entryId}`}
                  >
                    {line.entryNumber}
                  </Link>
                </TableCell>
                <TruncateCell
                  text={[
                    line.entryDescription,
                    line.partyName ?? line.customerName,
                    line.description,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
                <TableCell>
                  <SourceBadge source={line.source} />
                </TableCell>
                <TableCell className="text-right font-mono">
                  {line.debit === '0.00' ? '' : formatMnt(line.debit)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {line.credit === '0.00' ? '' : formatMnt(line.credit)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatMnt(line.balanceAfter)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </ListTable>
        {!ledger.isPending && rows.length === 0 ? (
          <EmptyState title={t('finance.accounts.ledgerEmpty')} />
        ) : null}
        <LoadMore query={ledger} />
      </ListCard>
    </div>
  );
}
