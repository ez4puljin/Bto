import { Decimal } from '@tugeel/shared/money';
import { Link2, Unlink } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SupplierSelect } from '@/features/partners/party-select';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type EbarimtEntry,
  type EbarimtHistoryEvent,
  type EbarimtRow,
  useEbarimtEntries,
  useEbarimtMutations,
  useEbarimtReceipts,
} from './api';
import { amountText, usePeriodLabels } from './helpers';
import { DiffValue, Stat } from './parts';

const sum = (values: readonly string[]) =>
  values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed(2);

/** A long table in a dialog keeps its head and its totals in view. */
const SCROLLER =
  'min-h-0 flex-1 overflow-auto [&_[data-slot=table-container]]:overflow-visible [&_[data-slot=table-head]]:sticky [&_[data-slot=table-head]]:top-0 [&_[data-slot=table-head]]:z-10 [&_[data-slot=table-head]]:bg-popover';
const STUCK_FOOT = 'sticky bottom-0 bg-popover';

function RowStats({ row }: { row: EbarimtRow }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <Stat label={t('ebarimtCheck.stats.purchase')}>{amountText(row.purchaseAmount)}</Stat>
      <Stat label={t('ebarimtCheck.stats.ebarimt')} className="text-link">
        {amountText(row.ebarimtAmount)}
      </Stat>
      {new Decimal(row.exemptAmount).isZero() ? null : (
        <Stat label={t('ebarimtCheck.stats.exempt')} className="text-warning">
          {amountText(row.exemptAmount)}
        </Stat>
      )}
      <Stat label={t('ebarimtCheck.stats.diff')}>
        <DiffValue value={row.diffAmount} />
      </Stat>
    </div>
  );
}

/** In a consolidated view: which month the difference came from. */
function PerMonthTable({ row, baseYear }: { row: EbarimtRow; baseYear: number }) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(baseYear);
  if (row.byPeriod.length < 2) return null;
  const hasExempt = row.byPeriod.some((month) => !new Decimal(month.exemptAmount).isZero());
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">
              {t('ebarimtCheck.receipts.columns.month')}
            </th>
            {row.byPeriod.map((month) => (
              <th key={month.period} className="px-2 py-1 text-right font-medium whitespace-nowrap">
                {labels.name(month.period)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          <tr>
            <td className="px-2 py-1 font-sans text-muted-foreground">
              {t('ebarimtCheck.stats.purchase')}
            </td>
            {row.byPeriod.map((month) => (
              <td key={month.period} className="px-2 py-1 text-right">
                {amountText(month.purchaseAmount)}
              </td>
            ))}
          </tr>
          <tr>
            <td className="px-2 py-1 font-sans text-muted-foreground">
              {t('ebarimtCheck.stats.ebarimt')}
            </td>
            {row.byPeriod.map((month) => (
              <td key={month.period} className="px-2 py-1 text-right">
                {amountText(month.ebarimtAmount)}
              </td>
            ))}
          </tr>
          {hasExempt ? (
            <tr>
              <td className="px-2 py-1 font-sans text-muted-foreground">
                {t('ebarimtCheck.stats.exempt')}
              </td>
              {row.byPeriod.map((month) => (
                <td key={month.period} className="px-2 py-1 text-right text-warning">
                  {amountText(month.exemptAmount)}
                </td>
              ))}
            </tr>
          ) : null}
          <tr>
            <td className="px-2 py-1 font-sans text-muted-foreground">
              {t('ebarimtCheck.stats.diff')}
            </td>
            {row.byPeriod.map((month) => (
              <td key={month.period} className="px-2 py-1 text-right">
                <DiffValue
                  value={new Decimal(month.purchaseAmount)
                    .minus(month.ebarimtAmount)
                    .minus(month.exemptAmount)
                    .toFixed(2)}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/**
 * A supplier's purchases: the receipts behind the figure in brief, each opening the receipt itself.
 * A receipt on an account the settings leave out shows too, marked, so the figure explains itself.
 */
export function ReceiptsDialog(props: {
  row: EbarimtRow;
  periods: readonly number[];
  baseYear: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(props.baseYear);
  const receipts = useEbarimtReceipts(props.periods, props.row.supplierId);
  const rows = receipts.data?.data ?? [];
  const counted = rows.filter((row) => row.counted);
  const multi = props.periods.length > 1;
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="2xl" guard={false} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            {props.row.name} · {t('ebarimtCheck.receipts.title')}
          </DialogTitle>
          <DialogDescription>
            {t('ebarimtCheck.receipts.subtitle', {
              code: props.row.code,
              periods: labels.many(props.periods),
            })}
          </DialogDescription>
        </DialogHeader>
        <RowStats row={props.row} />
        <PerMonthTable row={props.row} baseYear={props.baseYear} />
        <ProblemAlert problem={problemFromError(receipts.error)} onRetry={receipts.refetch} />
        <div className={SCROLLER}>
          {receipts.isPending ? (
            <p className="py-6 text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 && !receipts.isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('ebarimtCheck.receipts.empty')}
            </p>
          ) : rows.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  {multi ? <TableHead>{t('ebarimtCheck.receipts.columns.month')}</TableHead> : null}
                  <TableHead>{t('ebarimtCheck.receipts.columns.date')}</TableHead>
                  <TableHead>{t('ebarimtCheck.receipts.columns.number')}</TableHead>
                  <TableHead>{t('ebarimtCheck.receipts.columns.deliveryNote')}</TableHead>
                  <TableHead>{t('ebarimtCheck.receipts.columns.note')}</TableHead>
                  <TableHead>{t('ebarimtCheck.receipts.columns.warehouses')}</TableHead>
                  <TableHead>{t('ebarimtCheck.receipts.columns.account')}</TableHead>
                  <TableHead className="text-right">
                    {t('ebarimtCheck.receipts.columns.lines')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('ebarimtCheck.receipts.columns.amount')}
                  </TableHead>
                  <TableHead>{t('ebarimtCheck.receipts.columns.createdBy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(!row.counted && 'text-muted-foreground')}>
                    {multi ? <TableCell>{labels.name(row.period)}</TableCell> : null}
                    <TableCell className="whitespace-nowrap">{row.day}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        to={`/inventory/receipts/${row.id}`}
                        className="font-mono font-medium text-link hover:underline"
                        aria-label={t('ebarimtCheck.receipts.open', {
                          number: row.number ?? row.id,
                        })}
                      >
                        {row.number ?? row.id}
                      </Link>
                      {row.pricePending ? (
                        <Badge variant="warning" className="ml-2">
                          {t('ebarimtCheck.receipts.pricePending')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono">{row.supplierDocNo ?? '—'}</TableCell>
                    <TableCell className="max-w-48 truncate" title={row.note ?? undefined}>
                      {row.note ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-48 truncate" title={row.warehouses || undefined}>
                      {row.warehouses || '—'}
                    </TableCell>
                    <TableCell title={row.accountName ?? undefined}>
                      <span className="font-mono">{row.accountCode ?? '—'}</span>
                      {row.counted ? null : (
                        <Badge
                          variant="outline"
                          className="ml-2"
                          title={t('ebarimtCheck.receipts.notCountedHint')}
                        >
                          {t('ebarimtCheck.receipts.notCounted')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCount(row.lineCount)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {row.amount === null ? '—' : formatMnt(row.amount)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.createdByName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className={STUCK_FOOT}>
                <TableRow>
                  <TableCell colSpan={multi ? 7 : 6} className="font-medium">
                    {t('ebarimtCheck.receipts.total', { count: counted.length })}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCount(counted.reduce((total, row) => total + row.lineCount, 0))}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatMnt(sum(counted.flatMap((row) => row.amount ?? [])))}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A supplier chosen for a receipt. An inactive one counts too: it stays on the list while it has
 * figures. Only rows of what is typed now can be taken, and nothing while a link is being written.
 */
function LinkPicker(props: {
  label: string;
  disabled: boolean;
  onPick: (supplierId: number) => void;
}) {
  const id = useId();
  return (
    <fieldset disabled={props.disabled} className="contents">
      <label htmlFor={id} className="sr-only">
        {props.label}
      </label>
      <SupplierSelect
        id={id}
        value={null}
        includeInactive
        freshOnly
        onChange={(supplier) => {
          if (supplier) props.onPick(supplier.id);
        }}
      />
    </fieldset>
  );
}

/**
 * e-Barimt's lines behind a figure, a supplier's or one register's. A line of a register no supplier
 * holds can be counted for a chosen supplier, one by one or all at once.
 */
export function EntriesDialog(props: {
  row?: EbarimtRow;
  ttd?: { ttd: string; name: string };
  periods: readonly number[];
  baseYear: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(props.baseYear);
  const canEdit = useHasPermission('ebarimt.check.edit');
  const entries = useEbarimtEntries(
    props.periods,
    props.row ? { supplierId: props.row.supplierId } : { ttd: props.ttd?.ttd ?? '' },
  );
  const mutations = useEbarimtMutations();
  const action = useAction();
  const rows = entries.data?.rows ?? [];
  const unlinked = rows.filter((row) => !row.link);
  const showLinks = !props.row || rows.some((row) => row.link);

  /** Links go month by month: a link belongs to its month. A receipt taken meanwhile is said. */
  const setLink = (items: readonly EbarimtEntry[], supplierId: number | null) => {
    let linked = 0;
    let skipped = 0;
    void action
      .run(async () => {
        const periods = new Map<number, string[]>();
        for (const item of items) {
          periods.set(item.period, [...(periods.get(item.period) ?? []), item.receiptKey]);
        }
        for (const [period, receiptKeys] of periods) {
          const result = await mutations.link.mutateAsync({ period, receiptKeys, supplierId });
          linked += result.linked;
          skipped += result.skipped;
        }
      })
      .then((done) => {
        if (!done) return;
        if (supplierId === null) toast.success(t('ebarimtCheck.entries.unlinkedDone'));
        else if (skipped === 0)
          toast.success(t('ebarimtCheck.entries.linkedDone', { count: linked }));
        else toast.warning(t('ebarimtCheck.entries.linkedPartly', { linked, skipped }));
      });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="2xl" guard={false} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            {props.row
              ? `${props.row.name} · ${t('ebarimtCheck.entries.title')}`
              : `${props.ttd?.name || ''} ${t('ebarimtCheck.entries.titleTtd', { ttd: props.ttd?.ttd })}`}
          </DialogTitle>
          <DialogDescription>
            {t('ebarimtCheck.entries.subtitle', { periods: labels.many(props.periods) })}
            {entries.data?.registers.length
              ? ` · ${t('ebarimtCheck.entries.registers', { registers: entries.data.registers.join(', ') })}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {props.row ? (
          <>
            <RowStats row={props.row} />
            <PerMonthTable row={props.row} baseYear={props.baseYear} />
          </>
        ) : canEdit ? (
          <p className="text-[0.8125rem] text-warning">
            {t('ebarimtCheck.entries.unregisteredHint')}
          </p>
        ) : null}
        {!props.row && canEdit && unlinked.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-[0.8125rem]">
            <span>{t('ebarimtCheck.entries.bulkLink', { count: unlinked.length })}</span>
            <div className="w-72">
              <LinkPicker
                label={t('ebarimtCheck.entries.bulkLink', { count: unlinked.length })}
                disabled={mutations.link.isPending}
                onPick={(supplierId) => setLink(unlinked, supplierId)}
              />
            </div>
          </div>
        ) : null}
        <ProblemAlert problem={action.problem} />
        <ProblemAlert problem={problemFromError(entries.error)} onRetry={entries.refetch} />
        <div className={SCROLLER}>
          {entries.isPending ? (
            <p className="py-6 text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : rows.length === 0 && !entries.isError ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {props.row && entries.data?.registers.length === 0
                ? canEdit
                  ? t('ebarimtCheck.entries.noRegisters')
                  : t('ebarimtCheck.entries.noRegistersRead')
                : t('ebarimtCheck.entries.empty')}
            </p>
          ) : rows.length === 0 ? null : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('ebarimtCheck.entries.columns.deliveryNote')}</TableHead>
                  <TableHead>{t('ebarimtCheck.entries.columns.ddtd')}</TableHead>
                  <TableHead>{t('ebarimtCheck.entries.columns.date')}</TableHead>
                  <TableHead>{t('ebarimtCheck.entries.columns.partner')}</TableHead>
                  <TableHead>{t('ebarimtCheck.entries.columns.ttd')}</TableHead>
                  <TableHead className="text-right">
                    {t('ebarimtCheck.entries.columns.vat')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('ebarimtCheck.entries.columns.net')}
                  </TableHead>
                  <TableHead className="text-right">
                    {t('ebarimtCheck.entries.columns.total')}
                  </TableHead>
                  <TableHead>{t('ebarimtCheck.entries.columns.kind')}</TableHead>
                  {showLinks ? (
                    <TableHead>{t('ebarimtCheck.entries.columns.link')}</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={`${row.period}:${row.receiptKey}:${row.docDate}:${row.totalAmount}`}
                  >
                    <TableCell className="font-mono">{row.deliveryNoteNo ?? '—'}</TableCell>
                    <TableCell className="max-w-44 font-mono text-xs break-all whitespace-normal text-muted-foreground">
                      {row.ddtd ?? '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{row.docDate}</TableCell>
                    <TableCell className="max-w-40 truncate" title={row.partnerName ?? undefined}>
                      {row.partnerName ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono">{row.ttd}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatMnt(row.vatAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatMnt(row.netAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-medium">
                      {formatMnt(row.totalAmount)}
                    </TableCell>
                    <TableCell>{row.kind ?? '—'}</TableCell>
                    {showLinks ? (
                      <TableCell className="min-w-44 whitespace-nowrap">
                        {row.link ? (
                          <div className="flex items-center gap-1">
                            <Link2 aria-hidden className="size-3.5 shrink-0 text-warning" />
                            <span
                              className="truncate font-medium"
                              title={[row.link.createdByName, formatUbMinute(row.link.createdAt)]
                                .filter(Boolean)
                                .join(' · ')}
                            >
                              {props.row
                                ? t('ebarimtCheck.entries.linkedTtd', { ttd: row.ttd })
                                : `${row.link.supplierCode} · ${row.link.supplierName}`}
                            </span>
                            {canEdit ? (
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                aria-label={t('ebarimtCheck.entries.unlink', {
                                  note: row.deliveryNoteNo ?? row.ddtd ?? row.ttd,
                                })}
                                title={t('ebarimtCheck.entries.unlink', {
                                  note: row.deliveryNoteNo ?? row.ddtd ?? row.ttd,
                                })}
                                disabled={mutations.link.isPending}
                                onClick={() => setLink([row], null)}
                              >
                                <Unlink />
                              </Button>
                            ) : null}
                          </div>
                        ) : !props.row && canEdit ? (
                          <LinkPicker
                            label={t('ebarimtCheck.entries.linkPick', {
                              note: row.deliveryNoteNo ?? row.ddtd ?? row.ttd,
                            })}
                            disabled={mutations.link.isPending}
                            onPick={(supplierId) => setLink([row], supplierId)}
                          />
                        ) : (
                          '—'
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter className={STUCK_FOOT}>
                <TableRow>
                  <TableCell colSpan={5} className="font-medium">
                    {t('ebarimtCheck.entries.total', { count: rows.length })}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatMnt(sum(rows.map((row) => row.vatAmount)))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatMnt(sum(rows.map((row) => row.netAmount)))}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatMnt(sum(rows.map((row) => row.totalAmount)))}
                  </TableCell>
                  <TableCell colSpan={showLinks ? 2 : 1} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
          {entries.data?.noFile.length ? (
            <p className="mt-2 text-[0.8125rem] text-warning">
              {t('ebarimtCheck.entries.noFile', { months: labels.many(entries.data.noFile) })}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** How a supplier's values changed, month by month. */
export function HistoryDialog(props: { row: EbarimtRow; baseYear: number; onClose: () => void }) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(props.baseYear);
  const value = (event: EbarimtHistoryEvent) =>
    event.field === 'EMPLOYEE' ? (event.userName ?? '—') : formatMnt(event.amount ?? '0');
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="lg" guard={false} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>
            {props.row.name} · {t('ebarimtCheck.history.title')}
          </DialogTitle>
        </DialogHeader>
        <div className={SCROLLER}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ebarimtCheck.history.columns.month')}</TableHead>
                <TableHead>{t('ebarimtCheck.history.columns.field')}</TableHead>
                <TableHead className="text-right">
                  {t('ebarimtCheck.history.columns.value')}
                </TableHead>
                <TableHead>{t('ebarimtCheck.history.columns.why')}</TableHead>
                <TableHead>{t('ebarimtCheck.history.columns.source')}</TableHead>
                <TableHead>{t('ebarimtCheck.history.columns.who')}</TableHead>
                <TableHead>{t('ebarimtCheck.history.columns.when')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.row.history.map((event, index) => (
                <TableRow key={index}>
                  <TableCell className="whitespace-nowrap">{labels.name(event.period)}</TableCell>
                  <TableCell>{t(`ebarimtCheck.history.fields.${event.field}`)}</TableCell>
                  <TableCell className="text-right font-mono">{value(event)}</TableCell>
                  <TableCell>{t(`ebarimtCheck.history.kinds.${event.kind}`)}</TableCell>
                  <TableCell className="max-w-48 truncate" title={event.source ?? undefined}>
                    {event.source ?? '—'}
                  </TableCell>
                  <TableCell>{event.changedByName ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatUbMinute(event.changedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
