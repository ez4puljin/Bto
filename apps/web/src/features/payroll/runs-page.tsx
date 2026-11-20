import { PAYROLL_LIMITS } from '@tugeel/shared/payroll';
import { businessDate } from '@tugeel/shared/time';
import { CalendarRange, Plus } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { MonthInput } from '@/components/date-input';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  LinkRow,
  ListCard,
  ListTable,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { usePayrollMutations, useRuns } from './payroll-api';
import { money } from './payroll-helpers';
import { RunStatusBadge } from './payroll-kit';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'month', kind: 'code', width: 6.5 },
  { key: 'status', kind: 'status', width: 8.5 },
  { key: 'lines', kind: 'count', width: 7 },
  { key: 'net', kind: 'money', width: 9.5 },
  { key: 'cost', kind: 'money', width: 9.5, drop: 1 },
  { key: 'unscored', kind: 'status', width: 9, drop: 2 },
  { key: 'note', kind: 'text', weight: 3, min: 10, drop: 3 },
  { key: 'chevron', kind: 'chevron' },
];

function NewRunDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = usePayrollMutations();
  const action = useAction();
  const key = useRef(randomUuid());
  const thisMonth = businessDate().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (month === '') {
      setError('validation.required');
      return;
    }
    const created: { id: number | null } = { id: null };
    const ok = await action.run(async () => {
      const run = await mutations.createRun.mutateAsync({
        key: key.current,
        month,
        note: note.trim() === '' ? null : note.trim(),
      });
      created.id = run.id;
    });
    if (ok && created.id !== null) {
      toast.success(t('payroll.web.runs.created'));
      void navigate(`/hr/payroll/runs/${created.id}`, { replace: true });
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="sm">
        <DialogHeader>
          <DialogTitle>{t('payroll.web.runs.create')}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={t('payroll.web.runs.month')}
            htmlFor="run-month"
            hint={t('payroll.web.runs.monthHint')}
            error={error}
          >
            <MonthInput
              id="run-month"
              required
              autoFocus
              max={thisMonth}
              value={month}
              onChange={setMonth}
            />
          </FormField>
          <FormField label={t('payroll.web.runs.note')} htmlFor="run-note">
            <Input
              id="run-note"
              maxLength={PAYROLL_LIMITS.maxNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <DialogFormFooter
            pending={mutations.createRun.isPending}
            onCancel={props.onClose}
            submitLabel={t('payroll.web.runs.build')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Сарын цалин» (ADR-0235, hr.payroll.view): the runs by month, a draft («Ноорог») or approved
 * («Батлагдсан»). «Шинэ сар» builds a run for a month from the terms, the attendance and the advances;
 * a row opens the run's sheet.
 */
export function PayrollRunsPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.payroll.manage');
  const runs = useRuns();
  const [creatingOpen, setCreatingOpen] = useCreateParam();
  const rows = runs.data ?? [];
  return (
    <div>
      <PageHeader
        title={t('payroll.web.runs.title')}
        description={t('payroll.web.runs.description')}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreatingOpen(true)}>
              <Plus />
              {t('payroll.web.runs.create')}
            </Button>
          ) : null
        }
      />
      <ProblemAlert problem={problemFromError(runs.error)} onRetry={runs.refetch} />
      <ListCard scroll>
        {runs.data && rows.length === 0 ? (
          <EmptyState title={t('payroll.web.runs.empty')} icon={CalendarRange} />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.web.runs.month')}</TableHead>
                <TableHead>{t('payroll.web.runs.status')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.runs.lines')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.runs.net')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.runs.cost')}</TableHead>
                <TableHead>{t('payroll.web.runs.unscored')}</TableHead>
                <TableHead>{t('payroll.web.runs.note')}</TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.isPending ? <SkeletonRows columns={8} /> : null}
              {rows.map((row) => (
                <LinkRow key={row.id} to={`/hr/payroll/runs/${row.id}`}>
                  <TableCell className="font-mono">
                    <Link
                      to={`/hr/payroll/runs/${row.id}`}
                      className="font-medium text-link hover:underline"
                    >
                      {row.month}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{row.lineCount}</TableCell>
                  <TableCell className="text-right font-mono">{money(row.totals.net)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {money(row.totals.totalCost)}
                  </TableCell>
                  <TableCell>
                    {row.status === 'DRAFT' && row.unscoredCount > 0 ? (
                      <Badge variant="warning">
                        {t('payroll.web.runs.unscoredCount', { count: row.unscoredCount })}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{t('common.none')}</span>
                    )}
                  </TableCell>
                  <TableCell className="truncate">{row.note ?? t('common.none')}</TableCell>
                </LinkRow>
              ))}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {creatingOpen && canManage ? <NewRunDialog onClose={() => setCreatingOpen(false)} /> : null}
    </div>
  );
}
