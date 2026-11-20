import { Decimal, toMoney } from '@tugeel/shared/money';
import {
  PAYROLL_AMOUNT_PATTERN,
  PAYROLL_LIMITS,
  PAYROLL_PERCENT_PATTERN,
} from '@tugeel/shared/payroll';
import {
  Calculator,
  CircleCheck,
  Download,
  LockOpen,
  RefreshCw,
  TriangleAlert,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import {
  ChevronHead,
  EmptyState,
  LinkRow,
  ListCard,
  ListTable,
  SkeletonRows,
} from '@/components/list';
import { MoneyInput } from '@/components/money-input';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type PayrollLine,
  type PayrollRunDetail,
  usePayrollMutations,
  useRun,
  useRunDownload,
} from './payroll-api';
import { cleanPercent, money, percent } from './payroll-helpers';
import { RunStatusBadge } from './payroll-kit';

// 85rem with every column; narrower, the employer's share leaves first, then the fixed salary.
// The name, what the person earns, the deductions and «Гарт олгох» always stay; below that the
// table scrolls inside its card.
const COLUMNS: readonly ColumnSpec[] = [
  { key: 'employee', kind: 'text', weight: 3, min: 13 },
  { key: 'base', kind: 'money', width: 7.5, drop: 2 },
  { key: 'attendance', kind: 'money', width: 8 },
  { key: 'work', kind: 'money', width: 7.5 },
  { key: 'gross', kind: 'money', width: 7.5 },
  { key: 'si', kind: 'money', width: 7 },
  { key: 'pit', kind: 'money', width: 7 },
  { key: 'advance', kind: 'money', width: 7.5 },
  { key: 'net', kind: 'money', width: 8 },
  { key: 'employer', kind: 'money', width: 7.5, drop: 1 },
  { key: 'chevron', kind: 'chevron' },
];

const sum = (values: readonly string[]): string =>
  toMoney(values.reduce((total, value) => total.plus(value), new Decimal(0))).toString();

const attendanceOf = (line: PayrollLine) => line.items.find((item) => item.source === 'ATTENDANCE');
const workEarned = (line: PayrollLine): string =>
  sum(line.items.filter((item) => item.source === 'MANUAL').map((item) => item.earned));

/** The manual items nobody has scored yet, by person: what blocks the approval. */
function unscoredOf(lines: readonly PayrollLine[]) {
  return lines
    .map((line) => ({
      line,
      names: line.items
        .filter((item) => item.source === 'MANUAL' && item.scorePercent === null)
        .map((item) => item.name),
    }))
    .filter((entry) => entry.names.length > 0);
}

function Figure(props: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-[0.8125rem] text-muted-foreground">{props.label}</dt>
      <dd className={`font-mono ${props.strong ? 'font-semibold' : ''}`}>{props.value}</dd>
    </div>
  );
}

/** One person's line: the pay sheet, each KPI item with its score, the free lines. */
function LineDialog(props: { run: PayrollRunDetail; line: PayrollLine; onClose: () => void }) {
  const { t } = useTranslation();
  const { run, line } = props;
  const canManage = useHasPermission('hr.payroll.manage');
  const editable = run.status === 'DRAFT' && canManage;
  const mutations = usePayrollMutations();
  const scoreAction = useAction();
  const adjustAction = useAction();
  const adjustKey = useRef(randomUuid());
  const manual = line.items.filter((item) => item.source === 'MANUAL');
  const [scores, setScores] = useState<Record<number, { score: string; note: string }>>(() =>
    Object.fromEntries(
      manual.map((item) => [item.id, { score: item.scorePercent ?? '', note: item.note ?? '' }]),
    ),
  );
  const [scoreErrors, setScoreErrors] = useState<Record<number, string>>({});
  const [kind, setKind] = useState<'ADDITION' | 'DEDUCTION'>('DEDUCTION');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [taxable, setTaxable] = useState(false);
  const [adjustErrors, setAdjustErrors] = useState<Record<string, string>>({});

  const changed = manual.filter((item) => {
    const draft = scores[item.id];
    return (
      draft !== undefined &&
      (draft.score !== (item.scorePercent ?? '') || draft.note !== (item.note ?? ''))
    );
  });
  const saveScores = async (event: FormEvent) => {
    event.preventDefault();
    const errors: Record<number, string> = {};
    for (const item of changed) {
      const draft = scores[item.id];
      if (draft && draft.score !== '' && !PAYROLL_PERCENT_PATTERN.test(draft.score)) {
        errors[item.id] = 'validation.percent';
      }
    }
    setScoreErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const ok = await scoreAction.run(() =>
      mutations.saveScores.mutateAsync({
        runId: run.id,
        scores: changed.map((item) => {
          const draft = scores[item.id] ?? { score: '', note: '' };
          return {
            itemId: item.id,
            scorePercent: draft.score === '' ? null : draft.score,
            note: draft.note.trim() === '' ? null : draft.note.trim(),
          };
        }),
      }),
    );
    if (ok) toast.success(t('payroll.web.line.scoresSaved'));
  };
  const addAdjustment = async (event: FormEvent) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (name.trim() === '') errors.name = 'validation.required';
    if (!PAYROLL_AMOUNT_PATTERN.test(amount) || Number(amount) <= 0)
      errors.amount = 'validation.money';
    setAdjustErrors(errors);
    if (Object.keys(errors).length > 0) return;
    const ok = await adjustAction.run(() =>
      mutations.addAdjustment.mutateAsync({
        runId: run.id,
        lineId: line.id,
        key: adjustKey.current,
        kind,
        name: name.trim(),
        amount,
        taxable: kind === 'ADDITION' && taxable,
      }),
    );
    if (ok) {
      adjustKey.current = randomUuid();
      setName('');
      setAmount('');
      setTaxable(false);
      toast.success(t('payroll.web.line.adjustmentAdded'));
    }
  };
  const removeAdjustment = async (adjustmentId: number) => {
    const ok = await adjustAction.run(() =>
      mutations.removeAdjustment.mutateAsync({ runId: run.id, lineId: line.id, adjustmentId }),
    );
    if (ok) toast.success(t('payroll.web.line.adjustmentRemoved'));
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="xl" guard={false}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {line.fullName}
            <RunStatusBadge status={run.status} />
          </DialogTitle>
          <p className="text-[0.8125rem] text-muted-foreground">
            {[line.position, line.divisionName, run.month].filter(Boolean).join(' · ')}
          </p>
        </DialogHeader>

        <section aria-label={t('payroll.web.line.items')} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('payroll.web.line.items')}
          </h3>
          <ProblemAlert problem={scoreAction.problem} />
          <form
            noValidate
            onSubmit={(event) => void saveScores(event)}
            className="flex flex-col gap-3"
          >
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('payroll.web.line.itemName')}</TableHead>
                    <TableHead className="text-right">{t('payroll.web.line.amount')}</TableHead>
                    <TableHead className="text-right">{t('payroll.web.line.score')}</TableHead>
                    <TableHead className="text-right">{t('payroll.web.line.earned')}</TableHead>
                    <TableHead>{t('payroll.web.line.note')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {line.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        {t('payroll.web.line.noItems')}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {line.items.map((item) => {
                    const draft = scores[item.id];
                    const scoring = editable && item.source === 'MANUAL' && draft !== undefined;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="align-top">
                          <span className="block font-medium">{item.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t(`payroll.web.items.sources.${item.source}`)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right align-top font-mono">
                          {money(item.amount)}
                        </TableCell>
                        <TableCell className="text-right align-top font-mono">
                          {scoring ? (
                            <div className="flex flex-col items-end gap-1">
                              <Input
                                aria-label={t('payroll.web.line.scoreFor', { name: item.name })}
                                inputMode="decimal"
                                className="w-20 text-right"
                                placeholder="0–100"
                                aria-invalid={scoreErrors[item.id] ? true : undefined}
                                value={draft.score}
                                onChange={(event) => {
                                  setScoreErrors({});
                                  setScores((current) => ({
                                    ...current,
                                    [item.id]: {
                                      score: cleanPercent(event.target.value),
                                      note: draft.note,
                                    },
                                  }));
                                }}
                              />
                              {scoreErrors[item.id] ? (
                                <span role="alert" className="font-sans text-xs text-destructive">
                                  {t('validation.percent')}
                                </span>
                              ) : null}
                            </div>
                          ) : item.scorePercent === null ? (
                            <Badge variant="warning">{t('payroll.web.line.notScored')}</Badge>
                          ) : (
                            percent(item.scorePercent)
                          )}
                        </TableCell>
                        <TableCell className="text-right align-top font-mono">
                          {money(item.earned)}
                        </TableCell>
                        <TableCell className="min-w-44 align-top text-[0.8125rem] whitespace-normal">
                          {scoring ? (
                            <Input
                              aria-label={t('payroll.web.line.noteFor', { name: item.name })}
                              maxLength={PAYROLL_LIMITS.maxNote}
                              value={draft.note}
                              onChange={(event) =>
                                setScores((current) => ({
                                  ...current,
                                  [item.id]: { score: draft.score, note: event.target.value },
                                }))
                              }
                            />
                          ) : item.source === 'ATTENDANCE' ? (
                            line.attendanceMeasured ? (
                              <span className="text-muted-foreground">
                                {t('payroll.web.line.attendanceNote', {
                                  workdays: line.workdays ?? 0,
                                  attended: line.attendedDays ?? 0,
                                  late: line.lateDays ?? 0,
                                  base: percent(item.basePercent) || percent('100'),
                                  penalty: percent(item.penaltyPercent) || percent('0'),
                                })}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                {t('payroll.web.line.attendanceUntracked')}
                              </span>
                            )
                          ) : (
                            <span className="text-muted-foreground">
                              {[item.note, item.scoredByName].filter(Boolean).join(' · ') ||
                                t('common.none')}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {editable && manual.length > 0 ? (
              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={changed.length === 0}
                  pending={mutations.saveScores.isPending}
                >
                  {t('payroll.web.line.saveScores')}
                </Button>
              </div>
            ) : null}
          </form>
        </section>

        <section aria-label={t('payroll.web.line.adjustments')} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('payroll.web.line.adjustments')}
          </h3>
          <ProblemAlert problem={adjustAction.problem} />
          {line.adjustments.length === 0 ? (
            <p className="text-[0.8125rem] text-muted-foreground">
              {t('payroll.web.line.noAdjustments')}
            </p>
          ) : (
            <ul className="divide-y divide-border/80 rounded-xl border">
              {line.adjustments.map((adjustment) => (
                <li key={adjustment.id} className="flex items-center gap-3 px-3 py-2">
                  <Badge variant={adjustment.kind === 'ADDITION' ? 'success' : 'outline'}>
                    {t(`payroll.web.line.kinds.${adjustment.kind}`)}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">
                    {adjustment.name}
                    {adjustment.kind === 'ADDITION' && adjustment.taxable ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('payroll.web.line.taxable')}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono">{money(adjustment.amount)}</span>
                  {editable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('payroll.web.line.removeAdjustment', { name: adjustment.name })}
                      onClick={() => void removeAdjustment(adjustment.id)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {editable ? (
            <form
              noValidate
              onSubmit={(event) => void addAdjustment(event)}
              className="@container flex flex-col gap-3 rounded-xl bg-fill p-3"
            >
              <div className="grid gap-3 @xl:grid-cols-[9rem_minmax(0,1fr)_10rem]">
                <FormField label={t('payroll.web.line.kind')} htmlFor="adjust-kind">
                  <NativeSelect
                    id="adjust-kind"
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value === 'ADDITION' ? 'ADDITION' : 'DEDUCTION')
                    }
                  >
                    <option value="ADDITION">{t('payroll.web.line.kinds.ADDITION')}</option>
                    <option value="DEDUCTION">{t('payroll.web.line.kinds.DEDUCTION')}</option>
                  </NativeSelect>
                </FormField>
                <FormField
                  label={t('payroll.web.line.adjustName')}
                  htmlFor="adjust-name"
                  error={adjustErrors.name}
                >
                  <Input
                    id="adjust-name"
                    maxLength={PAYROLL_LIMITS.maxName}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </FormField>
                <FormField
                  label={t('payroll.web.line.amount')}
                  htmlFor="adjust-amount"
                  error={adjustErrors.amount}
                >
                  <MoneyInput
                    id="adjust-amount"
                    suffix="₮"
                    value={amount}
                    onValueChange={setAmount}
                  />
                </FormField>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {kind === 'ADDITION' ? (
                  <Label className="flex items-center gap-2 font-normal">
                    <Switch checked={taxable} onCheckedChange={setTaxable} />
                    {t('payroll.web.line.taxableSwitch')}
                  </Label>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  pending={mutations.addAdjustment.isPending}
                >
                  {t('payroll.web.line.addAdjustment')}
                </Button>
              </div>
            </form>
          ) : null}
        </section>

        <section aria-label={t('payroll.web.line.sheet')} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t('payroll.web.line.sheet')}
          </h3>
          <dl className="grid gap-x-8 divide-y divide-border/80 rounded-xl border px-3 @container sm:grid-cols-2 sm:divide-y-0">
            <div className="divide-y divide-border/80">
              <Figure label={t('payroll.web.line.base')} value={money(line.baseSalary)} />
              <Figure label={t('payroll.web.line.kpi')} value={money(line.kpiTotal)} />
              <Figure
                label={t('payroll.web.line.taxableAdditions')}
                value={money(line.taxableAdditions)}
              />
              <Figure label={t('payroll.web.line.gross')} value={money(line.gross)} strong />
              <Figure label={t('payroll.web.line.employerSi')} value={money(line.employerSi)} />
            </div>
            <div className="divide-y divide-border/80">
              <Figure
                label={
                  line.paysSocialInsurance
                    ? t('payroll.web.line.employeeSi')
                    : t('payroll.web.line.noInsurance')
                }
                value={money(line.employeeSi)}
              />
              <Figure label={t('payroll.web.line.pit')} value={money(line.pit)} />
              <Figure label={t('payroll.web.line.advance')} value={money(line.advance)} />
              <Figure
                label={t('payroll.web.line.otherAdditions')}
                value={money(line.otherAdditions)}
              />
              <Figure label={t('payroll.web.line.deductions')} value={money(line.deductions)} />
              <Figure label={t('payroll.web.line.net')} value={money(line.net)} strong />
            </div>
          </dl>
        </section>
      </DialogContent>
    </Dialog>
  );
}

/** «Сарын цалин» of one month: the whole sheet, its buttons and the line a row opens. */
export function PayrollRunPage() {
  const { t } = useTranslation();
  const params = useParams();
  const [search] = useSearchParams();
  const setParam = useSetParam();
  const id = Number(params.id);
  const canManage = useHasPermission('hr.payroll.manage');
  const run = useRun(id);
  const mutations = usePayrollMutations();
  const download = useRunDownload();
  const action = useAction();
  const [confirm, setConfirm] = useState<'recompute' | 'approve' | 'reopen' | null>(null);
  const [refreshTerms, setRefreshTerms] = useState(false);
  const [reason, setReason] = useState('');
  const data = run.data;
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const unscored = useMemo(() => unscoredOf(lines), [lines]);
  const lineId = Number(search.get('line') ?? '');
  const opened =
    data && Number.isInteger(lineId) ? data.lines.find((line) => line.id === lineId) : undefined;
  const draft = data?.status === 'DRAFT';

  const closeConfirm = () => {
    action.clear();
    setConfirm(null);
    setReason('');
    setRefreshTerms(false);
  };
  const doConfirm = async () => {
    if (!data || confirm === null) return;
    const ok = await action.run(() =>
      confirm === 'recompute'
        ? mutations.recompute.mutateAsync({ id: data.id, refreshTerms })
        : confirm === 'approve'
          ? mutations.approve.mutateAsync(data.id)
          : mutations.reopen.mutateAsync({ id: data.id, reason: reason.trim() }),
    );
    if (ok) {
      toast.success(t(`payroll.web.run.done.${confirm}`));
      closeConfirm();
    }
  };
  const exportXlsx = async () => {
    if (!data) return;
    try {
      saveBlob(
        await download.mutateAsync(data.id),
        `${t('payroll.web.run.fileName', { month: data.month })}.xlsx`,
      );
    } catch {
      toast.warning(t('common.retry'));
    }
  };

  const totals = data?.totals;
  return (
    <div>
      <PageHeader
        title={t('payroll.web.run.title', { month: data?.month ?? '' })}
        meta={
          data ? (
            <span className="flex flex-wrap items-center gap-2">
              <RunStatusBadge status={data.status} />
              <span>{t('payroll.web.run.count', { count: data.lineCount })}</span>
              <span>
                {t('payroll.web.run.computedAt', { at: formatUbMinute(data.computedAt) })}
              </span>
            </span>
          ) : null
        }
        actions={
          data ? (
            <>
              <Button
                variant="outline"
                size="sm"
                pending={download.isPending}
                onClick={() => void exportXlsx()}
              >
                <Download />
                {t('payroll.web.run.excel')}
              </Button>
              {canManage && draft ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setConfirm('recompute')}>
                    <RefreshCw />
                    {t('payroll.web.run.recompute')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={unscored.length > 0 || lines.length === 0}
                    onClick={() => setConfirm('approve')}
                  >
                    <CircleCheck />
                    {t('payroll.web.run.approve')}
                  </Button>
                </>
              ) : null}
              {canManage && !draft ? (
                <Button variant="outline" size="sm" onClick={() => setConfirm('reopen')}>
                  <LockOpen />
                  {t('payroll.web.run.reopen')}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      <ProblemAlert
        problem={(confirm === null ? action.problem : null) ?? problemFromError(run.error)}
        onRetry={run.refetch}
      />
      {data && !draft ? (
        <Alert className="mb-3">
          <CircleCheck aria-hidden />
          <AlertDescription>
            {t('payroll.web.run.approvedBanner', {
              at: data.approvedAt ? formatUbMinute(data.approvedAt) : '',
              name: data.approvedByName ?? t('common.none'),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {data && draft && data.reopenedAt ? (
        <Alert className="mb-3">
          <LockOpen aria-hidden />
          <AlertDescription>
            {t('payroll.web.run.reopenedBanner', {
              at: formatUbMinute(data.reopenedAt),
              name: data.reopenedByName ?? t('common.none'),
              reason: data.reopenReason ?? t('common.none'),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {data && draft && unscored.length > 0 ? (
        <Alert variant="destructive" className="mb-3">
          <TriangleAlert aria-hidden />
          <AlertDescription>
            <p className="font-medium">
              {t('payroll.web.run.unscoredTitle', { count: unscored.length })}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {unscored.map((entry) => (
                <li key={entry.line.id}>
                  <Link
                    to={hrefWithParam(search, 'line', String(entry.line.id))}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {entry.line.fullName}
                  </Link>
                  {': '}
                  {entry.names.join(', ')}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <ListCard scroll>
        {data && lines.length === 0 ? (
          <EmptyState title={t('payroll.web.run.empty')} icon={Calculator} />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.web.run.columns.employee')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.base')}</TableHead>
                <TableHead className="text-right">
                  {t('payroll.web.run.columns.attendance')}
                </TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.work')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.gross')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.si')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.pit')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.advance')}</TableHead>
                <TableHead className="text-right">{t('payroll.web.run.columns.net')}</TableHead>
                <TableHead className="text-right">
                  {t('payroll.web.run.columns.employer')}
                </TableHead>
                <ChevronHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.isPending ? <SkeletonRows columns={11} /> : null}
              {lines.map((line) => {
                const attendance = attendanceOf(line);
                return (
                  <LinkRow key={line.id} to={hrefWithParam(search, 'line', String(line.id))}>
                    <TableCell>
                      <Link
                        to={hrefWithParam(search, 'line', String(line.id))}
                        className="block min-w-0"
                      >
                        <span className="block truncate font-medium">{line.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {line.position ?? t('common.none')}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(line.baseSalary)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {attendance ? (
                        <>
                          <span className="block">{money(attendance.earned)}</span>
                          <span className="block font-sans text-xs text-muted-foreground">
                            {percent(attendance.scorePercent)}
                          </span>
                        </>
                      ) : (
                        t('common.none')
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {money(workEarned(line))}
                      {line.unscoredCount > 0 && draft ? (
                        <span className="block font-sans text-xs text-destructive">
                          {t('payroll.web.run.unscoredCount', { count: line.unscoredCount })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(line.gross)}</TableCell>
                    <TableCell className="text-right font-mono">{money(line.employeeSi)}</TableCell>
                    <TableCell className="text-right font-mono">{money(line.pit)}</TableCell>
                    <TableCell className="text-right font-mono">{money(line.advance)}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {money(line.net)}
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(line.employerSi)}</TableCell>
                  </LinkRow>
                );
              })}
            </TableBody>
            {totals && lines.length > 0 ? (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">{t('payroll.web.run.totals')}</TableCell>
                  <TableCell className="text-right font-mono">{money(totals.baseSalary)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {money(
                      sum(
                        lines.flatMap((line) =>
                          line.items
                            .filter((item) => item.source === 'ATTENDANCE')
                            .map((item) => item.earned),
                        ),
                      ),
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(sum(lines.map(workEarned)))}
                  </TableCell>
                  <TableCell className="text-right font-mono">{money(totals.gross)}</TableCell>
                  <TableCell className="text-right font-mono">{money(totals.employeeSi)}</TableCell>
                  <TableCell className="text-right font-mono">{money(totals.pit)}</TableCell>
                  <TableCell className="text-right font-mono">{money(totals.advance)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {money(totals.net)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{money(totals.employerSi)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            ) : null}
          </ListTable>
        )}
      </ListCard>
      {totals && lines.length > 0 ? (
        <p className="mt-2 px-1 text-[0.8125rem] text-muted-foreground">
          {t('payroll.web.run.costLine', {
            employer: money(totals.employerSi),
            cost: money(totals.totalCost),
          })}
        </p>
      ) : null}

      {data && opened ? (
        <LineDialog
          key={opened.id}
          run={data}
          line={opened}
          onClose={() => setParam('line', null)}
        />
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        variant={confirm === 'reopen' ? 'destructive' : 'default'}
        initialFocus={confirm === 'reopen' ? 'first' : 'confirm'}
        title={confirm ? t(`payroll.web.run.confirm.${confirm}.title`) : ''}
        description={
          confirm
            ? t(`payroll.web.run.confirm.${confirm}.description`, { month: data?.month ?? '' })
            : undefined
        }
        confirmLabel={confirm ? t(`payroll.web.run.confirm.${confirm}.action`) : ''}
        disabled={confirm === 'reopen' && reason.trim() === ''}
        pending={
          mutations.recompute.isPending || mutations.approve.isPending || mutations.reopen.isPending
        }
        problem={action.problem}
        onConfirm={() => void doConfirm()}
        onClose={closeConfirm}
      >
        {confirm === 'recompute' ? (
          <Label className="flex items-start gap-2 text-[0.8125rem] font-normal">
            <Checkbox
              checked={refreshTerms}
              onCheckedChange={(on) => setRefreshTerms(on === true)}
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium">{t('payroll.web.run.refreshTerms')}</span>
              <span className="block text-muted-foreground">
                {t('payroll.web.run.refreshTermsHint')}
              </span>
            </span>
          </Label>
        ) : null}
        {confirm === 'approve' && totals ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('payroll.web.run.approveSummary', {
              count: data?.lineCount ?? 0,
              net: money(totals.net),
            })}
          </p>
        ) : null}
        {confirm === 'reopen' ? (
          <FormField label={t('payroll.web.reason')} htmlFor="run-reopen-reason">
            <Input
              id="run-reopen-reason"
              maxLength={PAYROLL_LIMITS.maxNote}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
