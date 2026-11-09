import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
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
import { accountOption } from './account-option';
import { type GlAccount, useStockCountAccountMutation, useStockCountAccounts } from './api';

/** The accounts a product count may send its differences to (ADR-0176 #7). */
export function StockCountAccountsDialog({
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
  const rows = useStockCountAccounts(open);
  const mutation = useStockCountAccountMutation();
  const action = useAction();
  const [picked, setPicked] = useState('');
  const listed = new Set((rows.data ?? []).map((row) => row.accountId));
  const choices = accounts
    .filter((account) => account.status === 'ACTIVE' && !listed.has(account.id))
    .map(accountOption);
  const set = (accountId: number, on: boolean) =>
    void action.run(async () => {
      await mutation.mutateAsync({ accountId, listed: on });
      setPicked('');
      toast.success(t('finance.accounts.countAccounts.saved'));
    });
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('finance.accounts.countAccounts.title')}</DialogTitle>
          <DialogDescription>{t('finance.accounts.countAccounts.description')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem ?? problemFromError(rows.error)} />
        {canSet ? (
          <div className="flex items-center gap-2">
            <SearchSelect
              className="flex-1"
              aria-label={t('finance.accounts.countAccounts.pick')}
              placeholder={t('finance.accounts.countAccounts.pick')}
              value={picked}
              options={choices}
              onChange={setPicked}
            />
            <Button
              disabled={picked === '' || mutation.isPending}
              onClick={() => set(Number.parseInt(picked, 10), true)}
            >
              {t('finance.accounts.countAccounts.add')}
            </Button>
          </div>
        ) : null}
        {(rows.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {rows.isPending ? t('common.loading') : t('finance.accounts.countAccounts.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.accounts.issueAccounts.account')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows.data ?? []).map((row) => (
                <TableRow key={row.accountId}>
                  <TableCell>{`${row.code} · ${row.name}`}</TableCell>
                  <TableCell className="text-right">
                    {canSet ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={mutation.isPending}
                        onClick={() => set(row.accountId, false)}
                      >
                        {t('finance.accounts.countAccounts.remove')}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
