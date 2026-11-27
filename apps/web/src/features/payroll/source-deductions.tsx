import { businessDate } from '@tugeel/shared/time';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { MonthInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { PanelSection } from '@/components/record-sheet';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type PayrollSourceDeduction,
  useAllTerms,
  useAssignSourceMonth,
  useSourceDeductions,
} from './payroll-api';
import { money } from './payroll-helpers';

export function SourceReference({ value }: { value: string }) {
  const { t } = useTranslation();
  const match = /^expiry:(\d+)\/markdown:(\d+)$/.exec(value);
  return match ? (
    <Link className="text-link hover:underline" to={`/inventory/expiry?item=${match[1]}`}>
      {t('payroll.web.sourceDeductions.sourceLabel', { item: match[1], markdown: match[2] })}
    </Link>
  ) : (
    <span>{value}</span>
  );
}

export function PayrollSourceDeductions(props: { sourceReference?: string }) {
  const { t } = useTranslation();
  const canView = useHasPermission('hr.payroll.view');
  const canManage = useHasPermission('hr.payroll.manage');
  const [pendingOnly, setPendingOnly] = useState(true);
  const deductions = useSourceDeductions(
    { ...(props.sourceReference ? { sourceReference: props.sourceReference } : {}), pendingOnly },
    canView,
  );
  const people = useAllTerms(canView);
  const [assigning, setAssigning] = useState<PayrollSourceDeduction | null>(null);
  if (!canView) return null;
  return (
    <PanelSection title={t('payroll.web.sourceDeductions.title')}>
      <p className="text-sm text-muted-foreground">
        {t('payroll.web.sourceDeductions.description')}
      </p>
      <Label className="my-3 flex items-center gap-2">
        <Switch checked={pendingOnly} onCheckedChange={setPendingOnly} />
        {t('payroll.web.sourceDeductions.pendingOnly')}
      </Label>
      <ProblemAlert problem={problemFromError(deductions.error)} onRetry={deductions.refetch} />
      {deductions.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('payroll.web.sourceDeductions.empty')}</p>
      ) : null}
      <div className="flex flex-col divide-y">
        {(deductions.data ?? []).map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {people.data?.find((person) => person.userId === row.userId)?.fullName ??
                  `#${row.userId}`}
              </p>
              <p className="break-all text-xs">
                <SourceReference value={row.sourceReference} />
              </p>
              <span className="text-xs text-muted-foreground">
                {row.assignedMonth ?? row.requestedMonth ?? t('expiry.commerce.noChargeMonth')}
              </span>
            </div>
            <div className="text-right">
              <p className="font-mono">{money(row.amount)}</p>
              <p className="text-xs text-muted-foreground">
                {t(
                  row.sourceKind === 'EXPIRY_RETURN'
                    ? 'payroll.web.sourceDeductions.refund'
                    : 'payroll.web.sourceDeductions.deduction',
                )}
              </p>
            </div>
            <Badge variant={row.state === 'SETTLED' ? 'success' : 'outline'}>
              {t(`payroll.web.sourceDeductions.states.${row.state}`)}
            </Badge>
            {canManage && row.state !== 'SETTLED' ? (
              <Button type="button" size="sm" variant="outline" onClick={() => setAssigning(row)}>
                {t('payroll.web.sourceDeductions.assign')}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
      {assigning ? (
        <AssignMonth key={assigning.id} row={assigning} onClose={() => setAssigning(null)} />
      ) : null}
    </PanelSection>
  );
}

function AssignMonth({ row, onClose }: { row: PayrollSourceDeduction; onClose: () => void }) {
  const { t } = useTranslation();
  const thisMonth = businessDate().slice(0, 7);
  const initial = row.assignedMonth ?? row.requestedMonth ?? thisMonth;
  const [month, setMonth] = useState(initial);
  const assign = useAssignSourceMonth();
  const action = useAction();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('payroll.web.sourceDeductions.assign')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
            void action.run(async () => {
              await assign.mutateAsync({ id: row.id, month });
              toast.success(t('payroll.web.sourceDeductions.saved'));
              onClose();
            });
          }}
        >
          <ProblemAlert problem={action.problem} />
          <FormField label={t('payroll.web.sourceDeductions.month')} htmlFor="source-payroll-month">
            <MonthInput id="source-payroll-month" value={month} onChange={setMonth} />
          </FormField>
          <p className="text-xs text-muted-foreground">
            {t('payroll.web.sourceDeductions.locked')}
          </p>
          <Button type="submit" pending={assign.isPending}>
            {t('common.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Generated charges have no manual-adjustment delete action. */
export function PayslipSourceDeductions({
  rows,
}: {
  rows: readonly {
    id: number;
    name: string;
    sourceKind: string;
    sourceReference: string;
    amount: string;
  }[];
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('payroll.web.sourceDeductions.title')} className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-muted-foreground">
        {t('payroll.web.sourceDeductions.title')}
      </h3>
      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div>
              <p>{row.name}</p>
              <p className="text-xs">
                <SourceReference value={row.sourceReference} />
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  row.sourceKind === 'EXPIRY_RETURN'
                    ? 'payroll.web.sourceDeductions.refund'
                    : 'payroll.web.sourceDeductions.deduction',
                )}
              </p>
            </div>
            <span className="font-mono">{money(row.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
