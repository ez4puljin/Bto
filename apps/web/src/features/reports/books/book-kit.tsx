import { ChevronRight, Download, Info, Printer, SlidersHorizontal, X } from 'lucide-react';
import type { ReportViewPage } from '@tugeel/shared/reports';
import { businessDate, businessDateTime } from '@tugeel/shared/time';
import { Popover } from 'radix-ui';
import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { Combobox, type ComboboxOption } from '@/components/combobox';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableBody, TableCell } from '@/components/ui/table';
import { useAuthState } from '@/app/auth-context';
import { useCompanyName } from '@/features/company/api';
import { cn } from '@/lib/utils';
import { DATE } from '../report-helpers';
import { ReportViews } from '../report-views';
import {
  BOOK_TABLE,
  type BookColumn,
  detailParts,
  detailText,
  PERIOD_PRESETS,
  type Precision,
  PRECISIONS,
  paperRem,
  periodText,
  presetRange,
  tableMinRem,
} from './book-format';
import type { usePromptDates } from './book-state';
import { DateInput } from '@/components/date-input';

/**
 * «Тайлангийн нөхцөл» (2026-11-02): the report's name as the title, then «Хугацаа» across the
 * whole width (the dates and the usual periods), «Шүүлтүүр» in two balanced columns and
 * «Харагдац» (precision, grouping, the switches); the content scrolls under a fixed footer.
 */
export function PromptDialog(props: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  valid: boolean;
  dates: ReturnType<typeof usePromptDates>;
  filters: ReactNode;
  view: ReactNode;
}) {
  const { t } = useTranslation();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (props.valid) props.onSubmit();
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        size="xl"
        className="[&_input[data-slot=input]]:h-9 [&_select]:h-9 [&_select]:text-[0.8125rem]"
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <DialogDescription>{t('reports.prompt.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <PromptSection title={t('reports.prompt.period')}>
            <PeriodFields {...props.dates} />
          </PromptSection>
          <PromptSection title={t('reports.prompt.filterSection')}>
            <div className="grid items-start gap-x-6 gap-y-3 sm:grid-cols-2">{props.filters}</div>
          </PromptSection>
          <PromptSection title={t('reports.prompt.view')}>
            <div className="grid items-end gap-x-6 gap-y-3 sm:grid-cols-3">{props.view}</div>
          </PromptSection>
          <DialogFormFooter
            pending={false}
            disabled={!props.valid}
            onCancel={() => props.onOpenChange(false)}
            submitLabel={t('reports.prompt.submit')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A titled part of the prompt. */
function PromptSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2.5">
      <h3 id={id} className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** «Эхний огноо» – «Эцсийн огноо», then «Энэ сар», «Өмнөх сар», «Энэ улирал», «Энэ жил». */
function PeriodFields(props: ReturnType<typeof usePromptDates>) {
  const { t } = useTranslation();
  const today = businessDate();
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="w-40">
        <FormField label={t('reports.prompt.from')} htmlFor="book-from">
          <DateInput
            id="book-from"
            required
            value={props.start}
            onChange={(value) => props.setStart(value)}
          />
        </FormField>
      </div>
      <div className="w-40">
        <FormField
          label={t('reports.prompt.to')}
          htmlFor="book-to"
          error={
            DATE.test(props.start) && DATE.test(props.end) && props.start > props.end
              ? t('reports.prompt.invalidRange')
              : undefined
          }
        >
          <DateInput
            id="book-to"
            required
            value={props.end}
            onChange={(value) => props.setEnd(value)}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 sm:mt-[1.4rem]">
        {PERIOD_PRESETS.map((preset) => {
          const range = presetRange(preset, today);
          const active = range.from === props.start && range.to === props.end;
          return (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant={active ? 'secondary' : 'outline'}
              aria-pressed={active}
              className="h-9"
              onClick={() => {
                props.setStart(range.from);
                props.setEnd(range.to);
              }}
            >
              {t(`reports.prompt.presets.${preset}`)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** «Нарийвчлал». */
export function PrecisionField(props: { value: Precision; onChange: (value: Precision) => void }) {
  const { t } = useTranslation();
  return (
    <FormField label={t('reports.prompt.precision')} htmlFor="book-precision">
      <NativeSelect
        id="book-precision"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value === '0' ? '0' : '2')}
      >
        {PRECISIONS.map((value) => (
          <option key={value} value={value}>
            {t(`reports.prompt.precisions.${value}`)}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}

/** A pick-one select of the prompt with «Бүгд» first. */
export function SelectField(props: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <FormField label={props.label} htmlFor={props.id}>
      <NativeSelect
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.emptyLabel === undefined ? (
          <option value="">{t('reports.prompt.all')}</option>
        ) : props.emptyLabel ? (
          <option value="">{props.emptyLabel}</option>
        ) : null}
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  );
}

/** A switch of the prompt's «Харагдац»: a box and its label on the controls' line. */
export function CheckField(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-2">
      <Checkbox
        id={props.id}
        checked={props.checked}
        onCheckedChange={(value) => props.onChange(value === true)}
      />
      <Label htmlFor={props.id}>{props.label}</Label>
    </div>
  );
}

/**
 * A pick-many field like Erkhet's tag boxes: the chosen ones as chips with ×, then a searchable
 * list to add one more (none chosen: «Бүгд»).
 */
export function MultiPick(props: {
  label: string;
  options: readonly ComboboxOption[];
  values: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const { t } = useTranslation();
  const chosen = props.values.map(
    (value) => props.options.find((option) => option.value === value) ?? { value, label: value },
  );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.8125rem] leading-none font-medium text-foreground">
        {props.label}
      </span>
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((option) => (
            <li
              key={option.value}
              className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-[0.8125rem]"
            >
              {option.label}
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={t('reports.prompt.remove', { name: option.label })}
                onClick={() => props.onChange(props.values.filter((v) => v !== option.value))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Combobox
        aria-label={props.label}
        value=""
        emptyLabel={chosen.length > 0 ? t('reports.prompt.choose') : t('reports.prompt.all')}
        options={props.options.filter((option) => !props.values.includes(option.value))}
        onChange={(value) => {
          if (value) props.onChange([...props.values, value]);
        }}
        className="h-9 w-full max-w-none justify-between rounded-lg border-input px-3 text-[0.8125rem] font-normal"
      />
    </div>
  );
}

/** A picked record shown read-only with «Солих», or the control that picks one. */
export function PickedField(props: {
  label: string;
  htmlFor: string;
  picked: string | null;
  onClear: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <FormField label={props.label} htmlFor={props.htmlFor}>
      {props.picked ? (
        <div className="flex gap-2">
          <Input id={props.htmlFor} readOnly value={props.picked} />
          <Button type="button" variant="outline" className="h-9" onClick={props.onClear}>
            {t('reports.prompt.change')}
          </Button>
        </div>
      ) : (
        props.children
      )}
    </FormField>
  );
}

/**
 * The report's buttons: ⓘ (how to read the paper), «Excel», «Хэвлэх» and the main one, the
 * prompt, named by the period it shows («Нөхцөл» before the first run).
 */
export function BookActions(props: {
  onPrompt: () => void;
  onExcel?: () => void;
  excelPending?: boolean;
  /** The report is on screen (Excel and print have something to take). */
  ready: boolean;
  period: { from: string; to: string } | null;
  /** The page whose saved views «Загвар» offers (ADR-0194). */
  views?: ReportViewPage;
}) {
  const { t } = useTranslation();
  const period = props.period ? periodText(props.period.from, props.period.to) : null;
  return (
    <>
      <Popover.Root>
        <Popover.Trigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={t('reports.prompt.help')}
            title={t('reports.prompt.help')}
          >
            <Info />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            collisionPadding={8}
            className="z-50 w-80 rounded-xl border border-border bg-popover p-3 text-[0.8125rem] leading-relaxed text-popover-foreground shadow-popover"
          >
            {t('reports.prompt.drillHint')}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {props.views ? <ReportViews page={props.views} /> : null}
      {props.onExcel ? (
        <Button
          variant="outline"
          size="sm"
          disabled={!props.ready || props.excelPending}
          onClick={props.onExcel}
        >
          <Download />
          {t('reports.common.excel')}
        </Button>
      ) : null}
      <Button variant="outline" size="sm" disabled={!props.ready} onClick={() => window.print()}>
        <Printer />
        {t('reports.prompt.print')}
      </Button>
      <Button
        size="sm"
        onClick={props.onPrompt}
        aria-label={period ? t('reports.prompt.conditionsOf', { period }) : undefined}
        title={period ? t('reports.prompt.conditionsOf', { period }) : undefined}
      >
        <SlidersHorizontal />
        <span className="tabular-nums">{period ?? t('reports.prompt.conditions')}</span>
      </Button>
    </>
  );
}

/**
 * A report's column (2026-11-01): the page header and the paper share one width, sized to the
 * paper's table (narrower below 1600px) and centred, so the buttons line up with the paper's right
 * edge; `null` runs the whole width. Paper pages are the exception to "pages sit at the left"
 * (docs/ui.md §4).
 */
export function BookPage({
  columns,
  children,
}: {
  columns: readonly BookColumn[] | null;
  children: ReactNode;
}) {
  const style =
    columns === null
      ? undefined
      : ({
          '--paper': `${paperRem(columns)}rem`,
          '--paper-compact': `${paperRem(columns, true)}rem`,
        } as CSSProperties);
  return (
    <div
      className={cn(
        'mx-auto w-full print:max-w-none!',
        columns !== null && 'max-w-(--paper) max-[1600px]:max-w-(--paper-compact)',
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/** The time a paper is printed, set again just before each print (Ulaanbaatar). */
function usePrintedAt(): string {
  const [at, setAt] = useState(() => businessDateTime(new Date()));
  useEffect(() => {
    const before = () => flushSync(() => setAt(businessDateTime(new Date())));
    window.addEventListener('beforeprint', before);
    return () => window.removeEventListener('beforeprint', before);
  }, []);
  return at;
}

/**
 * The report's paper as Erkhet draws it: the title in the middle (the page's heading), the company
 * on the left with its note, the period on the right «(төгрөгөөр)» (and on paper the time it was
 * printed), the conditions, then ONE scroll box with the table — its head and first column in
 * view — and the lines to sign; the paper never runs past the window, so the box is the only thing
 * that scrolls. Without a `period` it is the blank paper before the first run.
 * `orientation` is the printed A4 sheet's, numbered «1 / 3» at the foot.
 */
export function BookSheet(props: {
  title: string;
  period: { from: string; to: string } | null;
  filters: readonly string[];
  orientation: 'portrait' | 'landscape';
  loading?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const company = useCompanyName();
  const auth = useAuthState();
  const printedAt = usePrintedAt();
  const me = auth.status === 'authenticated' ? auth.me.fullName : '';
  const filters = props.filters.join(', ');
  return (
    <section className="flex max-h-[calc(100dvh-10rem)] flex-col rounded-xl bg-card px-4 pt-6 pb-4 shadow-card ring-1 ring-black/[0.06] min-[1600px]:px-8 min-[1600px]:pb-6 print:block print:max-h-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <style media="print">{`@page{size:A4 ${props.orientation};margin:10mm 8mm 12mm;@bottom-right{content:counter(page) " / " counter(pages);font-size:8pt}}`}</style>
      <h1 className="mb-3 text-center text-[1.25rem] leading-tight font-semibold tracking-tight text-balance">
        {props.title}
      </h1>
      {props.period ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3 text-[0.8125rem]">
          <div className="text-center">
            <p className="min-w-56 border-b border-foreground/70 px-4 font-semibold">{company}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('reports.prompt.companyNote')}
            </p>
          </div>
          <div className="text-right">
            <p className="tabular-nums">{periodText(props.period.from, props.period.to)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('reports.prompt.currencyNote')}
            </p>
            <p className="mt-0.5 hidden text-xs tabular-nums print:block">
              {t('reports.prompt.printedAt', { at: printedAt })}
            </p>
          </div>
        </div>
      ) : null}
      {props.period && filters ? (
        <p className="mb-3 truncate text-[0.8125rem] print:whitespace-normal" title={filters}>
          <span className="text-muted-foreground">{t('reports.prompt.filters')}</span> {filters}
        </p>
      ) : null}
      {props.loading ? (
        <p role="status" className="sr-only">
          {t('reports.prompt.loading')}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto [scrollbar-width:thin] print:overflow-visible">
        {props.children}
        {props.footer}
        {props.period ? (
          <div className="mt-12 grid grid-cols-2 gap-x-16 pb-1 text-[0.8125rem] break-inside-avoid">
            <Signature label={t('reports.prompt.preparedBy')} name={me} />
            <Signature label={t('reports.prompt.reviewedBy')} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** A line to sign: its label, a ruled blank and the name under /…/ when known. */
function Signature(props: { label: string; name?: string }) {
  return (
    <p className="flex min-w-0 flex-wrap items-end gap-x-2 gap-y-1">
      <span>{props.label}</span>
      <span aria-hidden className="inline-block h-4 w-44 border-b border-foreground/60" />
      {props.name ? <span className="text-muted-foreground">{`/${props.name}/`}</span> : null}
    </p>
  );
}

/** The blank paper before the first run: what to do and «Нөхцөл оруулах». */
export function BookBlank(props: {
  title: string;
  icon: LucideIcon;
  orientation: 'portrait' | 'landscape';
  onPrompt: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BookSheet title={props.title} period={null} filters={[]} orientation={props.orientation}>
      <EmptyState
        icon={props.icon}
        title={t('reports.prompt.waiting')}
        action={
          <Button size="sm" onClick={props.onPrompt}>
            <SlidersHorizontal />
            {t('reports.prompt.start')}
          </Button>
        }
      />
    </BookSheet>
  );
}

/**
 * The paper's table without the shadcn wrapper's own scroll box (the sheet holds the one box, so
 * the head sticks): fixed columns from `columns` (narrower below 1600px), never narrower than
 * their least widths.
 */
export function BookTable({
  columns,
  children,
}: {
  columns: readonly BookColumn[];
  children: ReactNode;
}) {
  return (
    <table
      data-slot="table"
      className={cn(
        BOOK_TABLE,
        'min-w-(--table-min) max-[1600px]:min-w-(--table-min-compact) print:min-w-0!',
      )}
      style={
        {
          '--table-min': `${tableMinRem(columns)}rem`,
          '--table-min-compact': `${tableMinRem(columns, true)}rem`,
        } as CSSProperties
      }
    >
      <colgroup>
        {columns.map((column, index) =>
          'rem' in column ? (
            <col
              key={index}
              className="w-(--col) max-[1600px]:w-(--col-compact)"
              style={
                {
                  '--col': `${column.rem}rem`,
                  '--col-compact': `${column.compact}rem`,
                } as CSSProperties
              }
            />
          ) : (
            <col key={index} />
          ),
        )}
      </colgroup>
      {children}
    </table>
  );
}

/** A head cell's label with its qualifier on a second, lighter line («Борлуулалт / НӨАТ-гүй»). */
export function HeadLabel({ label, note }: { label: string; note: string }) {
  return (
    <>
      {label}
      <span className="block text-xs font-normal text-muted-foreground print:text-foreground">
        {note}
      </span>
    </>
  );
}

/** A text cell on one line, cut with «…» and whole on hover; it wraps on paper. */
export function TextCell(props: { text: string; colSpan?: number; className?: string }) {
  return (
    <TableCell
      colSpan={props.colSpan}
      title={props.text || undefined}
      className={cn('truncate print:overflow-visible print:whitespace-normal', props.className)}
    >
      {props.text}
    </TableCell>
  );
}

/** A body row's opaque ground (the sticky first cell takes it over). */
const ITEM_ROW = 'bg-card';

/** A group's row (an account, a warehouse, a category): bold under a darker rule, with «0». */
export function GroupRow({ children }: { children: ReactNode }) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        ITEM_ROW,
        'font-semibold text-foreground [&>td]:border-t [&>td]:border-t-foreground/25 [&>td]:pt-2! print:break-after-avoid',
      )}
    >
      {children}
    </tr>
  );
}

/** «НИЙТ ДҮН»: a rule above, a double rule below (the accountant's), its label across `labelSpan`. */
export function TotalRow({ labelSpan, children }: { labelSpan: number; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <tr
      data-slot="table-row"
      className={cn(
        ITEM_ROW,
        'font-semibold text-foreground [&>td]:border-t [&>td]:border-t-foreground [&>td]:border-b-[3px]! [&>td]:border-b-foreground! [&>td]:[border-bottom-style:double] print:break-before-avoid',
      )}
    >
      <TableCell colSpan={labelSpan}>{t('reports.prompt.total')}</TableCell>
      {children}
    </tr>
  );
}

/**
 * A row that opens its detail on a click of ▸, a double click or Enter; only an open row is
 * tinted. `drillable={false}` (nothing moved in the period) is a plain row.
 */
export function DrillRow(props: {
  expanded: boolean;
  onToggle: () => void;
  drillable?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      props.onToggle();
    }
  };
  if (props.drillable === false) {
    return (
      <tr data-slot="table-row" className={cn(ITEM_ROW, props.className)}>
        {props.children}
      </tr>
    );
  }
  return (
    <tr
      data-slot="table-row"
      tabIndex={0}
      aria-expanded={props.expanded}
      onDoubleClick={props.onToggle}
      onKeyDown={onKeyDown}
      className={cn(
        ITEM_ROW,
        'cursor-default select-none hover:bg-[color-mix(in_oklab,var(--color-accent)_55%,var(--color-card))] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-expanded:bg-accent',
        props.className,
      )}
    >
      {props.children}
    </tr>
  );
}

/** A drillable row's first cell: ▸ (turning ▾ when open) then its code or number («…» when cut). */
export function DrillCell(props: {
  expanded: boolean;
  onToggle: () => void;
  text: string;
  /** What the button names when the text is empty (a row without a code). */
  name?: string;
  /** False when the row has no lines: an empty slot keeps the codes in line. */
  drillable?: boolean;
}) {
  return (
    <TableCell title={props.text || undefined}>
      <span className="flex min-w-0 items-center">
        {props.drillable === false ? (
          <span aria-hidden className="mr-1 size-5 shrink-0 print:hidden" />
        ) : (
          <DrillMark
            expanded={props.expanded}
            onToggle={props.onToggle}
            name={props.name ?? props.text}
          />
        )}
        <span className="min-w-0 truncate print:whitespace-normal">{props.text}</span>
      </span>
    </TableCell>
  );
}

/** ▸ before a drillable row's first text, turning a quarter when open: opens the row on one click. */
function DrillMark(props: { expanded: boolean; onToggle: () => void; name: string }) {
  const { t } = useTranslation();
  const label = t(props.expanded ? 'reports.prompt.closeLines' : 'reports.prompt.openLines', {
    name: props.name,
  });
  return (
    <button
      type="button"
      aria-expanded={props.expanded}
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      className="-my-0.5 mr-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring print:hidden"
    >
      <ChevronRight
        aria-hidden
        className={cn(
          'size-3.5 transition-transform duration-150 motion-reduce:transition-none',
          props.expanded && 'rotate-90',
        )}
      />
    </button>
  );
}

/** The ground of a detail row: a light tint with a blue mark at its start. */
const DETAIL_ROW =
  'bg-[color-mix(in_oklab,var(--color-muted)_45%,var(--color-card))] text-xs text-muted-foreground [&>td:first-child]:shadow-[inset_2px_0_0_var(--color-primary)]';

/** A detail row: small and lighter under the row it opened; a click opens the document behind it. */
export function DetailRow(props: { href: string | null; label: string; children: ReactNode }) {
  const navigate = useNavigate();
  const open = () => {
    if (props.href) void navigate(props.href);
  };
  return (
    <tr
      data-slot="table-row"
      role={props.href ? 'link' : undefined}
      aria-label={props.label}
      tabIndex={props.href ? 0 : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open();
      }}
      className={cn(
        DETAIL_ROW,
        props.href &&
          'group/detail cursor-pointer hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {props.children}
    </tr>
  );
}

/**
 * A detail row's label, indented under the row it opened, on one line: the document's number in
 * blue (underlined on hover), then date · type · party muted, joined with « · »; a part equal to
 * the number or to one of `omit` (the group's or the row's own name) is left out.
 */
export function DetailLabel(props: {
  number: string | null;
  parts: readonly (string | null | undefined)[];
  omit?: readonly (string | null | undefined)[];
  colSpan: number;
}) {
  const parts = detailParts(props.number, props.parts, props.omit);
  const text = detailText(props.number, parts);
  return (
    <TableCell
      colSpan={props.colSpan}
      title={text || undefined}
      className="truncate pl-8! print:overflow-visible print:whitespace-normal"
    >
      {props.number ? (
        <span className="text-primary tabular-nums group-hover/detail:underline print:text-foreground">
          {props.number}
        </span>
      ) : null}
      {parts.length > 0 ? `${props.number ? ' · ' : ''}${parts.join(' · ')}` : null}
    </TableCell>
  );
}

/** A full-width message row inside the table (nothing, too many). */
export function NoteRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr data-slot="table-row" className={ITEM_ROW}>
      <TableCell colSpan={colSpan} className="text-center whitespace-normal! text-muted-foreground">
        {children}
      </TableCell>
    </tr>
  );
}

/** The one row of an empty result: «Энэ нөхцөлд мөр алга» and «Нөхцөл өөрчлөх». */
export function EmptyRow({ colSpan, onPrompt }: { colSpan: number; onPrompt: () => void }) {
  const { t } = useTranslation();
  return (
    <TableBody>
      <tr data-slot="table-row" className={ITEM_ROW}>
        <TableCell colSpan={colSpan} className="py-6! text-center whitespace-normal!">
          <span className="text-muted-foreground">{t('reports.prompt.empty')}</span>
          <Button variant="link" size="sm" className="ml-2 h-auto px-1" onClick={onPrompt}>
            {t('reports.prompt.changeConditions')}
          </Button>
        </TableCell>
      </tr>
    </TableBody>
  );
}

/** Placeholder rows while a report loads, under its real head. */
export function SkeletonBody({ columns, rows = 8 }: { columns: number; rows?: number }) {
  return (
    <TableBody aria-hidden>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className={ITEM_ROW}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              <div
                className={cn(
                  'my-0.5 h-3 animate-pulse rounded bg-fill',
                  column === 0 ? 'w-3/4' : column === 1 ? 'w-5/6' : 'ml-auto w-1/2',
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </TableBody>
  );
}

/** Two placeholder lines under a row while its detail loads. */
export function DetailSkeleton({ colSpan }: { colSpan: number }) {
  const { t } = useTranslation();
  return (
    <>
      {['w-1/3', 'w-1/4'].map((width, index) => (
        <tr key={width} className={DETAIL_ROW}>
          <td colSpan={colSpan} className="pl-8!">
            {index === 0 ? (
              <span role="status" className="sr-only">
                {t('reports.prompt.loadingLines')}
              </span>
            ) : null}
            <div aria-hidden className={cn('my-0.5 h-2.5 animate-pulse rounded bg-fill', width)} />
          </td>
        </tr>
      ))}
    </>
  );
}
