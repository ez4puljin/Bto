import { Download, Printer, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { TableCell } from '@/components/ui/table';
import { formatMnt } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useRefreshReports, useRefreshState } from './api';
import { NONE, refreshedText } from './report-helpers';

/** «Шинэчлэгдсэн 14:05» and «Шинэчлэх»: rebuilds the daily totals, then every report refetches. */
export function RefreshControl() {
  const { t } = useTranslation();
  const state = useRefreshState();
  const refresh = useRefreshReports();
  const at = refresh.data?.refreshedAt ?? state.data?.refreshedAt ?? null;
  return (
    <>
      {state.data || refresh.data ? (
        <span className="text-[0.8125rem] text-muted-foreground">
          {at
            ? t('reports.common.refreshedAt', { time: refreshedText(at) })
            : t('reports.common.neverRefreshed')}
        </span>
      ) : null}
      <Button variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate()}>
        <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} />
        {t('reports.common.refresh')}
      </Button>
    </>
  );
}

/** «Excel»: downloads the report as it is filtered. */
export function ExcelButton(props: { disabled?: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" disabled={props.disabled} onClick={props.onClick}>
      <Download />
      {t('reports.common.excel')}
    </Button>
  );
}

/** «Хэвлэх»: the report's paper in a new tab. */
export function PrintLink(props: { to: string }) {
  const { t } = useTranslation();
  return (
    <Button asChild variant="outline">
      <Link to={props.to} target="_blank">
        <Printer />
        {t('reports.common.print')}
      </Link>
    </Button>
  );
}

/** A count or amount over a report's table. */
export function SummaryTile(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'warning' | 'destructive';
}) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]">
      <p className="text-[0.8125rem] text-muted-foreground">{props.label}</p>
      <p
        className={cn(
          'font-mono text-[1.125rem] font-semibold',
          props.tone === 'warning' && 'text-warning',
          props.tone === 'destructive' && 'text-destructive',
        )}
      >
        {props.value}
      </p>
      {props.hint ? <p className="text-[0.75rem] text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

/** A right-aligned amount cell (journal style, no sign). */
export function AmountCell(props: { value: string | null; className?: string }) {
  return (
    <TableCell className={cn('text-right font-mono whitespace-nowrap', props.className)}>
      {props.value === null ? NONE : formatMnt(props.value)}
    </TableCell>
  );
}

/** The company name and the report's title on paper. */
export function PrintHeading(props: { company: string; title: string; note?: string }) {
  return (
    <div>
      <p className="text-[0.8125rem] font-semibold">{props.company}</p>
      <h1 className="text-[1rem] font-semibold">{props.title}</h1>
      {props.note ? <p className="text-[0.75rem]">{props.note}</p> : null}
    </div>
  );
}
