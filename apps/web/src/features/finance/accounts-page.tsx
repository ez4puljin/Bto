import { GL_ACCOUNT_KINDS, GL_ROLES, type GlAccountKind } from '@tugeel/shared/finance';
import { Ellipsis, ListTree, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  ListTable,
  LoadMore,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
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
  useGlAccounts,
} from './api';
import { SourceBadge } from './badges';
import { IssueAccountsDialog } from './issue-accounts-dialog';

const CODE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$/;
const isKind = (value: string): value is GlAccountKind =>
  GL_ACCOUNT_KINDS.some((kind) => kind === value);
const isRole = (value: string): value is GlRole => GL_ROLES.some((role) => role === value);

/** The chart's columns (ADR-0119): the code, the name, the kind and role, three amounts, the menu. */
const ACCOUNT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 14 },
  { key: 'kind', kind: 'text', weight: 1 },
  { key: 'role', kind: 'text', weight: 2 },
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
  const accounts = useGlAccounts();
  const rows = accounts.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('finance.accounts.title')}
        actions={
          <>
            <Button variant="outline" onClick={() => setIssueAccounts(true)}>
              {t('finance.accounts.issueAccounts.open')}
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
      <ProblemAlert problem={problemFromError(accounts.error)} onRetry={accounts.refetch} />
      <ListCard scroll>
        <ListTable columns={ACCOUNT_COLUMNS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.code')}</TableHead>
              <TableHead>{t('finance.fields.name')}</TableHead>
              <TableHead>{t('finance.fields.kind')}</TableHead>
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
            {accounts.isPending ? <SkeletonRows columns={9} /> : null}
            {rows.map((account) => (
              // A row opens the account's ledger; its code stays the keyboard's link.
              <LinkRow
                key={account.id}
                to={`/finance/accounts/${account.id}`}
                className={account.status === 'INACTIVE' ? 'text-muted-foreground' : undefined}
              >
                <TableCell className="font-mono">
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
                <TableCell>{t(`finance.accountKinds.${account.kind}`)}</TableCell>
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
                          <DropdownMenuItem onSelect={() => setEditing(account)}>
                            {t('common.edit')}
                          </DropdownMenuItem>
                        ) : null}
                        {canRole ? (
                          <DropdownMenuItem onSelect={() => setRoling(account)}>
                            {t('finance.actions.setRole')}
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem asChild>
                          <Link to={`/finance/accounts/${account.id}`}>
                            {t('finance.actions.ledger')}
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </TableCell>
              </LinkRow>
            ))}
          </TableBody>
        </ListTable>
        {!accounts.isPending && rows.length === 0 ? (
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
  const [kind, setKind] = useState<GlAccountKind>(account?.kind ?? 'ASSET');
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
            body: { code: code.trim(), name: name.trim(), kind, status },
          });
        } else {
          await mutations.createAccount.mutateAsync({ code: code.trim(), name: name.trim(), kind });
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
          <FormField label={t('finance.accounts.dialog.kind')} htmlFor="account-kind">
            <NativeSelect
              id="account-kind"
              value={kind}
              onChange={(event) => {
                if (isKind(event.target.value)) setKind(event.target.value);
              }}
            >
              {GL_ACCOUNT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {t(`finance.accountKinds.${value}`)}
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
        <NativeSelect
          variant="filter"
          aria-label={t('finance.accounts.partyFilter')}
          value={partyId ?? ''}
          onChange={(event) => setParam('partyId', event.target.value)}
        >
          <option value="">{t('finance.accounts.allParties')}</option>
          {(parties.data ?? []).map((party) => (
            <option key={party.partyId} value={party.partyId}>
              {party.name}
            </option>
          ))}
        </NativeSelect>
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
