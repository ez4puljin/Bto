import { ChevronDown, ChevronRight, Download, Printer, SlidersHorizontal, X } from 'lucide-react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Combobox, type ComboboxOption } from '@/components/combobox';
import { DialogFormFooter, FormField } from '@/components/form';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { useAuthState } from '@/app/auth-context';
import { useCompanyName } from '@/features/company/api';
import { cn } from '@/lib/utils';
import { DATE } from '../report-helpers';
import {
  BOOK_TABLE,
  type BookColumn,
  type Precision,
  PRECISIONS,
  tableMinRem,
} from './book-format';
import type { usePromptDates } from './book-state';
import { DateInput } from '@/components/date-input';

/** «Тайлан авах»: Erkhet's prompt window, two columns of conditions, the dates last. */
export function PromptDialog(props: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  valid: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (props.valid) props.onSubmit();
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{t('reports.prompt.title')}</DialogTitle>
          <DialogDescription>{props.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{props.children}</div>
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

/** «Эхний огноо» and «Эцсийн огноо». */
export function DateFields(props: ReturnType<typeof usePromptDates>) {
  const { t } = useTranslation();
  return (
    <>
      <FormField label={t('reports.prompt.from')} htmlFor="book-from">
        <DateInput
          id="book-from"
          required
          value={props.start}
          onChange={(value) => props.setStart(value)}
        />
      </FormField>
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
    </>
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
        className="h-10 w-full max-w-none justify-between rounded-lg border-input px-3 text-base font-normal md:text-sm"
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
          <Button type="button" variant="outline" onClick={props.onClear}>
            {t('reports.prompt.change')}
          </Button>
        </div>
      ) : (
        props.children
      )}
    </FormField>
  );
}

/** The report's buttons: «Нөхцөл» (the prompt), «Excel» and «Хэвлэх». */
export function BookActions(props: {
  onPrompt: () => void;
  onExcel?: () => void;
  excelPending?: boolean;
  ready: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="outline" onClick={props.onPrompt}>
        <SlidersHorizontal />
        {t('reports.prompt.conditions')}
      </Button>
      {props.onExcel ? (
        <Button
          variant="outline"
          disabled={!props.ready || props.excelPending}
          onClick={props.onExcel}
        >
          <Download />
          {t('reports.common.excel')}
        </Button>
      ) : null}
      <Button variant="outline" disabled={!props.ready} onClick={() => window.print()}>
        <Printer />
        {t('reports.prompt.print')}
      </Button>
    </>
  );
}

/**
 * A report's column (2026-11-01): the page header and the paper share one width, sized to the
 * paper's table and centred, so the buttons line up with the paper's right edge; `null` runs the
 * whole width. Paper pages are the exception to "pages sit at the left" (docs/ui.md §4).
 */
export function BookPage({ width, children }: { width: number | null; children: ReactNode }) {
  return (
    <div
      className="mx-auto w-full print:max-w-none!"
      style={width === null ? undefined : { maxWidth: `${width}rem` }}
    >
      {children}
    </div>
  );
}

/**
 * The report's paper as Erkhet draws it: the title in the middle, the company on the left with
 * its note, the period on the right «(төгрөгөөр)», the conditions, the table in one scroll box
 * with its head in view, the hint, and the lines to sign. `orientation` is the printed A4 sheet's.
 */
export function BookSheet(props: {
  title: string;
  from: string;
  to: string;
  filters: readonly string[];
  orientation: 'portrait' | 'landscape';
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const company = useCompanyName();
  const auth = useAuthState();
  const me = auth.status === 'authenticated' ? auth.me.fullName : '';
  const filters = props.filters.join(', ');
  return (
    <section className="rounded-xl bg-card px-5 py-6 shadow-card ring-1 ring-black/[0.06] md:px-8 md:py-8 2xl:px-10 print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <style media="print">{`@page{size:A4 ${props.orientation};margin:10mm 8mm}`}</style>
      <h2 className="mb-4 text-center text-[1.25rem] font-semibold tracking-tight">
        {props.title}
      </h2>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 text-[0.8125rem]">
        <div className="text-center">
          <p className="min-w-56 border-b border-foreground/70 px-4 font-semibold">{company}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('reports.prompt.companyNote')}</p>
        </div>
        <div className="text-right">
          <p className="tabular-nums">{`${props.from.replaceAll('-', '/')} - ${props.to.replaceAll('-', '/')}`}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('reports.prompt.currencyNote')}</p>
        </div>
      </div>
      {filters ? (
        <p className="mb-3 truncate text-[0.8125rem] print:whitespace-normal" title={filters}>
          <span className="text-muted-foreground">{t('reports.prompt.filters')}</span> {filters}
        </p>
      ) : null}
      <div className="max-h-[calc(100dvh-10rem)] overflow-auto print:max-h-none print:overflow-visible">
        {props.children}
      </div>
      <p className="mt-2 text-xs text-muted-foreground print:hidden">
        {t('reports.prompt.drillHint')}
      </p>
      {props.footer}
      <div className="mt-10 grid gap-3 pl-[15%] text-[0.8125rem] break-inside-avoid">
        <p>{t('reports.prompt.preparedBy', { name: me })}</p>
        <p>{t('reports.prompt.reviewedBy')}</p>
      </div>
    </section>
  );
}

/**
 * The paper's table without the shadcn wrapper's own scroll box (the sheet holds the one box, so
 * the head sticks): fixed columns from `columns`, never narrower than their least widths.
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
      className={cn(BOOK_TABLE, 'print:min-w-0!')}
      style={{ minWidth: `${tableMinRem(columns)}rem` }}
    >
      <colgroup>
        {columns.map((column, index) => (
          <col
            key={index}
            style={typeof column === 'number' ? { width: `${column}rem` } : undefined}
          />
        ))}
      </colgroup>
      {children}
    </table>
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

/** A group's row (an account, a warehouse, a category): its sums with «0». */
export function GroupRow({ children }: { children: ReactNode }) {
  return <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">{children}</TableRow>;
}

/** «НИЙТ ДҮН»: a heavier rule above, its label on the left across `labelSpan` columns. */
export function TotalRow({ labelSpan, children }: { labelSpan: number; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60 [&>td]:border-t-2 [&>td]:border-t-foreground/70!">
      <TableCell colSpan={labelSpan}>{t('reports.prompt.total')}</TableCell>
      {children}
    </TableRow>
  );
}

/** A row that opens its detail on a click of ▸, a double click or Enter. */
export function DrillRow(props: {
  expanded: boolean;
  onToggle: () => void;
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
  return (
    <TableRow
      tabIndex={0}
      aria-expanded={props.expanded}
      onDoubleClick={props.onToggle}
      onKeyDown={onKeyDown}
      className={cn(
        'cursor-default select-none hover:bg-accent/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        props.className,
      )}
    >
      {props.children}
    </TableRow>
  );
}

/** A drillable row's first cell: ▸ / ▾ then its code or number on one line («…» when cut). */
export function DrillCell(props: {
  expanded: boolean;
  onToggle: () => void;
  text: string;
  /** What the button names when the text is empty (a row without a code). */
  name?: string;
}) {
  return (
    <TableCell title={props.text || undefined}>
      <span className="flex min-w-0 items-center">
        <DrillMark
          expanded={props.expanded}
          onToggle={props.onToggle}
          name={props.name ?? props.text}
        />
        <span className="min-w-0 truncate print:whitespace-normal">{props.text}</span>
      </span>
    </TableCell>
  );
}

/** ▸ / ▾ before a drillable row's first text: a button opening the row on one click. */
function DrillMark(props: { expanded: boolean; onToggle: () => void; name: string }) {
  const { t } = useTranslation();
  const Icon = props.expanded ? ChevronDown : ChevronRight;
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
      <Icon aria-hidden className="size-3.5" />
    </button>
  );
}

/** A detail row: small, italic and lighter, like Erkhet's; a click opens the document behind it. */
export function DetailRow(props: { href: string | null; label: string; children: ReactNode }) {
  const navigate = useNavigate();
  const open = () => {
    if (props.href) void navigate(props.href);
  };
  return (
    <TableRow
      role={props.href ? 'link' : undefined}
      aria-label={props.label}
      tabIndex={props.href ? 0 : undefined}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter') open();
      }}
      className={cn(
        'text-xs text-muted-foreground italic hover:bg-transparent [&>td]:border-border/60!',
        props.href &&
          'cursor-pointer hover:bg-accent/60 hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
      )}
    >
      {props.children}
    </TableRow>
  );
}

/** A detail row's label: left, indented under the row it opened, on one line. */
export function DetailLabel(props: { text: string; colSpan: number }) {
  return <TextCell text={props.text} colSpan={props.colSpan} className="pl-8!" />;
}

/** A full-width message row inside the table (loading, nothing, too many). */
export function NoteRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className="text-center whitespace-normal! text-muted-foreground italic"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}
