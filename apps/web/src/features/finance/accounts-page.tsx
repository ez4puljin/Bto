import { GL_ACCOUNT_KINDS, GL_ROLES, type GlAccountKind } from '@tugeel/shared/finance';
import { Ellipsis, ListTree, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  LoadMore,
  SkeletonRows,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import {
  type GlAccount,
  type GlRole,
  useAccountLedger,
  useFinanceMutations,
  useGlAccounts,
} from './api';
import { SourceBadge } from './badges';

const CODE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$/;
const isKind = (value: string): value is GlAccountKind =>
  GL_ACCOUNT_KINDS.some((kind) => kind === value);
const isRole = (value: string): value is GlRole => GL_ROLES.some((role) => role === value);

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
  const accounts = useGlAccounts();
  const rows = accounts.data ?? [];

  return (
    <div>
      <PageHeader
        title={t('finance.accounts.title')}
        actions={
          canEdit ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('finance.actions.newAccount')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(accounts.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.code')}</TableHead>
              <TableHead>{t('finance.fields.name')}</TableHead>
              <TableHead>{t('finance.fields.kind')}</TableHead>
              <TableHead>{t('finance.fields.role')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.balance')}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.isPending ? <SkeletonRows columns={8} /> : null}
            {rows.map((account) => (
              <TableRow
                key={account.id}
                className={account.status === 'INACTIVE' ? 'text-muted-foreground' : undefined}
              >
                <TableCell className="font-mono">
                  <Link
                    className="text-link underline-offset-2 hover:underline"
                    to={`/finance/accounts/${account.id}`}
                  >
                    {account.code}
                  </Link>
                </TableCell>
                <TableCell>
                  {account.name}
                  {account.status === 'INACTIVE' ? (
                    <Badge variant="secondary" className="ml-2">
                      {t('finance.accountStatuses.INACTIVE')}
                    </Badge>
                  ) : null}
                </TableCell>
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
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
            error={checked && !codeOk ? t('validation.required') : undefined}
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
            error={checked && !name.trim() ? t('validation.required') : undefined}
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
            <FormField label={t('finance.accounts.dialog.status')} htmlFor="account-status">
              <NativeSelect
                id="account-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')
                }
              >
                <option value="ACTIVE">{t('finance.accountStatuses.ACTIVE')}</option>
                <option value="INACTIVE">{t('finance.accountStatuses.INACTIVE')}</option>
              </NativeSelect>
            </FormField>
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
  const [params, setParams] = useSearchParams();
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const accounts = useGlAccounts();
  const account = accounts.data?.find((entry) => entry.id === accountId);
  const ledger = useAccountLedger(accountId > 0 ? accountId : null, { from, to });
  const rows = ledger.data?.pages.flatMap((page) => page.data) ?? [];

  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

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
        <DateFilter
          label={t('finance.fields.from')}
          value={from}
          onChange={(value) => setParam('from', value)}
        />
        <DateFilter
          label={t('finance.fields.to')}
          value={to}
          onChange={(value) => setParam('to', value)}
        />
        {ledger.data?.pages[0] && from ? (
          <span className="text-sm text-muted-foreground">
            {t('finance.fields.opening')}:{' '}
            <span className="font-mono">{formatMnt(ledger.data.pages[0].opening)}</span>
          </span>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={problemFromError(ledger.error ?? accounts.error)} />
      <ListCard>
        <Table>
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
                <TableCell>
                  {[line.entryDescription, line.customerName, line.description]
                    .filter(Boolean)
                    .join(' · ')}
                </TableCell>
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
        </Table>
        {!ledger.isPending && rows.length === 0 ? (
          <EmptyState title={t('finance.accounts.ledgerEmpty')} />
        ) : null}
        <LoadMore query={ledger} />
      </ListCard>
    </div>
  );
}
