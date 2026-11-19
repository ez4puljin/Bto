import { ERKHET_OWN_DOCUMENT_CHOICES, type ErkhetOwnDocumentChoice } from '@tugeel/shared/erkhet';
import { ArrowLeftRight, BookCheck, RefreshCw, Undo2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  EmptyState,
  FilterBar,
  FilterToggle,
  ListCard,
  ListTable,
  LoadMore,
  SearchField,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { ProblemAlert } from '@/components/problem-alert';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { formatCount, formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type ErkhetLedgerOwnDocument,
  type ErkhetLedgerParty,
  type ErkhetLedgerRun,
  useErkhetLedger,
  useErkhetLedgerParties,
  useErkhetLedgerStart,
  useErkhetOwnDocuments,
} from './api';

const ACCOUNT_COLUMNS: readonly ColumnSpec[] = [
  { key: 'account', kind: 'text', weight: 2, min: 10 },
  { key: 'trs', kind: 'number' },
  { key: 'opening', kind: 'money' },
  { key: 'debit', kind: 'money' },
  { key: 'credit', kind: 'money' },
  { key: 'closing', kind: 'money' },
  { key: 'spacer', kind: 'spacer' },
];

const PARTY_COLUMNS: readonly ColumnSpec[] = [
  { key: 'account', kind: 'code' },
  { key: 'code', kind: 'code' },
  { key: 'name', kind: 'text', weight: 3, min: 12 },
  { key: 'lines', kind: 'number' },
  { key: 'opening', kind: 'money' },
  { key: 'debit', kind: 'money' },
  { key: 'credit', kind: 'money' },
  { key: 'closing', kind: 'money' },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
];

const OWN_COLUMNS: readonly ColumnSpec[] = [
  { key: 'date', kind: 'code' },
  { key: 'number', kind: 'code' },
  { key: 'party', kind: 'text', weight: 3, min: 12 },
  { key: 'amount', kind: 'money' },
  { key: 'status', kind: 'status' },
  { key: 'spacer', kind: 'spacer' },
];

type Refusal = NonNullable<
  Awaited<ReturnType<ReturnType<typeof useErkhetLedgerStart>['mutateAsync']>>['refusal']
>;

const REFUSAL_KEY = {
  NOT_CONFIGURED: 'notConfigured',
  RUNNING: 'running',
  NOT_CHECKED: 'notChecked',
  CHOICE_REQUIRED: 'choiceRequired',
  NOT_REVERSIBLE: 'notReversible',
  NOTHING_POSTED: 'nothingPosted',
} as const satisfies Record<Refusal, string>;

const FAILURE_KEY = {
  NOT_CONFIGURED: 'notConfigured',
  KEY_UNREADABLE: 'keyUnreadable',
  LOGIN_FAILED: 'loginFailed',
  COMPANY_UNREACHABLE: 'companyUnreachable',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  UNEXPECTED_ANSWER: 'unexpectedAnswer',
  UNEXPECTED_FILE: 'unexpectedAnswer',
  INTERRUPTED: 'interrupted',
  INTERNAL: 'internal',
  ACCOUNT_NOT_FOUND: 'accountNotFound',
  UNEXPECTED_PAGE: 'unexpectedPage',
  PERIOD_CLOSED: 'periodClosed',
  CLEARING_MISSING: 'clearingMissing',
  POSTING_REFUSED: 'postingRefused',
} as const satisfies Record<NonNullable<ErkhetLedgerRun['failure']>, string>;

/**
 * «Авлага, өглөгийн гүйлгээ» (ADR-0219): Erkhet's receivable and payable transactions copied into
 * Bto's books under each party. «Шалгах» downloads and shows what would be posted; «Bto-д оруулах»
 * posts it and the night keeps up afterwards; «Хуулсныг буцаах» reverses every copy. Nothing here
 * writes to Erkhet.
 */
export function ErkhetLedgerPanel() {
  const { t } = useTranslation();
  const canManage = useHasPermission('erkhet.sync.manage');
  const overview = useErkhetLedger(true);
  const start = useErkhetLedgerStart();
  const action = useAction();
  const [dialog, setDialog] = useState<'post' | 'revert' | null>(null);
  const [choice, setChoice] = useState<ErkhetOwnDocumentChoice | null>(null);
  const [unmatched, setUnmatched] = useState(true);
  const [q, setQ] = useState('');
  const choiceId = useId();

  const state = overview.data;
  const latest = state?.latest ?? null;
  const summary = latest?.summary ?? null;
  const own = useErkhetOwnDocuments(Boolean(state), latest?.id ?? null);
  const parties = useErkhetLedgerParties({ runId: latest?.id ?? null, unmatched, q });
  const partyRows = parties.data?.pages.flatMap((page) => page.data) ?? [];
  const ownRows = own.data?.data ?? [];
  const ownBlocked = ownRows.some((row) => row.blocker !== null) || Boolean(own.data?.truncated);
  const running = Boolean(state?.active) || start.isPending;
  const canPost = Boolean(state?.configured) && (state?.posting || state?.checked);

  const run = async (
    kind: 'CHECK' | 'POST' | 'REVERT',
    ownDocuments?: ErkhetOwnDocumentChoice,
  ): Promise<boolean> =>
    action.run(async () => {
      const result = await start.mutateAsync({
        kind,
        ...(ownDocuments ? { ownDocuments } : {}),
        ...(ownDocuments === 'REVERSE' ? { reason: t('erkhet.ledger.own.reason') } : {}),
      });
      if (result.started) toast.success(t(`erkhet.ledger.started.${kind}`));
      else if (result.refusal) {
        toast.warning(t(`erkhet.ledger.refusal.${REFUSAL_KEY[result.refusal]}`));
      }
    });
  const close = () => {
    setDialog(null);
    setChoice(null);
  };
  const confirm = async () => {
    const done =
      dialog === 'revert'
        ? await run('REVERT')
        : await run('POST', ownRows.length > 0 ? (choice ?? undefined) : undefined);
    if (done) close();
  };

  return (
    <div className="flex flex-col gap-4">
      <ProblemAlert
        problem={problemFromError(overview.error ?? own.error ?? parties.error) ?? action.problem}
        onRetry={overview.error ? overview.refetch : undefined}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 text-sm text-muted-foreground">
          <p>
            {latest
              ? t(`erkhet.ledger.last.${latest.kind}`, {
                  at: formatUbMinute(latest.finishedAt ?? latest.createdAt),
                })
              : state
                ? t('erkhet.ledger.never')
                : null}
          </p>
          {state ? (
            <p>
              {t('erkhet.ledger.scope', {
                receivable: state.receivableAccount,
                payable: state.payableAccount,
                from: state.startDate,
              })}{' '}
              {t(
                !state.posting
                  ? 'erkhet.ledger.nightly.notYet'
                  : state.nightly
                    ? 'erkhet.ledger.nightly.on'
                    : 'erkhet.ledger.nightly.off',
              )}
            </p>
          ) : null}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              pending={running}
              disabled={!state?.configured}
              onClick={() => void run('CHECK')}
            >
              <RefreshCw />
              {running ? t('erkhet.ledger.running') : t('erkhet.ledger.check')}
            </Button>
            <Button disabled={running || !canPost} onClick={() => setDialog('post')}>
              <BookCheck />
              {t('erkhet.ledger.post')}
            </Button>
            <Button
              variant="outline"
              disabled={running || !state || state.posted === 0}
              onClick={() => setDialog('revert')}
            >
              <Undo2 />
              {t('erkhet.ledger.revert')}
            </Button>
          </div>
        ) : null}
      </div>

      {state?.failed ? (
        <Alert variant="destructive">
          <AlertDescription>
            {t('erkhet.ledger.failed', {
              at: formatUbMinute(state.failed.finishedAt ?? state.failed.createdAt),
              reason: t(
                `erkhet.ledger.failure.${FAILURE_KEY[state.failed.failure ?? 'INTERNAL']}`,
                {
                  month: state.failed.failureDetail?.month ?? '',
                  account: state.failed.failureDetail?.account ?? '',
                  code: state.failed.failureDetail?.code ?? '',
                },
              ),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {state && state.blocked > 0 ? (
        <Alert>
          <AlertDescription>
            {t('erkhet.ledger.blocked', { count: state.blocked })}
          </AlertDescription>
        </Alert>
      ) : null}

      {summary ? (
        <>
          <dl className="grid grid-cols-2 gap-2 @container sm:grid-cols-4">
            <Stat
              label={t('erkhet.ledger.stat.post')}
              value={summary.trs.post + summary.openings.post}
            />
            <Stat
              label={t('erkhet.ledger.stat.revise')}
              value={summary.trs.revise + summary.openings.revise}
            />
            <Stat
              label={t('erkhet.ledger.stat.reverse')}
              value={summary.trs.reverse + summary.openings.reverse}
            />
            <Stat label={t('erkhet.ledger.stat.unmatched')} value={summary.unmatchedParties} warn />
          </dl>
          {summary.done ? (
            <p className="text-sm text-muted-foreground">
              {t('erkhet.ledger.done', {
                posted: formatCount(summary.done.posted),
                reversed: formatCount(summary.done.reversed),
                blocked: formatCount(summary.done.blocked),
                own: formatCount(summary.done.ownReversed),
              })}
            </p>
          ) : null}

          <section aria-label={t('erkhet.ledger.accounts.title')}>
            <h2 className="mb-1 text-sm font-semibold">{t('erkhet.ledger.accounts.title')}</h2>
            <p className="mb-2 text-sm text-muted-foreground">{t('erkhet.ledger.accounts.help')}</p>
            <ListCard scroll>
              <ListTable columns={ACCOUNT_COLUMNS}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('erkhet.ledger.column.account')}</TableHead>
                    <TableHead className="text-right">{t('erkhet.ledger.column.trs')}</TableHead>
                    <TableHead className="text-right">
                      {t('erkhet.ledger.column.opening')}
                    </TableHead>
                    <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
                    <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
                    <TableHead className="text-right">
                      {t('erkhet.ledger.column.closing')}
                    </TableHead>
                    <SpacerHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.accounts.map((account) => (
                    <TableRow key={account.account}>
                      <TableCell>
                        <span className="font-mono">{account.account}</span>{' '}
                        {t(`erkhet.ledger.side.${account.side}`)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCount(account.trs)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMnt(account.opening)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMnt(account.debit)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMnt(account.credit)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {formatMnt(account.closing)}
                      </TableCell>
                      <SpacerCell />
                    </TableRow>
                  ))}
                </TableBody>
              </ListTable>
            </ListCard>
          </section>
        </>
      ) : state && !latest ? (
        <EmptyState icon={ArrowLeftRight} title={t('erkhet.ledger.empty')} />
      ) : null}

      {ownRows.length > 0 ? (
        <section aria-label={t('erkhet.ledger.own.title')}>
          <h2 className="mb-1 text-sm font-semibold">{t('erkhet.ledger.own.title')}</h2>
          <Alert className="mb-2">
            <AlertDescription>
              {t('erkhet.ledger.own.warning', {
                count: ownRows.length,
                total: formatMnt(own.data?.total ?? '0'),
              })}
              {own.data?.truncated ? ` ${t('erkhet.ledger.own.truncated')}` : ''}
            </AlertDescription>
          </Alert>
          <OwnTable rows={ownRows} />
        </section>
      ) : null}

      {latest ? (
        <section aria-label={t('erkhet.ledger.parties.title')}>
          <h2 className="mb-1 text-sm font-semibold">{t('erkhet.ledger.parties.title')}</h2>
          <FilterBar>
            <SearchField
              aria-label={t('common.search')}
              placeholder={t('erkhet.ledger.parties.search')}
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <FilterToggle
              label={t('erkhet.ledger.parties.unmatchedOnly')}
              checked={unmatched}
              onCheckedChange={setUnmatched}
            />
          </FilterBar>
          <p className="mb-2 text-sm text-muted-foreground">
            {t(unmatched ? 'erkhet.ledger.parties.helpUnmatched' : 'erkhet.ledger.parties.help')}
          </p>
          <ListCard scroll>
            <ListTable columns={PARTY_COLUMNS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('erkhet.ledger.column.accountCode')}</TableHead>
                  <TableHead>{t('erkhet.ledger.column.code')}</TableHead>
                  <TableHead>{t('erkhet.ledger.column.name')}</TableHead>
                  <TableHead className="text-right">{t('erkhet.ledger.column.lines')}</TableHead>
                  <TableHead className="text-right">{t('erkhet.ledger.column.opening')}</TableHead>
                  <TableHead className="text-right">{t('finance.fields.debit')}</TableHead>
                  <TableHead className="text-right">{t('finance.fields.credit')}</TableHead>
                  <TableHead className="text-right">{t('erkhet.ledger.column.closing')}</TableHead>
                  <TableHead>{t('erkhet.ledger.column.inBto')}</TableHead>
                  <SpacerHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {parties.isPending ? <SkeletonRows columns={PARTY_COLUMNS.length} /> : null}
                {partyRows.map((row) => (
                  <PartyRow key={`${row.account}:${row.code}`} party={row} />
                ))}
              </TableBody>
            </ListTable>
            {!parties.isPending && partyRows.length === 0 ? (
              <EmptyState
                icon={ArrowLeftRight}
                title={t(
                  unmatched
                    ? 'erkhet.ledger.parties.emptyUnmatched'
                    : 'erkhet.ledger.parties.empty',
                )}
              />
            ) : null}
            <LoadMore query={parties} />
          </ListCard>
        </section>
      ) : null}

      <ConfirmDialog
        open={dialog === 'post'}
        variant="default"
        initialFocus={ownRows.length > 0 ? 'first' : 'confirm'}
        title={t('erkhet.ledger.post')}
        description={t(
          state?.posting ? 'erkhet.ledger.postConfirm.again' : 'erkhet.ledger.postConfirm.first',
        )}
        confirmLabel={t('erkhet.ledger.post')}
        pending={start.isPending}
        disabled={ownRows.length > 0 && choice === null}
        problem={action.problem}
        onConfirm={() => void confirm()}
        onClose={close}
      >
        {ownRows.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              {t('erkhet.ledger.own.choose', {
                count: ownRows.length,
                total: formatMnt(own.data?.total ?? '0'),
              })}
            </legend>
            {ERKHET_OWN_DOCUMENT_CHOICES.map((option) => {
              const refused = option === 'REVERSE' && ownBlocked;
              return (
                <div key={option} className="flex items-start gap-2">
                  <input
                    type="radio"
                    id={`${choiceId}-${option}`}
                    name={choiceId}
                    className="mt-1 size-4 accent-primary"
                    checked={choice === option}
                    disabled={refused}
                    onChange={() => setChoice(option)}
                  />
                  <div className="min-w-0">
                    <Label htmlFor={`${choiceId}-${option}`}>
                      {t(`erkhet.ledger.own.choice.${option}`)}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        refused
                          ? 'erkhet.ledger.own.reverseRefused'
                          : `erkhet.ledger.own.choiceHelp.${option}`,
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </fieldset>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === 'revert'}
        title={t('erkhet.ledger.revert')}
        description={t('erkhet.ledger.revertConfirm')}
        confirmLabel={t('erkhet.ledger.revert')}
        pending={start.isPending}
        problem={action.problem}
        onConfirm={() => void confirm()}
        onClose={close}
      />
    </div>
  );
}

function Stat(props: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-xl bg-card px-4 py-3 shadow-card ring-1 ring-black/[0.06]">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={
          props.warn && props.value > 0
            ? 'text-xl font-semibold tabular-nums text-warning'
            : 'text-xl font-semibold tabular-nums'
        }
      >
        {formatCount(props.value)}
      </dd>
    </div>
  );
}

function PartyRow({ party }: { party: ErkhetLedgerParty }) {
  const { t } = useTranslation();
  const to =
    party.btoId === null
      ? null
      : party.side === 'RECEIVABLE'
        ? `/finance/customers/${party.btoId}`
        : `/finance/payables/${party.btoId}`;
  return (
    <TableRow>
      <TableCell className="font-mono">{party.account}</TableCell>
      <TableCell className="tabular-nums">
        {party.code || t('erkhet.ledger.parties.noCode')}
      </TableCell>
      <TruncateCell text={party.name}>
        {to ? (
          <Link to={to} className="text-link underline-offset-4 hover:underline">
            {party.name}
          </Link>
        ) : undefined}
      </TruncateCell>
      <TableCell className="text-right tabular-nums">{formatCount(party.lines)}</TableCell>
      <TableCell className="text-right font-mono">{formatMnt(party.opening)}</TableCell>
      <TableCell className="text-right font-mono">{formatMnt(party.debit)}</TableCell>
      <TableCell className="text-right font-mono">{formatMnt(party.credit)}</TableCell>
      <TableCell className="text-right font-mono font-semibold">
        {formatMnt(party.closing)}
      </TableCell>
      <TableCell>
        {party.btoId === null ? (
          <Badge variant="warning">{t('erkhet.ledger.parties.missing')}</Badge>
        ) : null}
      </TableCell>
      <SpacerCell />
    </TableRow>
  );
}

function OwnTable({ rows }: { rows: readonly ErkhetLedgerOwnDocument[] }) {
  const { t } = useTranslation();
  return (
    <ListCard scroll>
      <ListTable columns={OWN_COLUMNS}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('finance.fields.date')}</TableHead>
            <TableHead>{t('erkhet.ledger.column.number')}</TableHead>
            <TableHead>{t('erkhet.ledger.column.name')}</TableHead>
            <TableHead className="text-right">{t('erkhet.ledger.column.amount')}</TableHead>
            <TableHead>{t('erkhet.ledger.column.note')}</TableHead>
            <SpacerHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.entryId}:${row.side}`}>
              <TableCell className="font-mono">{row.date}</TableCell>
              <TableCell className="font-mono">{row.number}</TableCell>
              <TruncateCell text={row.partyName ?? ''} />
              <TableCell className="text-right font-mono">{formatMnt(row.amount)}</TableCell>
              <TableCell>
                {row.blocker ? (
                  <Badge variant="warning">{t(`erkhet.ledger.own.blocker.${row.blocker}`)}</Badge>
                ) : null}
              </TableCell>
              <SpacerCell />
            </TableRow>
          ))}
        </TableBody>
      </ListTable>
    </ListCard>
  );
}
