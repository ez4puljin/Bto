import { PAYROLL_AMOUNT_PATTERN, PAYROLL_LIMITS } from '@tugeel/shared/payroll';
import { businessDate } from '@tugeel/shared/time';
import { HandCoins, Plus, Ban } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput, MonthInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { cn } from '@/lib/utils';
import { type PayrollAdvance, useAdvances, useAllTerms, usePayrollMutations } from './payroll-api';
import { money } from './payroll-helpers';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 13 },
  { key: 'month', kind: 'code', width: 6 },
  { key: 'amount', kind: 'money', width: 9.5 },
  { key: 'paidOn', kind: 'date' },
  { key: 'note', kind: 'text', weight: 3, min: 10, drop: 1 },
  { key: 'status', kind: 'text', weight: 2, min: 9 },
  { key: 'actions', kind: 'actions', actions: 1 },
];

function AdvanceDialog(props: { month: string; onClose: () => void }) {
  const { t } = useTranslation();
  const terms = useAllTerms();
  const mutations = usePayrollMutations();
  const action = useAction();
  const key = useRef(randomUuid());
  const [userId, setUserId] = useState('');
  const [month, setMonth] = useState(props.month);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(businessDate());
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const people = (terms.data ?? [])
    .filter((row) => !row.left && row.hasTerms && row.active)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (userId === '') next.userId = 'validation.required';
    if (month === '') next.month = 'validation.required';
    if (!PAYROLL_AMOUNT_PATTERN.test(amount) || Number(amount) <= 0)
      next.amount = 'validation.money';
    if (paidOn === '') next.paidOn = 'validation.date';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const ok = await action.run(() =>
      mutations.createAdvance.mutateAsync({
        key: key.current,
        userId: Number(userId),
        month,
        amount,
        paidOn,
        note: note.trim() === '' ? null : note.trim(),
      }),
    );
    if (ok) {
      toast.success(t('payroll.web.advances.created'));
      props.onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>{t('payroll.web.advances.create')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem ?? problemFromError(terms.error)} />
          <FormField
            label={t('payroll.web.advances.employee')}
            htmlFor="advance-user"
            error={errors.userId}
          >
            <NativeSelect
              id="advance-user"
              autoFocus
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">{t('payroll.web.advances.chooseEmployee')}</option>
              {people.map((row) => (
                <option key={row.userId} value={row.userId}>
                  {row.fullName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <div className="@container">
            <div className="grid gap-4 @md:grid-cols-3">
              <FormField
                label={t('payroll.web.advances.month')}
                htmlFor="advance-month"
                error={errors.month}
              >
                <MonthInput id="advance-month" required value={month} onChange={setMonth} />
              </FormField>
              <FormField
                label={t('payroll.web.advances.amount')}
                htmlFor="advance-amount"
                error={errors.amount}
              >
                <MoneyInput
                  id="advance-amount"
                  suffix="₮"
                  value={amount}
                  onValueChange={setAmount}
                />
              </FormField>
              <FormField
                label={t('payroll.web.advances.paidOn')}
                htmlFor="advance-paid"
                error={errors.paidOn}
              >
                <DateInput id="advance-paid" required value={paidOn} onChange={setPaidOn} />
              </FormField>
            </div>
          </div>
          <FormField label={t('payroll.web.advances.note')} htmlFor="advance-note">
            <Input
              id="advance-note"
              maxLength={PAYROLL_LIMITS.maxNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.createAdvance.isPending}
            onCancel={props.onClose}
            submitLabel={t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Урьдчилгаа» (ADR-0235, hr.payroll.view): the advances paid in a month, taken off that month's
 * pay. An advance is never edited: a wrong one is voided with a reason and entered again. Changes
 * need hr.payroll.manage, and a month whose run is approved takes none.
 */
export function PayrollAdvancesPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const canManage = useHasPermission('hr.payroll.manage');
  const month = search.get('month') ?? businessDate().slice(0, 7);
  const includeVoided = search.get('voided') === '1';
  const advances = useAdvances({ month, includeVoided });
  const mutations = usePayrollMutations();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const [voiding, setVoiding] = useState<PayrollAdvance | null>(null);
  const [reason, setReason] = useState('');
  const action = useAction();
  const rows = advances.data ?? [];

  const closeVoid = () => {
    action.clear();
    setVoiding(null);
    setReason('');
  };
  const voidIt = async () => {
    if (!voiding) return;
    const ok = await action.run(() =>
      mutations.voidAdvance.mutateAsync({ id: voiding.id, reason: reason.trim() }),
    );
    if (ok) {
      toast.success(t('payroll.web.advances.voided'));
      closeVoid();
    }
  };

  return (
    <div>
      <PageHeader
        title={t('payroll.web.advances.title')}
        description={t('payroll.web.advances.description')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreatingOpen(true)}>
              <Plus />
              {t('payroll.web.advances.create')}
            </Button>
          ) : null
        }
      />
      <FilterBar
        end={
          advances.data ? (
            <span className="text-[0.8125rem] text-muted-foreground">
              {t('payroll.web.advances.count', { count: rows.length })}
            </span>
          ) : null
        }
      >
        <MonthInput
          variant="filter"
          required
          label={t('payroll.web.advances.month')}
          value={month}
          onChange={(value) => {
            if (value) setParam('month', value);
          }}
        />
        <FilterToggle
          label={t('payroll.web.advances.showVoided')}
          checked={includeVoided}
          onCheckedChange={(checked) => setParam('voided', checked ? '1' : null)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(advances.error)} onRetry={advances.refetch} />
      <ListCard scroll>
        {advances.data && rows.length === 0 ? (
          <EmptyState title={t('payroll.web.advances.empty')} icon={HandCoins} />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.web.advances.employee')}</TableHead>
                <TableHead>{t('payroll.web.advances.month')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.advances.amount')}</TableHead>
                <TableHead>{t('payroll.web.advances.paidOn')}</TableHead>
                <TableHead>{t('payroll.web.advances.note')}</TableHead>
                <TableHead>{t('payroll.web.advances.status')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {advances.isPending ? <SkeletonRows columns={7} /> : null}
              {rows.map((row) => {
                const voided = row.voidedAt !== null;
                return (
                  <TableRow key={row.id} className={cn(voided && 'text-muted-foreground')}>
                    <TableCell className="truncate font-medium">{row.fullName}</TableCell>
                    <TableCell className="font-mono">{row.month}</TableCell>
                    <TableCell className={cn('text-right font-mono', voided && 'line-through')}>
                      {money(row.amount)}
                    </TableCell>
                    <TableCell className="font-mono">{row.paidOn}</TableCell>
                    <TableCell className="truncate">{row.note ?? t('common.none')}</TableCell>
                    <TableCell className="truncate">
                      {voided ? (
                        <span title={row.voidReason ?? undefined}>
                          <Badge variant="outline" className="mr-1.5">
                            {t('payroll.web.advances.statusVoided')}
                          </Badge>
                          {row.voidReason}
                        </span>
                      ) : (
                        <Badge variant="success">{t('payroll.web.advances.statusValid')}</Badge>
                      )}
                    </TableCell>
                    {canManage && !voided ? (
                      <RowActions>
                        <RowAction
                          label={t('payroll.web.advances.voidFor', { name: row.fullName })}
                          icon={Ban}
                          destructive
                          onClick={() => setVoiding(row)}
                        />
                      </RowActions>
                    ) : (
                      <TableCell />
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {creatingOpen && canManage ? (
        <AdvanceDialog month={month} onClose={() => setCreatingOpen(false)} />
      ) : null}
      <ConfirmDialog
        open={voiding !== null}
        title={t('payroll.web.advances.voidTitle')}
        description={
          voiding
            ? t('payroll.web.advances.voidDescription', {
                name: voiding.fullName,
                amount: money(voiding.amount),
              })
            : undefined
        }
        confirmLabel={t('payroll.web.advances.void')}
        initialFocus="first"
        disabled={reason.trim() === ''}
        pending={mutations.voidAdvance.isPending}
        problem={action.problem}
        onConfirm={() => void voidIt()}
        onClose={closeVoid}
      >
        <FormField label={t('payroll.web.reason')} htmlFor="advance-void-reason">
          <Input
            id="advance-void-reason"
            maxLength={PAYROLL_LIMITS.maxNote}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
