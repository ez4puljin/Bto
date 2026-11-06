import { BANK_EXPORT_FILES } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Landmark,
  LoaderCircle,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { EmptyState, SegmentedControl } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { monthGrid, shiftMonth } from '@/lib/calendar';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { type BankStatement, useBankCalendar, useBankDay, useBankMutations } from './bank-api';
import { BankRulesPanel } from './bank-rules-panel';
import { BankStatementPanel } from './bank-statement-panel';
import { save } from './report-helpers';

const TABS = ['calendar', 'settings'] as const;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * «Тооцоо хаах» (ADR-0169), the old tool's menu on Bto's books: a calendar of the days with bank
 * statements, a day's statements as cards with how far each is filled, one statement's lines to fill
 * and write to the books, and the rules. The URL keeps the day and the open statement.
 */
export function BankStatementsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const today = businessDate();
  const tab = params.get('tab') === 'settings' ? 'settings' : 'calendar';
  const dateParam = params.get('date');
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const statementParam = Number.parseInt(params.get('statement') ?? '', 10);
  const statementId = Number.isInteger(statementParam) ? statementParam : null;
  const [month, setMonth] = useState((date ?? today).slice(0, 7));

  const open = (next: { date?: string | null; statement?: number | null; tab?: string | null }) =>
    setParams(
      (previous) => {
        const search = new URLSearchParams(previous);
        const put = (key: string, value: string | null | undefined) => {
          if (value === undefined) return;
          if (value) search.set(key, value);
          else search.delete(key);
        };
        put('date', next.date);
        put('tab', next.tab);
        put(
          'statement',
          next.statement === undefined ? undefined : next.statement ? String(next.statement) : null,
        );
        return search;
      },
      { replace: true },
    );
  const pickDay = (day: string) => {
    setMonth(day.slice(0, 7));
    open({ date: day, statement: null });
  };

  return (
    <div>
      <PageHeader
        title={t('finance.bankStatements.title')}
        description={t('finance.bankStatements.description')}
        actions={
          <SegmentedControl
            name={t('finance.bankStatements.tabsLabel')}
            options={TABS}
            value={tab}
            label={(value) => t(`finance.bankStatements.tabs.${value}`)}
            onChange={(value) => open({ tab: value === 'settings' ? value : null })}
          />
        }
      />
      {tab === 'settings' ? (
        <BankRulesPanel />
      ) : date !== null && statementId !== null ? (
        // An open statement takes the whole width: its lines need it, the day's other statements
        // stay one click away above it.
        <div className="space-y-3">
          <DayChips date={date} openId={statementId} onOpen={(id) => open({ statement: id })} />
          <BankStatementPanel
            key={statementId}
            id={statementId}
            onClose={() => open({ statement: null })}
          />
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <MonthCalendar
            month={month}
            selected={date}
            today={today}
            onMonth={setMonth}
            onPick={pickDay}
          />
          {date === null ? (
            <div className="rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]">
              <EmptyState
                title={t('finance.bankStatements.day.pick')}
                icon={CalendarDays}
                action={
                  <p className="text-xs text-muted-foreground">
                    {t('finance.bankStatements.day.pickHint')}
                  </p>
                }
              />
            </div>
          ) : (
            <DayPanel date={date} onOpen={(id) => open({ statement: id })} onDate={pickDay} />
          )}
        </div>
      )}
    </div>
  );
}

function MonthCalendar(props: {
  month: string;
  selected: string | null;
  today: string;
  onMonth: (month: string) => void;
  onPick: (day: string) => void;
}) {
  const { t } = useTranslation();
  const days = useBankCalendar(props.month);
  const counts = new Map((days.data ?? []).map((day) => [day.date, day.count]));
  const total = (days.data ?? []).reduce((sum, day) => sum + day.count, 0);
  const [year = '', mon = '1'] = props.month.split('-');
  return (
    <div className="rounded-xl bg-card p-3 shadow-card ring-1 ring-black/[0.06]">
      <div className="mb-3 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('finance.bankStatements.calendar.previous')}
          onClick={() => props.onMonth(shiftMonth(props.month, -1))}
        >
          <ChevronLeft />
        </Button>
        <div className="text-sm font-semibold">
          {t('common.calendar.title', { year, month: Number.parseInt(mon, 10) })}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('finance.bankStatements.calendar.next')}
          onClick={() => props.onMonth(shiftMonth(props.month, 1))}
        >
          <ChevronRight />
        </Button>
      </div>
      <div className="mb-1 grid grid-cols-7 text-center">
        {WEEKDAYS.map((day, index) => (
          <div
            key={day}
            className={cn(
              'text-xs font-medium text-muted-foreground',
              index >= 5 && 'text-destructive',
            )}
          >
            {t(`common.calendar.weekdays.${day}`)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {monthGrid(props.month).map((day, index) => {
          if (day === null) return <div key={`blank-${index}`} />;
          const count = counts.get(day) ?? 0;
          const selected = day === props.selected;
          return (
            <button
              key={day}
              type="button"
              aria-pressed={selected}
              aria-label={
                count > 0 ? t('finance.bankStatements.calendar.dayWith', { date: day, count }) : day
              }
              onClick={() => props.onPick(day)}
              className={cn(
                'relative mx-auto flex size-9 items-center justify-center rounded-lg text-sm tabular-nums outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                count > 0 ? 'font-semibold' : 'text-muted-foreground',
                day === props.today && 'ring-1 ring-primary',
                selected && 'bg-primary text-primary-foreground hover:bg-primary',
              )}
            >
              {Number.parseInt(day.slice(8), 10)}
              {count > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute bottom-1 size-1 rounded-full',
                    selected ? 'bg-primary-foreground' : 'bg-primary',
                  )}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-baseline justify-between rounded-lg bg-canvas px-3 py-2">
        <div>
          <div className="text-xs text-muted-foreground">
            {t('finance.bankStatements.calendar.thisMonth')}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('finance.bankStatements.calendar.uploaded')}
          </div>
        </div>
        <div className="text-lg font-semibold tabular-nums">{total}</div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="mt-2 w-full"
        onClick={() => props.onPick(props.today)}
      >
        {t('finance.bankStatements.calendar.today')}
      </Button>
    </div>
  );
}

/** The day's statements above an open one, to move between them. */
function DayChips(props: { date: string; openId: number; onOpen: (id: number) => void }) {
  const { t } = useTranslation();
  const day = useBankDay(props.date);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold tabular-nums">{props.date}</span>
      {(day.data ?? []).map((statement) => {
        const selected = statement.id === props.openId;
        return (
          <button
            key={statement.id}
            type="button"
            aria-pressed={selected}
            aria-label={t('finance.bankStatements.card.open', { number: statement.accountNumber })}
            onClick={() => props.onOpen(statement.id)}
            className={cn(
              'inline-flex h-8.5 items-center gap-2 rounded-full bg-card px-3 text-[0.8125rem] shadow-control ring-1 ring-black/[0.06] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'bg-secondary text-secondary-foreground ring-2 ring-primary',
            )}
          >
            <span className="font-medium tabular-nums">{statement.accountNumber}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('finance.bankStatements.card.filled', {
                filled: statement.filledCount,
                total: statement.lineCount,
              })}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayPanel(props: {
  date: string;
  onOpen: (id: number) => void;
  onDate: (date: string) => void;
}) {
  const { t } = useTranslation();
  const canWork = useHasPermission('finance.journal.manage');
  const day = useBankDay(props.date);
  const mutations = useBankMutations();
  const action = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [combining, setCombining] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const [removing, setRemoving] = useState<BankStatement | null>(null);
  const statements = day.data ?? [];

  const uploadFiles = async (files: readonly File[]) => {
    setUploading(true);
    let firstDate: string | null = null;
    for (const file of files) {
      const ok = await action.run(async () => {
        const result = await mutations.upload.mutateAsync(file);
        firstDate ??= result.statement?.statementDate ?? null;
        if (result.statement === null) {
          toast.info(t('finance.bankStatements.uploaded.nothing', { file: file.name }));
        } else if (result.duplicateLines > 0) {
          toast.success(
            t('finance.bankStatements.uploaded.withDuplicates', {
              file: file.name,
              count: result.newLines,
              duplicates: result.duplicateLines,
            }),
          );
        } else {
          toast.success(
            t('finance.bankStatements.uploaded.added', { file: file.name, count: result.newLines }),
          );
        }
      });
      if (!ok) break;
    }
    setUploading(false);
    if (input.current) input.current.value = '';
    if (firstDate !== null && firstDate !== props.date) props.onDate(firstDate);
  };

  const exportDay = async () => {
    setCombining(true);
    await action.run(async () => {
      const manifest = await mutations.manifest.mutateAsync(props.date);
      const files = BANK_EXPORT_FILES.filter((file) => manifest[file] > 0);
      if (files.length === 0) {
        toast.info(t('finance.bankStatements.day.combinedEmpty'));
        return;
      }
      for (const file of files) {
        const blob = await mutations.exportDate.mutateAsync({ date: props.date, file });
        save(blob, `${props.date}_${t(`finance.bankStatements.erkhet.files.${file}`)}.xlsx`);
      }
      toast.success(t('finance.bankStatements.statement.exported', { count: files.length }));
    });
    setCombining(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3 shadow-card ring-1 ring-black/[0.06]">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            {t('finance.bankStatements.day.selected')}
          </div>
          <div className="font-semibold tabular-nums">{props.date}</div>
        </div>
        <Badge variant="secondary">
          {t('finance.bankStatements.day.count', { count: statements.length })}
        </Badge>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setFeesOpen(true)}>
            <Download />
            {t('finance.bankStatements.day.fees')}
          </Button>
          <Button
            variant="outline"
            title={t('finance.bankStatements.day.combinedHint')}
            pending={combining}
            disabled={statements.length === 0}
            onClick={() => void exportDay()}
          >
            <Download />
            {t('finance.bankStatements.day.combined')}
          </Button>
          {canWork ? (
            <>
              <input
                ref={input}
                type="file"
                multiple
                accept=".xlsx"
                className="sr-only"
                aria-label={t('finance.bankStatements.day.fileLabel')}
                onChange={(event) => void uploadFiles([...(event.target.files ?? [])])}
              />
              <Button pending={uploading} onClick={() => input.current?.click()}>
                <Upload />
                {uploading
                  ? t('finance.bankStatements.day.uploading')
                  : t('finance.bankStatements.day.upload')}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <ProblemAlert problem={action.problem} />
      <ProblemAlert
        problem={day.error ? problemFromError(day.error) : null}
        onRetry={() => void day.refetch()}
      />
      {day.isPending ? (
        <div className="flex justify-center py-10 text-muted-foreground">
          <LoaderCircle aria-hidden className="size-5 animate-spin" />
        </div>
      ) : statements.length === 0 ? (
        <div className="rounded-xl bg-card shadow-card ring-1 ring-black/[0.06]">
          <EmptyState
            title={t('finance.bankStatements.day.empty')}
            icon={Landmark}
            action={
              <p className="text-xs text-muted-foreground">
                {t('finance.bankStatements.day.emptyHint')}
              </p>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {statements.map((statement) => (
            <StatementCard
              key={statement.id}
              statement={statement}
              onOpen={() => props.onOpen(statement.id)}
              {...(canWork && statement.postedCount === 0
                ? { onRemove: () => setRemoving(statement) }
                : {})}
            />
          ))}
        </div>
      )}
      <FeeExportDialog open={feesOpen} date={props.date} onClose={() => setFeesOpen(false)} />
      <ConfirmDialog
        open={removing !== null}
        title={t('finance.bankStatements.card.removeTitle')}
        description={t('finance.bankStatements.card.removeBody')}
        confirmLabel={t('finance.bankStatements.card.remove')}
        pending={mutations.remove.isPending}
        problem={problemFromError(mutations.remove.error)}
        onClose={() => {
          setRemoving(null);
          mutations.remove.reset();
        }}
        onConfirm={() => {
          if (!removing) return;
          mutations.remove.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null);
              toast.success(t('finance.bankStatements.card.removed'));
            },
          });
        }}
      />
    </div>
  );
}

function StatementCard(props: {
  statement: BankStatement;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const { statement } = props;
  const percent =
    statement.lineCount > 0 ? Math.round((statement.filledCount / statement.lineCount) * 100) : 0;
  const lacks = (['party', 'account', 'description', 'action', 'export'] as const).filter(
    (field) => statement.missing[field] > 0,
  );
  return (
    <div className="relative rounded-xl bg-card p-3 shadow-card ring-1 ring-black/[0.06] transition-shadow hover:shadow-popover">
      {props.onRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('finance.bankStatements.card.remove')}
          className="absolute top-2 right-2 z-10 size-8 text-muted-foreground"
          onClick={props.onRemove}
        >
          <Trash2 />
        </Button>
      ) : null}
      <button
        type="button"
        aria-label={t('finance.bankStatements.card.open', { number: statement.accountNumber })}
        className="block w-full rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={props.onOpen}
      >
        <div className="flex items-center gap-2.5 pr-8">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
            <Landmark aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold tabular-nums">
              {statement.accountNumber}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {statement.accountCode ? (
                <span className="tabular-nums">{statement.accountCode}</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <CircleAlert aria-hidden className="size-3" />
                  {t('finance.bankStatements.card.unlinked')}
                </span>
              )}
              <span aria-hidden>·</span>
              {statement.currency}
            </span>
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] tabular-nums">
          <span
            className="inline-flex items-center gap-1 text-success"
            title={t('finance.bankStatements.card.credit')}
          >
            <TrendingUp aria-hidden className="size-3.5" />
            {formatMnt(statement.totalCredit)}
          </span>
          {new Decimal(statement.totalDebit).gt(0) ? (
            <span
              className="inline-flex items-center gap-1 text-destructive"
              title={t('finance.bankStatements.card.debit')}
            >
              <TrendingDown aria-hidden className="size-3.5" />
              {formatMnt(statement.totalDebit)}
            </span>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">
            {t('finance.bankStatements.card.lines', { count: statement.lineCount })}
          </span>
        </div>
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {t('finance.bankStatements.card.filled', {
                filled: statement.filledCount,
                total: statement.lineCount,
              })}
            </span>
            <span className="font-medium tabular-nums">{percent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fill">
            <div
              className={cn('h-full rounded-full', percent === 100 ? 'bg-success' : 'bg-primary')}
              style={{ width: `${percent}%` }}
            />
          </div>
          {statement.postedCount > 0 ? (
            <div className="mt-1.5 text-xs text-success">
              {t('finance.bankStatements.card.posted', { count: statement.postedCount })}
            </div>
          ) : null}
          {lacks.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {lacks.map((field) => (
                <span
                  key={field}
                  className="rounded-md bg-danger-soft px-1.5 py-0.5 text-xs text-destructive"
                >
                  {t(`finance.bankStatements.missing.${field}`)}{' '}
                  {statement.lineCount - statement.missing[field]}/{statement.lineCount}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </button>
    </div>
  );
}

function FeeExportDialog(props: { open: boolean; date: string; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useBankMutations();
  const [from, setFrom] = useState(props.date);
  const [to, setTo] = useState(props.date);
  const [seen, setSeen] = useState(props.date);
  if (seen !== props.date) {
    setSeen(props.date);
    setFrom(props.date);
    setTo(props.date);
  }
  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} guard={false}>
        <DialogHeader>
          <DialogTitle>{t('finance.bankStatements.feeExport.title')}</DialogTitle>
          <DialogDescription>{t('finance.bankStatements.feeExport.hint')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField htmlFor="bank-fee-from" label={t('finance.bankStatements.feeExport.from')}>
            <DateInput id="bank-fee-from" value={from} onChange={setFrom} />
          </FormField>
          <FormField htmlFor="bank-fee-to" label={t('finance.bankStatements.feeExport.to')}>
            <DateInput id="bank-fee-to" value={to} onChange={setTo} />
          </FormField>
        </div>
        <ProblemAlert problem={problemFromError(mutations.exportFees.error)} />
        <DialogFooter closeLabel={t('common.cancel')}>
          <Button
            pending={mutations.exportFees.isPending}
            disabled={!from || !to || from > to}
            onClick={() =>
              mutations.exportFees.mutate(
                { from, to },
                {
                  onSuccess: (blob) => {
                    save(blob, `${from}_${to}_${t('finance.bankStatements.erkhet.feeSheet')}.xlsx`);
                    props.onClose();
                  },
                },
              )
            }
          >
            <CalendarDays />
            {t('finance.bankStatements.feeExport.download')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
