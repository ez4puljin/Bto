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
import { type Precision, PRECISIONS } from './book-format';
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
          <div className="grid max-h-[65vh] gap-4 overflow-y-auto p-0.5 sm:grid-cols-2">
            {props.children}
          </div>
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
      <span className="text-sm font-medium">{props.label}</span>
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
        className="h-10 w-full max-w-none justify-between rounded-lg px-3 text-sm font-normal"
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
 * The report's paper as Erkhet draws it: the title in the middle, the company on the left with
 * its note, the period on the right «(төгрөгөөр)», the conditions, the table, and the lines to sign.
 */
export function BookSheet(props: {
  title: string;
  from: string;
  to: string;
  filters: readonly string[];
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const company = useCompanyName();
  const auth = useAuthState();
  const me = auth.status === 'authenticated' ? auth.me.fullName : '';
  return (
    <section className="rounded-xl bg-card px-4 py-6 shadow-card ring-1 ring-black/[0.06] sm:px-8 print:p-0 print:shadow-none print:ring-0">
      <h2 className="mb-5 text-center text-[1.375rem] font-semibold">{props.title}</h2>
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3 text-[0.8125rem]">
        <div className="text-center">
          <p className="min-w-56 border-b border-foreground px-4 font-semibold">{company}</p>
          <p className="text-[0.75rem] text-muted-foreground">{t('reports.prompt.companyNote')}</p>
        </div>
        <div className="text-right">
          <p>{`${props.from.replaceAll('-', '/')} - ${props.to.replaceAll('-', '/')}`}</p>
          <p className="text-[0.75rem] text-muted-foreground">{t('reports.prompt.currencyNote')}</p>
        </div>
      </div>
      {props.filters.length > 0 ? (
        <p className="mb-2 text-[0.8125rem]">
          <span className="text-muted-foreground">{t('reports.prompt.filters')}</span>{' '}
          {props.filters.join(', ')}
        </p>
      ) : null}
      <p className="mb-2 text-[0.75rem] text-muted-foreground print:hidden">
        {t('reports.prompt.drillHint')}
      </p>
      <div className="overflow-x-auto">{props.children}</div>
      {props.footer}
      <div className="mt-8 flex flex-col gap-3 pl-[15%] text-[0.8125rem]">
        <p>{t('reports.prompt.preparedBy', { name: me })}</p>
        <p>{t('reports.prompt.reviewedBy')}</p>
      </div>
    </section>
  );
}

/** A row that opens its detail on a double click (or Enter), with ▸ / ▾ in front. */
export function DrillRow(props: {
  expanded: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
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
      className={cn('cursor-default select-none hover:bg-accent/60', props.className)}
    >
      {props.children}
    </TableRow>
  );
}

/** ▸ / ▾ before a drillable row's first text. */
export function DrillMark({ expanded }: { expanded: boolean }) {
  const Icon = expanded ? ChevronDown : ChevronRight;
  return <Icon aria-hidden className="mr-1 inline size-3.5 text-muted-foreground print:hidden" />;
}

/** A detail row: italic like Erkhet's; a click opens the document behind it. */
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
        'text-muted-foreground italic',
        props.href && 'cursor-pointer hover:bg-accent/60 hover:text-foreground',
      )}
    >
      {props.children}
    </TableRow>
  );
}

/** A full-width message row inside the table (loading, nothing, too many). */
export function NoteRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-center text-muted-foreground italic">
        {children}
      </TableCell>
    </TableRow>
  );
}
