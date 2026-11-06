import type { ProblemDetails } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { matchesQuery, queryTerms, searchKeys } from '@tugeel/shared/text';
import { Download, FileWarning, Link2, Trash2, Unlink, Upload } from 'lucide-react';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { SearchField, SegmentedControl } from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useUserLookup } from '@/features/inventory/api';
import { formatUbMinute } from '@/lib/dayjs';
import { saveBlob } from '@/lib/download';
import { formatCount, formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type EbarimtLink,
  type EbarimtMonth,
  type EbarimtUnregistered,
  useEbarimtFiles,
  useEbarimtMutations,
  useEbarimtSettings,
} from './api';
import { FOCUS_RING, usePeriodLabels } from './helpers';

/** Each month's file: uploaded here to the month its dates fall in; a new one replaces the old. */
export function FilesDialog(props: { year: number; onClose: () => void }) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(props.year);
  const canEdit = useHasPermission('ebarimt.check.edit');
  const canRemove = useHasPermission('ebarimt.check.settings');
  const files = useEbarimtFiles(props.year);
  const mutations = useEbarimtMutations();
  const action = useAction();
  const removal = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<EbarimtMonth | null>(null);
  const [refused, setRefused] = useState<{ name: string; problem: ProblemDetails | null }[]>([]);
  const [uploading, setUploading] = useState(false);
  const months = files.data?.months ?? [];

  /** Every chosen file is tried: one refused says so by name, and the rest still go in. */
  const upload = async (chosen: FileList | null) => {
    if (!chosen?.length) return;
    const list = [...chosen];
    if (input.current) input.current.value = '';
    setRefused([]);
    setUploading(true);
    const failures: { name: string; problem: ProblemDetails | null }[] = [];
    for (const file of list) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        failures.push({ name: file.name, problem: null });
        continue;
      }
      try {
        const result = await mutations.importFile.mutateAsync({ file, key: randomUuid() });
        const month = labels.name(result.period);
        toast.success(
          result.replacedRowCount === null
            ? t('ebarimtCheck.files.imported', { month, count: result.rowCount })
            : t('ebarimtCheck.files.replaced', {
                month,
                before: result.replacedRowCount,
                count: result.rowCount,
              }),
        );
      } catch (error) {
        failures.push({ name: file.name, problem: problemFromError(error) });
      }
    }
    setRefused(failures);
    setUploading(false);
  };

  const download = (month: EbarimtMonth) => {
    const file = month.file;
    if (!file) return;
    void action.run(async () => {
      saveBlob(await mutations.download.mutateAsync(file.id), file.fileName);
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !uploading && props.onClose()}>
      <DialogContent size="xl" guard={false} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('ebarimtCheck.files.title')}</DialogTitle>
          <DialogDescription>{t('ebarimtCheck.files.description')}</DialogDescription>
        </DialogHeader>
        {canEdit ? (
          <div>
            <input
              ref={input}
              type="file"
              multiple
              accept=".xlsx"
              aria-label={t('ebarimtCheck.files.pick')}
              className="hidden"
              onChange={(event) => void upload(event.target.files)}
            />
            <Button pending={uploading} onClick={() => input.current?.click()}>
              <Upload />
              {t('ebarimtCheck.files.upload')}
            </Button>
          </div>
        ) : null}
        {refused.map((failure) => (
          <div key={failure.name} role="alert" className="flex flex-col gap-1">
            <p className="text-[0.8125rem] font-medium text-destructive">
              {t('ebarimtCheck.files.failed', { name: failure.name })}
              {failure.problem ? '' : ` ${t('ebarimtCheck.files.wrongType')}`}
            </p>
            <ProblemAlert problem={failure.problem} />
          </div>
        ))}
        <ProblemAlert problem={action.problem} />
        <ProblemAlert problem={problemFromError(files.error)} onRetry={files.refetch} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ebarimtCheck.files.columns.month')}</TableHead>
                <TableHead>{t('ebarimtCheck.files.columns.file')}</TableHead>
                <TableHead className="text-right">{t('ebarimtCheck.files.columns.rows')}</TableHead>
                <TableHead className="text-right">
                  {t('ebarimtCheck.files.columns.total')}
                </TableHead>
                <TableHead>{t('ebarimtCheck.files.columns.uploaded')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((month) => {
                const name = labels.name(month.period);
                return (
                  <TableRow key={month.period}>
                    <TableCell className="whitespace-nowrap font-medium">{name}</TableCell>
                    {month.file ? (
                      <>
                        <TableCell className="max-w-48 truncate" title={month.file.fileName}>
                          {month.file.fileName}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatCount(month.file.rowCount)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatMnt(month.file.totalAmount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-[0.8125rem] text-muted-foreground">
                          {[month.file.uploadedByName, formatUbMinute(month.file.uploadedAt)]
                            .filter(Boolean)
                            .join(' · ')}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t('ebarimtCheck.files.download', { month: name })}
                            title={t('ebarimtCheck.files.download', { month: name })}
                            onClick={() => download(month)}
                          >
                            <Download />
                          </Button>
                          {canRemove ? (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={t('ebarimtCheck.files.remove', { month: name })}
                              title={t('ebarimtCheck.files.remove', { month: name })}
                              onClick={() => {
                                removal.clear();
                                setRemoving(month);
                              }}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={5}>
                        <Badge variant="secondary">{t('ebarimtCheck.files.none')}</Badge>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {removing ? (
          <ConfirmDialog
            open
            variant="destructive"
            title={t('ebarimtCheck.files.removeTitle', { month: labels.name(removing.period) })}
            description={t('ebarimtCheck.files.removeText')}
            confirmLabel={t('ebarimtCheck.files.removeConfirm')}
            pending={mutations.removeFile.isPending}
            problem={removal.problem}
            onClose={() => setRemoving(null)}
            onConfirm={() =>
              void removal
                .run(() => mutations.removeFile.mutateAsync(removing.period))
                .then((done) => {
                  if (!done) return;
                  setRemoving(null);
                  toast.success(t('ebarimtCheck.files.removed'));
                })
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Which accounts' receipts count as the month's purchases. */
export function SettingsDialog(props: { onClose: () => void }) {
  const { t } = useTranslation();
  const canSave = useHasPermission('ebarimt.check.settings');
  const settings = useEbarimtSettings();
  const mutations = useEbarimtMutations();
  const action = useAction();
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const accounts = useMemo(() => settings.data?.accounts ?? [], [settings.data]);
  const current = useMemo(
    () => chosen ?? new Set(accounts.filter((row) => row.counted).map((row) => row.code)),
    [accounts, chosen],
  );
  const counted = accounts.filter((row) => row.counted);
  const changed =
    chosen !== null &&
    (chosen.size !== counted.length || counted.some((row) => !chosen.has(row.code)));
  const toggle = (code: string, on: boolean) => {
    const next = new Set(current);
    if (on) next.add(code);
    else next.delete(code);
    setChosen(next);
  };
  const save = () =>
    void action
      .run(() => mutations.saveSettings.mutateAsync([...current]))
      .then((done) => {
        if (!done) return;
        toast.success(t('ebarimtCheck.settings.saved'));
        props.onClose();
      });
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="md" dirty={changed} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle>{t('ebarimtCheck.settings.title')}</DialogTitle>
          <DialogDescription>{t('ebarimtCheck.settings.accountsHint')}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        <ProblemAlert problem={problemFromError(settings.error)} onRetry={settings.refetch} />
        {settings.isPending ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {settings.isSuccess ? (
          <div
            role="group"
            aria-label={t('ebarimtCheck.settings.accounts')}
            className="min-h-0 flex-1 overflow-auto rounded-lg border border-border"
          >
            {accounts.map((account) => (
              <label
                key={account.code}
                className={cn(
                  'flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-accent',
                  !canSave && 'cursor-default',
                )}
              >
                <Checkbox
                  disabled={!canSave}
                  checked={current.has(account.code)}
                  onCheckedChange={(checked) => toggle(account.code, checked === true)}
                />
                <span className="font-mono">{account.code}</span>
                <span className="min-w-0 flex-1 truncate">{account.name}</span>
                {account.isDefault ? (
                  <Badge variant="secondary">{t('ebarimtCheck.settings.default')}</Badge>
                ) : null}
              </label>
            ))}
          </div>
        ) : null}
        {canSave ? (
          <>
            {settings.isSuccess && current.size === 0 ? (
              <p className="text-[0.8125rem] text-destructive">
                {t('ebarimtCheck.settings.atLeastOne')}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="ghost" onClick={props.onClose}>
                {t('common.cancel')}
              </Button>
              <Button
                disabled={!settings.isSuccess || current.size === 0}
                pending={mutations.saveSettings.isPending}
                onClick={save}
              >
                {t('common.save')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('ebarimtCheck.settings.readOnly')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Suppliers given to another employee on this page, one or many: this month and those after it.
 * The supplier's own orderer on its page stays.
 */
export function AssignDialog(props: {
  period: number;
  year: number;
  suppliers: readonly { id: number; name: string }[];
  /** The employee of a single supplier, to show. */
  currentName?: string | null;
  ordererName?: string | null;
  /** Of the suppliers, how many the filters hide right now. */
  hiddenCount?: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(props.year);
  const mutations = useEbarimtMutations();
  const action = useAction();
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<{ id: number; name: string } | null>(null);
  const [sending, setSending] = useState<'choice' | 'revert' | null>(null);
  const q = useDeferredValue(search.trim());
  const found = useUserLookup(q, true);
  const rows = found.data ?? [];
  const month = labels.name(props.period);
  const single = props.suppliers.length === 1 ? props.suppliers[0] : null;
  const send = (userId: number | null) => {
    setSending(userId === null ? 'revert' : 'choice');
    void action
      .run(async () => {
        const result = await mutations.assign.mutateAsync({
          period: props.period,
          supplierIds: props.suppliers.map((supplier) => supplier.id),
          userId,
        });
        toast.success(
          result.changed === 0
            ? t('ebarimtCheck.assign.unchanged')
            : t('ebarimtCheck.assign.saved', { month, count: result.changed }),
        );
      })
      .then((done) => {
        setSending(null);
        if (done) props.onDone();
      });
  };
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="sm" dirty={chosen !== null}>
        <DialogHeader>
          <DialogTitle>
            {single
              ? `${single.name}: ${t('ebarimtCheck.assign.title')}`
              : t('ebarimtCheck.assign.titleMany', { count: props.suppliers.length })}
          </DialogTitle>
          <DialogDescription>{t('ebarimtCheck.assign.hint', { month })}</DialogDescription>
        </DialogHeader>
        <ProblemAlert problem={action.problem} />
        {props.hiddenCount ? (
          <p className="text-[0.8125rem] font-medium text-warning">
            {t('ebarimtCheck.filters.hiddenTicked', { count: props.hiddenCount })}
          </p>
        ) : null}
        {single ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {props.ordererName
              ? t('ebarimtCheck.cells.employeeOrderer', { name: props.ordererName })
              : t('ebarimtCheck.cells.ordererNone')}
          </p>
        ) : null}
        <FormField label={t('ebarimtCheck.assign.employee')} htmlFor="ebarimt-assign-user">
          <SearchSelect
            id="ebarimt-assign-user"
            value={chosen ? String(chosen.id) : ''}
            chosenLabel={chosen?.name ?? props.currentName ?? ''}
            placeholder={t('ebarimtCheck.assign.search')}
            options={rows.map((user) => ({ value: String(user.id), label: user.fullName }))}
            searching={found.isFetching}
            onSearch={setSearch}
            onChange={(value) => {
              const user = rows.find((row) => String(row.id) === value);
              if (user) setChosen({ id: user.id, name: user.fullName });
            }}
          />
        </FormField>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={sending === 'choice'}
            pending={sending === 'revert'}
            onClick={() => send(null)}
          >
            {t('ebarimtCheck.assign.revert')}
          </Button>
          <Button
            disabled={!chosen || sending === 'revert'}
            pending={sending === 'choice'}
            onClick={() => chosen && send(chosen.id)}
          >
            {t('ebarimtCheck.assign.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * e-Barimt's receipts under a register no supplier holds: what is left, and what was linked to a
 * supplier by hand, with the sum across both.
 */
export function UnregisteredDialog(props: {
  rows: readonly EbarimtUnregistered[];
  links: readonly EbarimtLink[];
  periods: readonly number[];
  baseYear: number;
  onOpen: (row: EbarimtUnregistered) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const labels = usePeriodLabels(props.baseYear);
  const canEdit = useHasPermission('ebarimt.check.edit');
  const mutations = useEbarimtMutations();
  const action = useAction();
  const [tab, setTab] = useState<'rest' | 'links'>('rest');
  const [search, setSearch] = useState('');
  const [unlinking, setUnlinking] = useState<EbarimtLink | null>(null);
  const multi = props.periods.length > 1;
  // Names as the rest of Bto finds them; registers, codes and note numbers as typed.
  const q = search.trim().toLowerCase();
  const terms = queryTerms(search);
  const found = (name: string, others: readonly string[], codes: string) =>
    !q || matchesQuery(searchKeys(name, others), terms) || codes.toLowerCase().includes(q);
  const rows = props.rows.filter((row) => found(row.name, [], row.ttd));
  const links = props.links.filter((link) =>
    found(
      link.partnerName ?? '',
      [link.supplierName],
      `${link.ttd} ${link.supplierCode} ${link.deliveryNoteNo ?? ''}`,
    ),
  );
  const live = props.links.filter((link) => !link.stale);
  const rest = props.rows.reduce((total, row) => total.plus(row.amount), new Decimal(0));
  const restCount = props.rows.reduce((total, row) => total + row.count, 0);
  const linked = live.reduce((total, link) => total.plus(link.amount), new Decimal(0));
  const unlink = (link: EbarimtLink) =>
    void action
      .run(() =>
        mutations.link.mutateAsync({
          period: link.period,
          receiptKeys: [link.receiptKey],
          supplierId: null,
        }),
      )
      .then((done) => {
        if (!done) return;
        setUnlinking(null);
        toast.success(t('ebarimtCheck.entries.unlinkedDone'));
      });
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent size="2xl" guard={false} className="flex max-h-[85vh] flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning aria-hidden className="size-5 text-warning" />
            {t('ebarimtCheck.unregistered.title')}
          </DialogTitle>
          <DialogDescription>
            {canEdit
              ? t('ebarimtCheck.unregistered.description')
              : t('ebarimtCheck.unregistered.descriptionRead')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Figure
            label={t('ebarimtCheck.unregistered.gross')}
            value={rest.plus(linked).toFixed(2)}
            count={restCount + live.length}
          />
          <span aria-hidden className="text-lg text-muted-foreground">
            −
          </span>
          <Figure
            label={t('ebarimtCheck.unregistered.linked')}
            value={linked.toFixed(2)}
            count={live.length}
            tone="text-warning"
          />
          <span aria-hidden className="text-lg text-muted-foreground">
            =
          </span>
          <Figure
            label={t('ebarimtCheck.unregistered.rest')}
            value={rest.toFixed(2)}
            count={restCount}
            tone={rest.isZero() ? 'text-success' : 'text-destructive'}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            name={t('ebarimtCheck.unregistered.tabsName')}
            options={['rest', 'links'] as const}
            value={tab}
            onChange={setTab}
            label={(value) =>
              value === 'rest'
                ? t('ebarimtCheck.unregistered.tabs.rest', { count: props.rows.length })
                : t('ebarimtCheck.unregistered.tabs.links', { count: props.links.length })
            }
          />
          <SearchField
            aria-label={t('ebarimtCheck.unregistered.search')}
            placeholder={t('ebarimtCheck.unregistered.search')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'rest' ? (
            rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('ebarimtCheck.unregistered.empty')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('ebarimtCheck.unregistered.columns.ttd')}</TableHead>
                    <TableHead>{t('ebarimtCheck.unregistered.columns.name')}</TableHead>
                    {multi ? (
                      <TableHead>{t('ebarimtCheck.unregistered.columns.months')}</TableHead>
                    ) : null}
                    <TableHead className="text-right">
                      {t('ebarimtCheck.unregistered.columns.count')}
                    </TableHead>
                    <TableHead className="text-right">
                      {t('ebarimtCheck.unregistered.columns.amount')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.ttd}>
                      <TableCell className="font-mono">{row.ttd}</TableCell>
                      <TableCell className="max-w-72 truncate" title={row.name || undefined}>
                        {row.name || '—'}
                      </TableCell>
                      {multi ? (
                        <TableCell className="text-[0.8125rem]">
                          {labels.many(row.periods)}
                        </TableCell>
                      ) : null}
                      <TableCell className="text-right font-mono">
                        {formatCount(row.count)}
                      </TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          className={cn(
                            'rounded font-mono font-medium text-link hover:underline',
                            FOCUS_RING,
                          )}
                          aria-label={t('ebarimtCheck.unregistered.openRow', {
                            ttd: row.ttd,
                            amount: formatMnt(row.amount),
                          })}
                          onClick={() => props.onOpen(row)}
                        >
                          {formatMnt(row.amount)}
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={multi ? 3 : 2} />
                    <TableCell className="text-right font-mono">
                      {formatCount(rows.reduce((total, row) => total + row.count, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {formatMnt(
                        rows
                          .reduce((total, row) => total.plus(row.amount), new Decimal(0))
                          .toFixed(2),
                      )}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )
          ) : links.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {props.links.length > 0 || !canEdit
                ? t('ebarimtCheck.unregistered.empty')
                : t('ebarimtCheck.unregistered.emptyLinks')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {multi ? (
                    <TableHead>{t('ebarimtCheck.unregistered.columns.months')}</TableHead>
                  ) : null}
                  <TableHead>{t('ebarimtCheck.unregistered.columns.date')}</TableHead>
                  <TableHead>{t('ebarimtCheck.unregistered.columns.ttd')}</TableHead>
                  <TableHead>{t('ebarimtCheck.unregistered.columns.name')}</TableHead>
                  <TableHead>{t('ebarimtCheck.unregistered.columns.deliveryNote')}</TableHead>
                  <TableHead className="text-right">
                    {t('ebarimtCheck.unregistered.columns.amount')}
                  </TableHead>
                  <TableHead>{t('ebarimtCheck.unregistered.columns.supplier')}</TableHead>
                  <TableHead>{t('ebarimtCheck.unregistered.columns.who')}</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {links.map((link) => (
                  <TableRow
                    key={`${link.period}:${link.receiptKey}`}
                    className={cn(link.stale && 'opacity-60')}
                  >
                    {multi ? <TableCell>{labels.name(link.period)}</TableCell> : null}
                    <TableCell className="whitespace-nowrap">{link.docDate ?? '—'}</TableCell>
                    <TableCell className="font-mono">{link.ttd}</TableCell>
                    <TableCell className="max-w-48 truncate" title={link.partnerName ?? undefined}>
                      {link.partnerName ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono">{link.deliveryNoteNo ?? '—'}</TableCell>
                    <TableCell className="text-right font-mono">
                      {link.stale ? (
                        <span
                          className="text-destructive"
                          title={t('ebarimtCheck.unregistered.staleHint')}
                        >
                          {t('ebarimtCheck.unregistered.stale')}
                        </span>
                      ) : (
                        formatMnt(link.amount)
                      )}
                    </TableCell>
                    <TableCell
                      className="max-w-56 truncate font-medium"
                      title={`${link.supplierCode} · ${link.supplierName}`}
                    >
                      <Link2 aria-hidden className="mr-1 inline size-3.5 text-warning" />
                      {link.supplierCode} · {link.supplierName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[0.8125rem] text-muted-foreground">
                      {[link.createdByName, formatUbMinute(link.createdAt)]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    {canEdit ? (
                      <TableCell>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={t('ebarimtCheck.entries.unlink', {
                            note: link.deliveryNoteNo ?? link.ttd,
                          })}
                          title={t('ebarimtCheck.entries.unlink', {
                            note: link.deliveryNoteNo ?? link.ttd,
                          })}
                          disabled={mutations.link.isPending}
                          onClick={() => {
                            action.clear();
                            setUnlinking(link);
                          }}
                        >
                          <Unlink />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={multi ? 5 : 4} className="font-medium">
                    {t('ebarimtCheck.entries.total', {
                      count: links.filter((link) => !link.stale).length,
                    })}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {formatMnt(
                      links
                        .filter((link) => !link.stale)
                        .reduce((total, link) => total.plus(link.amount), new Decimal(0))
                        .toFixed(2),
                    )}
                  </TableCell>
                  <TableCell colSpan={canEdit ? 3 : 2} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </div>
        {unlinking ? (
          <ConfirmDialog
            open
            variant="destructive"
            title={t('ebarimtCheck.unregistered.unlinkTitle')}
            description={t('ebarimtCheck.unregistered.unlinkText', {
              ttd: unlinking.ttd,
              amount: formatMnt(unlinking.amount),
              supplier: unlinking.supplierName,
            })}
            confirmLabel={t('ebarimtCheck.unregistered.unlinkConfirm')}
            pending={mutations.link.isPending}
            problem={action.problem}
            onClose={() => setUnlinking(null)}
            onConfirm={() => unlink(unlinking)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Figure(props: { label: string; value: string; count: number; tone?: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg bg-canvas px-3 py-1.5">
      <div className="text-xs font-medium text-muted-foreground">{props.label}</div>
      <div className={cn('font-mono text-[0.9375rem] font-semibold tabular-nums', props.tone)}>
        {formatMnt(props.value)}
      </div>
      <div className="text-xs text-muted-foreground">
        {t('ebarimtCheck.unregistered.count', { count: props.count })}
      </div>
    </div>
  );
}
