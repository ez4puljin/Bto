import { JOURNAL_SOURCES } from '@tugeel/shared/finance';
import { BookOpenText, Ellipsis, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import {
  ChevronHead,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SkeletonRows,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import { DateRangeFilter } from './date-range-filter';
import {
  type JournalEntryDetail,
  type JournalSource,
  useFinanceMutations,
  useGlAccounts,
  useJournal,
  useJournalEntry,
} from './api';
import { SourceBadge } from './badges';
import { JournalEntryDialog } from './journal-entry-dialog';
import { FactChips, PanelSection, RecordSheet } from './panel';
import { VoidDialog } from './void-dialog';

const isSource = (value: string | null): value is JournalSource =>
  JOURNAL_SOURCES.some((source) => source === value);

/**
 * The general journal (ADR-0060 #7): entries newest first, filtered by dates, source and account;
 * «Гараар бичилт» opens the dialog (`?new=1`); a row opens the entry's lines (`?entry=`).
 */
export function JournalPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('finance.journal.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const [creating, setCreating] = useCreateParam();
  const sourceParam = params.get('source');
  const accountParam = Number.parseInt(params.get('account') ?? '', 10);
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('entry') ?? '', 10);
  const accounts = useGlAccounts();
  const journal = useJournal({
    from,
    to,
    source: isSource(sourceParam) ? sourceParam : undefined,
    accountId: accountParam > 0 ? accountParam : undefined,
  });
  const rows = journal.data?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div>
      <PageHeader
        title={t('finance.journal.title')}
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              {t('finance.actions.manualEntry')}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('finance.fields.source')}
          value={sourceParam ?? ''}
          onChange={(event) => setParam('source', event.target.value)}
        >
          <option value="">{t('finance.journal.allSources')}</option>
          {JOURNAL_SOURCES.map((value) => (
            <option key={value} value={value}>
              {t(`finance.sources.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('finance.fields.account')}
          value={accountParam > 0 ? String(accountParam) : ''}
          onChange={(event) => setParam('account', event.target.value)}
        >
          <option value="">{t('finance.journal.allAccounts')}</option>
          {(accounts.data ?? []).map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} · {account.name}
            </option>
          ))}
        </NativeSelect>
        <DateRangeFilter
          label={t('finance.fields.date')}
          fromLabel={t('finance.fields.from')}
          toLabel={t('finance.fields.to')}
          from={from}
          to={to}
          onFrom={(value) => setParam('from', value)}
          onTo={(value) => setParam('to', value)}
        />
      </FilterBar>
      <ProblemAlert problem={problemFromError(journal.error)} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('finance.fields.number')}</TableHead>
              <TableHead>{t('finance.fields.date')}</TableHead>
              <TableHead>{t('finance.fields.description')}</TableHead>
              <TableHead>{t('finance.fields.source')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.amount')}</TableHead>
              <TableHead className="text-right">{t('finance.fields.lines')}</TableHead>
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {journal.isPending ? <SkeletonRows columns={7} /> : null}
            {rows.map((entry) => {
              // The number is the row's link for the keyboard; a click anywhere opens the panel.
              const href = hrefWithParam(params, 'entry', String(entry.id));
              return (
                <LinkRow key={entry.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {entry.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">{entry.entryDate}</TableCell>
                  <TruncateCell text={entry.description} fill />
                  <TableCell>
                    <SourceBadge source={entry.source} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatMnt(entry.amount)}</TableCell>
                  <TableCell className="text-right font-mono">{entry.lineCount}</TableCell>
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
        {!journal.isPending && rows.length === 0 ? (
          <EmptyState icon={BookOpenText} title={t('finance.journal.empty')} />
        ) : null}
        <LoadMore query={journal} />
      </ListCard>
      {creating ? (
        <JournalEntryDialog
          open
          onClose={() => setCreating(false)}
          onPosted={(id) =>
            setParams(
              (previous) => {
                const next = new URLSearchParams(previous);
                next.delete('new');
                next.set('entry', String(id));
                return next;
              },
              { replace: true },
            )
          }
        />
      ) : null}
      <JournalEntryPanel
        entryId={openId > 0 ? openId : null}
        onClose={() => setParam('entry', null)}
      />
    </div>
  );
}

/** One entry in the panel (`?entry=`): the facts and the lines; a manual one may be reversed. */
export function JournalEntryPanel({
  entryId,
  onClose,
}: {
  entryId: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const entry = useJournalEntry(entryId);
  const detail = entry.data;
  return (
    <RecordSheet
      open={entryId !== null}
      onClose={onClose}
      title={detail ? t('finance.journal.panelTitle', { number: detail.number }) : ''}
      description={detail?.description ?? ''}
      badges={detail ? <SourceBadge source={detail.source} /> : null}
      actions={detail ? <EntryActions entry={detail} /> : null}
    >
      <ProblemAlert problem={problemFromError(entry.error)} />
      {detail ? <EntryBody entry={detail} /> : null}
    </RecordSheet>
  );
}

function EntryActions({ entry }: { entry: JournalEntryDetail }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('finance.journal.manage');
  const [reversing, setReversing] = useState(false);
  const mutations = useFinanceMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const reversible =
    canManage &&
    (entry.source === 'MANUAL' || entry.source === 'OPENING') &&
    entry.reversedById === null;
  if (!reversible) return null;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t('finance.actions.other')}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setReversing(true)}>
            {t('finance.actions.reverse')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {reversing ? (
        <VoidDialog
          open
          title={t('finance.journal.reverseTitle')}
          description={t('finance.journal.reverseDescription', { number: entry.number })}
          submitLabel={t('finance.journal.reverseSubmit')}
          pending={mutations.reverseEntry.isPending}
          problem={action.problem}
          onClose={() => {
            setReversing(false);
            action.clear();
          }}
          onConfirm={(description) => {
            void action
              .run(async () => {
                const reversed = await mutations.reverseEntry.mutateAsync({
                  id: entry.id,
                  key,
                  description,
                });
                toast.success(t('finance.journal.reversed', { number: reversed.number }));
              })
              .then((ok) => {
                if (ok) {
                  setReversing(false);
                  setKey(randomUuid());
                }
              });
          }}
        />
      ) : null}
    </>
  );
}

function EntryBody({ entry }: { entry: JournalEntryDetail }) {
  const { t } = useTranslation();
  const sourceLink =
    entry.sourceType === 'INVOICE'
      ? `/finance/invoices?invoice=${entry.sourceId}`
      : entry.sourceType === 'PAYMENT'
        ? `/finance/payments?payment=${entry.sourceId}`
        : null;
  const facts = [
    { label: t('finance.fields.date'), value: entry.entryDate },
    ...(entry.sourceNumber
      ? [
          {
            label: t('finance.journal.sourceDoc'),
            value: sourceLink ? (
              <Link
                className="font-mono text-link underline-offset-2 hover:underline"
                to={sourceLink}
              >
                {entry.sourceNumber}
              </Link>
            ) : (
              <span className="font-mono">{entry.sourceNumber}</span>
            ),
          },
        ]
      : []),
    ...(entry.reversesNumber
      ? [
          {
            label: t('finance.actions.reverse'),
            value: t('finance.journal.reverses', { number: entry.reversesNumber }),
          },
        ]
      : []),
    ...(entry.reversedByNumber
      ? [
          {
            label: t('finance.fields.status'),
            value: t('finance.journal.reversedBy', { number: entry.reversedByNumber }),
          },
        ]
      : []),
    ...(entry.postedByName
      ? [
          {
            label: t('finance.fields.createdBy'),
            value: `${entry.postedByName} · ${formatUbDateTime(Date.parse(entry.createdAt))}`,
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <FactChips facts={facts} />
      <PanelSection title={t('finance.fields.lines')}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('finance.fields.account')}</TableHead>
                <TableHead>{t('finance.fields.description')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
                <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <span className="font-mono text-muted-foreground">{line.accountCode}</span>{' '}
                    {line.accountName}
                  </TableCell>
                  <TableCell>
                    {[line.customerName, line.moneyAccountName, line.description]
                      .filter(Boolean)
                      .join(' · ')}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.debit === '0.00' ? '' : formatMnt(line.debit)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.credit === '0.00' ? '' : formatMnt(line.credit)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell colSpan={2}>{t('finance.journal.dialog.totals')}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(entry.amount)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(entry.amount)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </PanelSection>
    </div>
  );
}
