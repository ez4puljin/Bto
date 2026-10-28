import { VOID_REASONS } from '@tugeel/shared/pos';
import { Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  ChevronHead,
  DateFilter,
  EmptyState,
  FilterBar,
  LinkRow,
  ListCard,
  LoadMore,
  SkeletonRows,
  SpacerCell,
  SpacerHead,
  TruncateCell,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips, PanelSection, RecordSheet } from '@/components/record-sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { formatCount, formatQty, formatTugrik } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { hrefWithParam, useSetParam } from '@/lib/search-params';
import { type VoidDetail, type VoidReason, useCashiers, useTills, useVoid, useVoids } from './api';
import { VoidReasonBadge } from './badges';

const isReason = (value: string | null): value is VoidReason =>
  VOID_REASONS.some((entry) => entry === value);

/**
 * «Хасалт» (ADR-0104): goods taken off a till's cart before payment, each approved by a
 * supervisor; filter by till, cashier, reason and day. One opens in the panel (`?void=`); its time
 * is the row's link for the keyboard.
 */
export function PosVoidsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const reasonParam = params.get('reason');
  const reason = isReason(reasonParam) ? reasonParam : undefined;
  const tillId = Number.parseInt(params.get('tillId') ?? '', 10) || undefined;
  const cashierUserId = Number.parseInt(params.get('cashier') ?? '', 10) || undefined;
  const from = params.get('from') ?? undefined;
  const to = params.get('to') ?? undefined;
  const openId = Number.parseInt(params.get('void') ?? '', 10);
  const tills = useTills();
  const cashiers = useCashiers();
  const voids = useVoids({ tillId, cashierUserId, reason, from, to });
  const rows = voids.data?.pages.flatMap((page) => page.data) ?? [];
  const first = voids.data?.pages[0];
  const filtered = Boolean(reason || tillId || cashierUserId || from || to);

  return (
    <div>
      <PageHeader
        title={t('pos.voids.title')}
        description={t('pos.voids.description')}
        meta={
          first && first.total !== null ? (
            <span className="tabular-nums">
              {t('pos.voids.count', { count: formatCount(first.total) })}
              {first.sum !== null ? ` · ${formatTugrik(first.sum)}` : ''}
            </span>
          ) : undefined
        }
      />
      <FilterBar>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.reason')}
          value={reason ?? ''}
          onChange={(event) => setParam('reason', event.target.value)}
        >
          <option value="">{t('pos.voids.allReasons')}</option>
          {VOID_REASONS.map((value) => (
            <option key={value} value={value}>
              {t(`pos.voidReasons.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.till')}
          value={tillId ?? ''}
          onChange={(event) => setParam('tillId', event.target.value)}
        >
          <option value="">{t('pos.shifts.allTills')}</option>
          {(tills.data ?? []).map((till) => (
            <option key={till.id} value={till.id}>
              {till.code} · {till.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('pos.fields.cashier')}
          value={cashierUserId ?? ''}
          onChange={(event) => setParam('cashier', event.target.value)}
        >
          <option value="">{t('pos.voids.allCashiers')}</option>
          {(cashiers.data ?? []).map((cashier) => (
            <option key={cashier.userId} value={cashier.userId}>
              {cashier.fullName}
            </option>
          ))}
        </NativeSelect>
        {/* The two days wrap as a pair: on a laptop they share the second row. */}
        <div className="flex flex-wrap items-center gap-2">
          <DateFilter
            label={t('pos.fields.from')}
            value={from}
            onChange={(value) => setParam('from', value)}
          />
          <DateFilter
            label={t('pos.fields.to')}
            value={to}
            onChange={(value) => setParam('to', value)}
          />
        </div>
      </FilterBar>
      <ProblemAlert problem={problemFromError(voids.error)} onRetry={voids.refetch} />
      <ListCard scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('pos.fields.voidedAt')}</TableHead>
              <TableHead>{t('pos.fields.till')}</TableHead>
              <TableHead>{t('pos.fields.cashier')}</TableHead>
              <TableHead>{t('pos.fields.reason')}</TableHead>
              <TableHead>{t('pos.fields.approvedBy')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.lineCount')}</TableHead>
              <TableHead className="text-right">{t('pos.fields.total')}</TableHead>
              <SpacerHead />
              <ChevronHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {voids.isPending ? <SkeletonRows columns={9} /> : null}
            {rows.map((row) => {
              const href = hrefWithParam(params, 'void', String(row.id));
              return (
                <LinkRow key={row.id} to={href}>
                  <TableCell className="font-mono">
                    <Link to={href} className="font-medium underline-offset-4 hover:underline">
                      {formatUbDateTime(Date.parse(row.voidedAt))}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono">{row.tillCode}</TableCell>
                  <TruncateCell text={row.cashierName ?? t('pos.fields.none')}>
                    {row.cashierName ?? (
                      <span className="text-muted-foreground">{t('pos.fields.none')}</span>
                    )}
                  </TruncateCell>
                  <TableCell>
                    <VoidReasonBadge reason={row.reason} />
                  </TableCell>
                  <TruncateCell text={row.approvedByName ?? t('pos.fields.none')}>
                    {row.approvedByName ?? (
                      <span className="text-muted-foreground">{t('pos.fields.none')}</span>
                    )}
                  </TruncateCell>
                  <TableCell className="text-right font-mono">
                    {formatCount(row.lineCount)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatTugrik(row.total)}</TableCell>
                  <SpacerCell />
                </LinkRow>
              );
            })}
          </TableBody>
        </Table>
        {!voids.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Undo2}
            title={t('pos.voids.empty')}
            {...(filtered
              ? { onClearFilters: () => setParams(new URLSearchParams(), { replace: true }) }
              : {})}
          />
        ) : null}
        <LoadMore query={voids} />
      </ListCard>
      <VoidPanel voidId={openId > 0 ? openId : null} onClose={() => setParam('void', null)} />
    </div>
  );
}

/** One void in the panel (`?void=`): who, why, who approved, and the goods taken off the cart. */
function VoidPanel({ voidId, onClose }: { voidId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const entry = useVoid(voidId);
  const detail = entry.data;
  return (
    <RecordSheet
      open={voidId !== null}
      onClose={onClose}
      title={detail ? t('pos.voids.panelTitle', { till: detail.tillCode }) : ''}
      description={
        detail
          ? [formatUbDateTime(Date.parse(detail.voidedAt)), detail.cashierName]
              .filter(Boolean)
              .join(' · ')
          : ''
      }
      badges={detail ? <VoidReasonBadge reason={detail.reason} /> : null}
    >
      <ProblemAlert problem={problemFromError(entry.error)} onRetry={entry.refetch} />
      {detail ? <VoidBody entry={detail} /> : null}
    </RecordSheet>
  );
}

function VoidBody({ entry }: { entry: VoidDetail }) {
  const { t } = useTranslation();
  const facts = [
    {
      label: t('pos.fields.shift'),
      value:
        entry.shiftId !== null ? (
          <Link
            className="font-mono text-link underline-offset-2 hover:underline"
            to={`/pos/shifts?shift=${entry.shiftId}`}
          >
            {entry.shiftNumber ?? String(entry.shiftId)}
          </Link>
        ) : (
          t('pos.voids.noShift')
        ),
    },
    { label: t('pos.fields.approvedBy'), value: entry.approvedByName ?? t('pos.fields.none') },
    { label: t('pos.fields.total'), value: formatTugrik(entry.total) },
  ];
  return (
    <div className="flex flex-col gap-5">
      <FactChips facts={facts} />
      <PanelSection title={t('pos.sales.sections.lines')}>
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-full">{t('pos.fields.product')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.qty')}</TableHead>
                <TableHead>{t('pos.fields.unit')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.unitPrice')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.lineTotal')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.lines.map((line) => (
                <TableRow key={line.lineNo}>
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="font-mono text-muted-foreground">{line.productSku}</span>{' '}
                    {line.productName}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatQty(line.qty)}</TableCell>
                  <TableCell>{line.uomName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {formatTugrik(line.unitPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatTugrik(line.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </PanelSection>
    </div>
  );
}
