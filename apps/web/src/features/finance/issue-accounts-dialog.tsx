import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type GlAccount,
  type IssueExpenseAccount,
  useIssueExpenseAccountMutation,
  useIssueExpenseAccounts,
} from './api';

/**
 * Which account each goods-issue expense type books to (ADR-0106 #3): a seeded type shows F4's
 * account (changed with its role), a type the admin added picks its own or stays on «Бусад».
 */
export function IssueAccountsDialog({
  open,
  accounts,
  onClose,
}: {
  open: boolean;
  accounts: readonly GlAccount[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const canSet = useHasPermission('finance.settings.manage');
  const rows = useIssueExpenseAccounts(open);
  const mutation = useIssueExpenseAccountMutation();
  const action = useAction();
  const active = accounts.filter((account) => account.status === 'ACTIVE');
  const other = rows.data?.find((row) => row.seeded === false && row.own === false);
  const otherLabel = other?.accountCode
    ? t('finance.accounts.issueAccounts.other', { account: other.accountCode })
    : t('finance.roles.ISSUE_OTHER');
  const choose = (row: IssueExpenseAccount, value: string) =>
    void action.run(async () => {
      await mutation.mutateAsync({
        typeId: row.typeId,
        accountId: value === '' ? null : Number.parseInt(value, 10),
      });
      toast.success(t('finance.accounts.issueAccounts.saved'));
    });
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.accounts.issueAccounts.title')}</DialogTitle>
          <DialogDescription>{t('finance.accounts.issueAccounts.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(rows.error)} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.accounts.issueAccounts.type')}</TableHead>
              <TableHead>{t('finance.accounts.issueAccounts.account')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rows.data ?? []).map((row) => (
              <TableRow key={row.typeId}>
                <TableCell>
                  {row.name}
                  {row.active ? null : (
                    <Badge variant="secondary" className="ml-2">
                      {t('finance.accounts.issueAccounts.inactive')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {row.seeded || !canSet ? (
                    <span className="text-[0.8125rem]">
                      {row.accountCode ? `${row.accountCode} · ${row.accountName ?? ''}` : ''}
                      {row.seeded ? (
                        <Badge variant="outline" className="ml-2">
                          {t('finance.accounts.issueAccounts.seeded')}
                        </Badge>
                      ) : null}
                    </span>
                  ) : (
                    <NativeSelect
                      aria-label={`${row.name} — ${t('finance.accounts.issueAccounts.account')}`}
                      value={row.own && row.accountId !== null ? String(row.accountId) : ''}
                      disabled={mutation.isPending}
                      onChange={(event) => choose(row, event.target.value)}
                    >
                      <option value="">{otherLabel}</option>
                      {active.map((account) => (
                        <option key={account.id} value={String(account.id)}>
                          {`${account.code} · ${account.name}`}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
