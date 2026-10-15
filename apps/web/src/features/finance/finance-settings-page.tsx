import {
  FINANCE_DOC_KINDS,
  type FinanceDocKind,
  financeNumberIssues,
  MONEY_ACCOUNT_KINDS,
  type MoneyAccountKind,
  renderFinanceNumber,
} from '@tugeel/shared/finance';
import { businessDate } from '@tugeel/shared/time';
import { Ellipsis, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DetailCard, FieldList } from '@/components/detail';
import { DialogFormFooter, FormField, FormFooter, FormRow, FormSection } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useBranches } from '@/features/identity/api';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type FinanceNumbering,
  type MoneyAccount,
  useFinanceMutations,
  useFinanceNumbering,
  useGlAccounts,
  useMoneyAccounts,
} from './api';

const CODE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$/;
const PATTERN_KEYS: Record<
  FinanceDocKind,
  'invoicePattern' | 'paymentPattern' | 'creditNotePattern' | 'journalPattern'
> = {
  INVOICE: 'invoicePattern',
  PAYMENT: 'paymentPattern',
  CREDIT_NOTE: 'creditNotePattern',
  JOURNAL: 'journalPattern',
};
const isMoneyKind = (value: string): value is MoneyAccountKind =>
  MONEY_ACCOUNT_KINDS.some((kind) => kind === value);

/** The finance settings (ADR-0060 #8, #5): the four number formats and the money accounts. */
export function FinanceSettingsPage() {
  const { t } = useTranslation();
  const numbering = useFinanceNumbering();
  const moneyAccounts = useMoneyAccounts();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MoneyAccount | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title={t('finance.settings.title')} />
      <ProblemAlert problem={problemFromError(numbering.error)} />
      {numbering.data ? (
        <DetailCard
          title={t('finance.settings.numbering')}
          canEdit
          view={<NumberingView numbering={numbering.data} />}
          edit={(close) => <NumberingForm numbering={numbering.data} onClose={close} />}
        />
      ) : null}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{t('finance.settings.moneyAccounts')}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('finance.settings.moneyAccountsDescription')}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t('finance.actions.newMoneyAccount')}
          </Button>
        </CardHeader>
        <CardContent>
          <ProblemAlert problem={problemFromError(moneyAccounts.error)} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.fields.code')}</TableHead>
                <TableHead>{t('finance.fields.name')}</TableHead>
                <TableHead>{t('finance.fields.kind')}</TableHead>
                <TableHead>{t('finance.fields.branch')}</TableHead>
                <TableHead>{t('finance.fields.account')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.balance')}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(moneyAccounts.data ?? []).map((account) => (
                <TableRow
                  key={account.id}
                  className={account.status === 'INACTIVE' ? 'text-muted-foreground' : undefined}
                >
                  <TableCell className="font-mono">{account.code}</TableCell>
                  <TableCell>
                    {account.name}
                    {account.bankAccountNo ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {account.bankAccountNo}
                      </span>
                    ) : null}
                    {account.status === 'INACTIVE' ? (
                      <Badge variant="secondary" className="ml-2">
                        {t('finance.accountStatuses.INACTIVE')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{t(`finance.moneyKinds.${account.kind}`)}</TableCell>
                  <TableCell>{account.branchName ?? ''}</TableCell>
                  <TableCell className="font-mono">{account.glAccountCode}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(account.balance)}
                  </TableCell>
                  <TableCell>
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
                        <DropdownMenuItem onSelect={() => setEditing(account)}>
                          {t('common.edit')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {creating ? (
        <MoneyAccountDialog open account={null} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <MoneyAccountDialog open account={editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function NumberingView({ numbering }: { numbering: FinanceNumbering }) {
  const { t } = useTranslation();
  const today = businessDate();
  return (
    <FieldList
      description={t('finance.settings.numberingDescription')}
      items={FINANCE_DOC_KINDS.map((kind) => ({
        label: t(`finance.settings.${PATTERN_KEYS[kind]}`),
        value: <span className="font-mono">{numbering[kind].pattern}</span>,
        hint: t('finance.settings.example', {
          example: renderFinanceNumber(numbering[kind].pattern, numbering[kind].digits, today, 1),
        }),
      }))}
    />
  );
}

function NumberingForm({
  numbering,
  onClose,
}: {
  numbering: FinanceNumbering;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [formats, setFormats] = useState(
    () =>
      Object.fromEntries(
        FINANCE_DOC_KINDS.map((kind) => [
          kind,
          { pattern: numbering[kind].pattern, digits: String(numbering[kind].digits) },
        ]),
      ) as Record<FinanceDocKind, { pattern: string; digits: string }>,
  );
  const [checked, setChecked] = useState(false);
  const issues = Object.fromEntries(
    FINANCE_DOC_KINDS.map((kind) => [
      kind,
      financeNumberIssues(
        formats[kind].pattern.trim(),
        Number.parseInt(formats[kind].digits, 10) || 0,
      ),
    ]),
  ) as Record<FinanceDocKind, ReturnType<typeof financeNumberIssues>>;
  const valid = FINANCE_DOC_KINDS.every((kind) => issues[kind].length === 0);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!valid) return;
    void action
      .run(async () => {
        const format = (kind: FinanceDocKind) => ({
          pattern: formats[kind].pattern.trim(),
          digits: Number.parseInt(formats[kind].digits, 10),
        });
        await mutations.setNumbering.mutateAsync({
          INVOICE: format('INVOICE'),
          PAYMENT: format('PAYMENT'),
          CREDIT_NOTE: format('CREDIT_NOTE'),
          JOURNAL: format('JOURNAL'),
        });
        toast.success(t('finance.settings.saved'));
      })
      .then((ok) => {
        if (ok) onClose();
      });
  };
  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <FormSection description={t('finance.settings.numberingDescription')}>
        {FINANCE_DOC_KINDS.map((kind) => (
          <FormRow
            key={kind}
            label={t(`finance.settings.${PATTERN_KEYS[kind]}`)}
            htmlFor={`pattern-${kind}`}
            error={
              checked && issues[kind].length
                ? t(`sales.numbering.issues.${issues[kind][0]?.code ?? 'ENDS_WITH_DIGIT'}`)
                : undefined
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id={`pattern-${kind}`}
                className="font-mono sm:w-64"
                value={formats[kind].pattern}
                maxLength={24}
                onChange={(event) =>
                  setFormats((previous) => ({
                    ...previous,
                    [kind]: { ...previous[kind], pattern: event.target.value },
                  }))
                }
              />
              <Input
                aria-label={`${t('finance.settings.digits')} ${t(`finance.settings.${PATTERN_KEYS[kind]}`)}`}
                type="number"
                min={1}
                max={8}
                className="w-20 font-mono"
                value={formats[kind].digits}
                onChange={(event) =>
                  setFormats((previous) => ({
                    ...previous,
                    [kind]: { ...previous[kind], digits: event.target.value },
                  }))
                }
              />
            </div>
          </FormRow>
        ))}
      </FormSection>
      <ProblemAlert problem={action.problem} />
      <FormFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={mutations.setNumbering.isPending}>
          {t('common.save')}
        </Button>
      </FormFooter>
    </form>
  );
}

function MoneyAccountDialog({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account: MoneyAccount | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const branches = useBranches();
  const glAccounts = useGlAccounts();
  const mutations = useFinanceMutations();
  const action = useAction();
  const [code, setCode] = useState(account?.code ?? '');
  const [name, setName] = useState(account?.name ?? '');
  const [kind, setKind] = useState<MoneyAccountKind>(account?.kind ?? 'CASH');
  const [branchId, setBranchId] = useState<number | null>(account?.branchId ?? null);
  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [bankAccountNo, setBankAccountNo] = useState(account?.bankAccountNo ?? '');
  const [glAccountId, setGlAccountId] = useState<number | null>(account?.glAccountId ?? null);
  const [status, setStatus] = useState<MoneyAccount['status']>(account?.status ?? 'ACTIVE');
  const [checked, setChecked] = useState(false);
  const assets = (glAccounts.data ?? []).filter(
    (entry) => entry.kind === 'ASSET' && entry.status === 'ACTIVE',
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!CODE.test(code.trim()) || !name.trim() || glAccountId === null) return;
    const body = {
      code: code.trim(),
      name: name.trim(),
      branchId,
      bankName: bankName.trim() || null,
      bankAccountNo: bankAccountNo.trim() || null,
      glAccountId,
    };
    void action
      .run(async () => {
        if (account) {
          await mutations.updateMoneyAccount.mutateAsync({
            id: account.id,
            body: { ...body, status },
          });
        } else {
          await mutations.createMoneyAccount.mutateAsync({ ...body, kind });
        }
        toast.success(t('finance.settings.moneyAccountDialog.saved'));
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
              ? t('finance.settings.moneyAccountDialog.editTitle')
              : t('finance.settings.moneyAccountDialog.createTitle')}
          </DialogTitle>
          <DialogDescription>{account ? account.code : ''}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('finance.settings.moneyAccountDialog.code')}
              htmlFor="money-code"
              error={checked && !CODE.test(code.trim()) ? t('validation.required') : undefined}
            >
              <Input
                id="money-code"
                className="font-mono"
                value={code}
                maxLength={16}
                onChange={(event) => setCode(event.target.value)}
              />
            </FormField>
            <FormField label={t('finance.settings.moneyAccountDialog.kind')} htmlFor="money-kind">
              <NativeSelect
                id="money-kind"
                value={kind}
                disabled={account !== null}
                onChange={(event) => {
                  if (isMoneyKind(event.target.value)) setKind(event.target.value);
                }}
              >
                {MONEY_ACCOUNT_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`finance.moneyKinds.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
          </div>
          <FormField
            label={t('finance.settings.moneyAccountDialog.name')}
            htmlFor="money-name"
            error={checked && !name.trim() ? t('validation.required') : undefined}
          >
            <Input
              id="money-name"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField label={t('finance.settings.moneyAccountDialog.branch')} htmlFor="money-branch">
            <NativeSelect
              id="money-branch"
              value={branchId ?? ''}
              onChange={(event) => setBranchId(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('finance.settings.moneyAccountDialog.noBranch')}</option>
              {(branches.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {kind === 'BANK' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label={t('finance.settings.moneyAccountDialog.bankName')}
                htmlFor="money-bank"
              >
                <Input
                  id="money-bank"
                  value={bankName}
                  maxLength={120}
                  onChange={(event) => setBankName(event.target.value)}
                />
              </FormField>
              <FormField
                label={t('finance.settings.moneyAccountDialog.bankAccountNo')}
                htmlFor="money-bank-no"
              >
                <Input
                  id="money-bank-no"
                  className="font-mono"
                  value={bankAccountNo}
                  maxLength={40}
                  onChange={(event) => setBankAccountNo(event.target.value)}
                />
              </FormField>
            </div>
          ) : null}
          <FormField
            label={t('finance.settings.moneyAccountDialog.glAccount')}
            htmlFor="money-gl"
            error={checked && glAccountId === null ? t('validation.required') : undefined}
          >
            <NativeSelect
              id="money-gl"
              value={glAccountId ?? ''}
              onChange={(event) => setGlAccountId(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('finance.journal.dialog.chooseAccount')}</option>
              {assets.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code} · {entry.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          {account ? (
            <FormField
              label={t('finance.settings.moneyAccountDialog.status')}
              htmlFor="money-status"
            >
              <NativeSelect
                id="money-status"
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
            pending={
              mutations.createMoneyAccount.isPending || mutations.updateMoneyAccount.isPending
            }
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
