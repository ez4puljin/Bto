import { Decimal } from '@tugeel/shared/money';
import { addMonths, businessDate } from '@tugeel/shared/time';
import { Download, Printer, Scale } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField } from '@/components/form';
import { EmptyState, FilterBar, ListCard, SkeletonRows } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyName } from '@/features/company/api';
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type TrialBalance,
  type TrialBalanceRow,
  useReportMutations,
  useTrialBalance,
  useVatReport,
  useYearClose,
  type VatReport,
} from './api';
import { DATE, save, sides } from './report-helpers';

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthStart = (): string => `${businessDate().slice(0, 7)}-01`;

/** The rows of a trial balance by group, each group followed by its subtotal (ADR-0105 #2). */
function byGroup(rows: readonly TrialBalanceRow[]) {
  const groups = new Map<string, { label: string | null; rows: TrialBalanceRow[] }>();
  for (const row of rows) {
    const key = row.groupCode ?? '';
    const group = groups.get(key) ?? {
      label: row.groupCode ? `${row.groupCode} ${row.groupName ?? ''}`.trim() : null,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const sum = (pick: (row: TrialBalanceRow) => string) =>
      group.rows.reduce((total, row) => total.plus(pick(row)), new Decimal(0)).toFixed(2);
    return {
      ...group,
      opening: sum((row) => row.opening),
      debit: sum((row) => row.debit),
      credit: sum((row) => row.credit),
      closing: sum((row) => row.closing),
    };
  });
}

function TrialBalanceTable({ report }: { report: TrialBalance }) {
  const { t } = useTranslation();
  const columns = 'finance.reports.trialBalance.columns';
  const groups = byGroup(report.data);
  const grouped = groups.some((group) => group.label !== null);
  const amounts = (row: { opening: string; debit: string; credit: string; closing: string }) => (
    <>
      {[
        ...sides(row.opening),
        formatMnt(row.debit),
        formatMnt(row.credit),
        ...sides(row.closing),
      ].map((value, index) => (
        <TableCell key={index} className="text-right font-mono">
          {value}
        </TableCell>
      ))}
    </>
  );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${columns}.code`)}</TableHead>
          <TableHead>{t(`${columns}.name`)}</TableHead>
          {(
            [
              'openingDebit',
              'openingCredit',
              'debit',
              'credit',
              'closingDebit',
              'closingCredit',
            ] as const
          ).map((key) => (
            <TableHead key={key} className="text-right">
              {t(`${columns}.${key}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <Fragment key={group.label ?? ''}>
            {grouped ? (
              <TableRow className="bg-muted/40">
                <TableCell colSpan={8} className="font-semibold">
                  {group.label ?? t('finance.reports.trialBalance.noGroup')}
                </TableCell>
              </TableRow>
            ) : null}
            {group.rows.map((row) => (
              <TableRow
                key={row.accountId}
                className={row.status === 'INACTIVE' ? 'text-muted-foreground' : undefined}
              >
                <TableCell className="font-mono">
                  <Link
                    className="font-medium underline-offset-4 hover:underline"
                    to={`/finance/accounts/${row.accountId}`}
                  >
                    {row.code}
                  </Link>
                </TableCell>
                <TableCell>{row.name}</TableCell>
                {amounts(row)}
              </TableRow>
            ))}
            {grouped ? (
              <TableRow>
                <TableCell />
                <TableCell className="font-medium">
                  {t('finance.reports.trialBalance.subtotal', {
                    group: group.label ?? t('finance.reports.trialBalance.noGroup'),
                  })}
                </TableCell>
                {amounts(group)}
              </TableRow>
            ) : null}
          </Fragment>
        ))}
        <TableRow className="font-semibold">
          <TableCell />
          <TableCell>{t(`${columns}.total`)}</TableCell>
          {amounts(report)}
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** «Санхүү → Гүйлгээ баланс» (ADR-0105 #2): any dates, by group, on screen, in Excel and in print. */
export function TrialBalancePage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const from = search.get('from') ?? monthStart();
  const to = search.get('to') ?? businessDate();
  const all = search.get('all') === '1';
  const valid = DATE.test(from) && DATE.test(to) && from <= to;
  const report = useTrialBalance(valid ? { from, to, all } : null);
  const mutations = useReportMutations();
  const action = useAction();
  const set = (key: string, value: string | null) =>
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
        return params;
      },
      { replace: true },
    );
  const difference = report.data
    ? new Decimal(report.data.debit).minus(report.data.credit).toFixed(2)
    : '0.00';
  return (
    <div>
      <PageHeader
        title={t('finance.reports.trialBalance.title')}
        description={t('finance.reports.trialBalance.description')}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!valid || mutations.trialBalanceXlsx.isPending}
              onClick={() =>
                void action.run(async () =>
                  save(
                    await mutations.trialBalanceXlsx.mutateAsync({ from, to, all }),
                    `trial-balance-${from}-${to}.xlsx`,
                  ),
                )
              }
            >
              <Download />
              {t('finance.reports.excel')}
            </Button>
            <Button asChild variant="outline">
              <Link
                to={`/finance/trial-balance/print?from=${from}&to=${to}${all ? '&all=1' : ''}&format=a4`}
                target="_blank"
              >
                <Printer />
                {t('finance.reports.print')}
              </Link>
            </Button>
          </>
        }
      />
      <FilterBar>
        <FormField label={t('finance.reports.trialBalance.from')} htmlFor="tb-from">
          <Input
            id="tb-from"
            type="date"
            className="sm:w-44"
            value={from}
            max={to}
            onChange={(event) => set('from', event.target.value)}
          />
        </FormField>
        <FormField label={t('finance.reports.trialBalance.to')} htmlFor="tb-to">
          <Input
            id="tb-to"
            type="date"
            className="sm:w-44"
            value={to}
            min={from}
            onChange={(event) => set('to', event.target.value)}
          />
        </FormField>
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Switch
            id="tb-all"
            checked={all}
            onCheckedChange={(checked) => set('all', checked ? '1' : null)}
          />
          <Label htmlFor="tb-all">{t('finance.reports.trialBalance.all')}</Label>
        </div>
        {report.data ? (
          <Badge variant={difference === '0.00' ? 'secondary' : 'destructive'} className="self-end">
            {difference === '0.00'
              ? t('finance.reports.trialBalance.balanced')
              : t('finance.reports.trialBalance.unbalanced', { difference: formatMnt(difference) })}
          </Badge>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      <ListCard scroll>
        {report.isPending && valid ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={8} />
            </TableBody>
          </Table>
        ) : report.data && report.data.data.length > 0 ? (
          <TrialBalanceTable report={report.data} />
        ) : (
          <EmptyState icon={Scale} title={t('finance.reports.trialBalance.empty')} />
        )}
      </ListCard>
    </div>
  );
}

/** The trial balance on paper (`/finance/trial-balance/print?from&to`). */
export function TrialBalancePrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const from = search.get('from') ?? monthStart();
  const to = search.get('to') ?? businessDate();
  const all = search.get('all') === '1';
  const report = useTrialBalance(DATE.test(from) && DATE.test(to) ? { from, to, all } : null);
  const company = useCompanyName();
  const title = `${t('finance.reports.trialBalance.title')} ${from} – ${to}`;
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[12px]">
            <div>
              <p className="text-[13px] font-semibold">{company}</p>
              <h1 className="text-[16px] font-semibold">{title}</h1>
            </div>
            <TrialBalanceTable report={report.data} />
          </div>
        ) : null
      }
    </PrintFrame>
  );
}

const DOC_TYPES = [
  'SALES_INVOICE',
  'SALES_RETURN',
  'POS_SHIFT',
  'GOODS_RECEIPT',
  'RECEIPT_RECOST',
  'SUPPLIER_RETURN',
] as const;

/** The kind of a VAT line's document as mn.json names it. */
function docTypeOf(row: {
  system: string;
  docType: string | null;
}): (typeof DOC_TYPES)[number] | 'MANUAL' | 'OTHER' {
  if (row.system === 'FIN' && (row.docType === null || row.docType === 'JOURNAL')) return 'MANUAL';
  return DOC_TYPES.find((type) => type === row.docType) ?? 'OTHER';
}

function VatSheet({ report }: { report: VatReport }) {
  const { t } = useTranslation();
  const columns = 'finance.reports.vat.columns';
  const payable = new Decimal(report.payable);
  const summary = [
    [t('finance.reports.vat.output'), report.output],
    [t('finance.reports.vat.input'), report.input],
    [
      payable.gte(0) ? t('finance.reports.vat.payable') : t('finance.reports.vat.carried'),
      payable.abs().toFixed(2),
    ],
  ] as const;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border p-3">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            <p className="font-mono text-[18px] font-semibold">{formatMnt(value)}</p>
          </div>
        ))}
      </div>
      <div>
        <h2 className="mb-1.5 text-[14px] font-semibold">{t('finance.reports.vat.groups')}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${columns}.type`)}</TableHead>
              <TableHead className="text-right">{t(`${columns}.base`)}</TableHead>
              <TableHead className="text-right">{t(`${columns}.output`)}</TableHead>
              <TableHead className="text-right">{t(`${columns}.input`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.groups.map((group) => (
              <TableRow key={`${group.side}:${group.system}:${group.docType ?? ''}`}>
                <TableCell>
                  {t(`finance.reports.vat.docTypes.${docTypeOf(group)}`)}
                  {group.linesWithoutBase > 0 ? (
                    <span className="ml-2 text-[12px] text-muted-foreground">
                      {t('finance.reports.vat.withoutBase', { count: group.linesWithoutBase })}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-mono">{formatMnt(group.base)}</TableCell>
                <TableCell className="text-right font-mono">
                  {group.side === 'OUTPUT' ? formatMnt(group.vat) : ''}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {group.side === 'INPUT' ? formatMnt(group.vat) : ''}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div>
        <h2 className="mb-1.5 text-[14px] font-semibold">{t('finance.reports.vat.documents')}</h2>
        {report.truncated ? (
          <p className="mb-1.5 text-[13px] text-muted-foreground">
            {t('finance.reports.vat.truncated')}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${columns}.date`)}</TableHead>
              <TableHead>{t(`${columns}.entry`)}</TableHead>
              <TableHead>{t(`${columns}.document`)}</TableHead>
              <TableHead>{t(`${columns}.type`)}</TableHead>
              <TableHead className="text-right">{t(`${columns}.base`)}</TableHead>
              <TableHead className="text-right">{t(`${columns}.output`)}</TableHead>
              <TableHead className="text-right">{t(`${columns}.input`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.documents.map((row) => (
              <TableRow key={row.entryId}>
                <TableCell className="font-mono">{row.entryDate}</TableCell>
                <TableCell className="font-mono">{row.entryNumber}</TableCell>
                <TableCell className="font-mono">
                  {row.documentNumber ?? ''}
                  {row.reversal ? (
                    <Badge variant="outline" className="ml-2">
                      {t('finance.reports.vat.reversal')}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{t(`finance.reports.vat.docTypes.${docTypeOf(row)}`)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(row.base)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(row.output)}</TableCell>
                <TableCell className="text-right font-mono">{formatMnt(row.input)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/** «Санхүү → НӨАТ-ын тайлан» (ADR-0105 #3): one month, by document type and document. */
export function VatReportPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const period = search.get('period') ?? businessDate().slice(0, 7);
  const valid = PERIOD.test(period);
  const report = useVatReport(valid ? period : null);
  const mutations = useReportMutations();
  const action = useAction();
  return (
    <div>
      <PageHeader
        title={t('finance.reports.vat.title')}
        description={t('finance.reports.vat.description')}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!valid || mutations.vatXlsx.isPending}
              onClick={() =>
                void action.run(async () =>
                  save(await mutations.vatXlsx.mutateAsync(period), `vat-${period}.xlsx`),
                )
              }
            >
              <Download />
              {t('finance.reports.excel')}
            </Button>
            <Button asChild variant="outline">
              <Link to={`/finance/vat/print?period=${period}&format=a4`} target="_blank">
                <Printer />
                {t('finance.reports.print')}
              </Link>
            </Button>
          </>
        }
      />
      <FilterBar>
        <FormField label={t('finance.reports.vat.period')} htmlFor="vat-period">
          <Input
            id="vat-period"
            type="month"
            className="sm:w-44"
            value={period}
            onChange={(event) =>
              setSearch(
                (current) => {
                  const params = new URLSearchParams(current);
                  params.set('period', event.target.value);
                  return params;
                },
                { replace: true },
              )
            }
          />
        </FormField>
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      <Card>
        <CardContent>
          {report.data ? (
            report.data.groups.length > 0 ? (
              <VatSheet report={report.data} />
            ) : (
              <EmptyState icon={Scale} title={t('finance.reports.vat.empty')} />
            )
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** The VAT report on paper (`/finance/vat/print?period`). */
export function VatPrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const period = search.get('period') ?? businessDate().slice(0, 7);
  const report = useVatReport(PERIOD.test(period) ? period : null);
  const company = useCompanyName();
  const title = `${t('finance.reports.vat.title')} ${period}`;
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[12px]">
            <div>
              <p className="text-[13px] font-semibold">{company}</p>
              <h1 className="text-[16px] font-semibold">{title}</h1>
            </div>
            <VatSheet report={report.data} />
          </div>
        ) : null
      }
    </PrintFrame>
  );
}

/**
 * «Жил хаах» on «Сарын хаалт» (ADR-0105 #4): what the year still has to close, the closing's
 * numbers, «Жил хаах» with a confirmation and «Буцаах».
 */
export function YearCloseCard() {
  const { t } = useTranslation();
  const canClose = useHasPermission('finance.periods.close');
  const [year, setYear] = useState(() => addMonths(businessDate(), -12).slice(0, 4));
  const value = /^\d{4}$/.test(year) ? Number.parseInt(year, 10) : null;
  const status = useYearClose(value);
  const mutations = useReportMutations();
  const action = useAction();
  const [confirm, setConfirm] = useState<'close' | 'revert' | null>(null);
  const closed = (status.data?.documents.length ?? 0) > 0;
  const run = (kind: 'close' | 'revert') =>
    void action
      .run(async () => {
        if (value === null) return;
        if (kind === 'close') {
          await mutations.closeYear.mutateAsync({ year: value, key: randomUuid() });
          toast.success(t('finance.reports.yearClose.closed', { year: value }));
        } else {
          await mutations.revertYear.mutateAsync({ year: value, key: randomUuid() });
          toast.success(t('finance.reports.yearClose.reverted', { year: value }));
        }
      })
      .then((ok) => {
        if (ok) setConfirm(null);
      });
  const figures = status.data
    ? ([
        [t('finance.reports.yearClose.income'), status.data.income],
        [t('finance.reports.yearClose.expense'), status.data.expense],
        [t('finance.reports.yearClose.profit'), status.data.profit],
      ] as const)
    : [];
  return (
    <Card className="mb-3 gap-2">
      <CardHeader>
        <CardTitle>{t('finance.reports.yearClose.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-[13px] text-muted-foreground">
          {t('finance.reports.yearClose.description')}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t('finance.reports.yearClose.year')} htmlFor="close-year">
            <Input
              id="close-year"
              inputMode="numeric"
              className="sm:w-28"
              value={year}
              maxLength={4}
              onChange={(event) => setYear(event.target.value)}
            />
          </FormField>
          {figures.map(([label, amount]) => (
            <div key={label} className="pb-1">
              <p className="text-[12px] text-muted-foreground">{label}</p>
              <p className="font-mono font-medium">{formatMnt(amount)}</p>
            </div>
          ))}
          <Badge variant={closed ? 'secondary' : 'outline'} className="mb-1.5">
            {closed
              ? t('finance.reports.yearClose.closedBy', {
                  numbers: status.data?.documents.map((row) => row.number).join(', ') ?? '',
                })
              : status.data && !status.data.ended
                ? t('finance.reports.yearClose.notEnded')
                : t('finance.reports.yearClose.notClosed')}
          </Badge>
          {canClose && status.data ? (
            closed ? (
              <Button variant="outline" onClick={() => setConfirm('revert')}>
                {t('finance.reports.yearClose.revert')}
              </Button>
            ) : (
              <Button disabled={!status.data.ended} onClick={() => setConfirm('close')}>
                {t('finance.reports.yearClose.close')}
              </Button>
            )
          ) : null}
        </div>
        {confirm === null ? <ProblemAlert problem={problemFromError(status.error)} /> : null}
      </CardContent>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === 'revert'
            ? t('finance.reports.yearClose.revertTitle', { year })
            : t('finance.reports.yearClose.closeTitle', { year })
        }
        description={
          confirm === 'revert'
            ? t('finance.reports.yearClose.revertDescription', { year })
            : t('finance.reports.yearClose.closeDescription', { year })
        }
        confirmLabel={
          confirm === 'revert'
            ? t('finance.reports.yearClose.revert')
            : t('finance.reports.yearClose.close')
        }
        variant={confirm === 'revert' ? 'destructive' : 'default'}
        pending={mutations.closeYear.isPending || mutations.revertYear.isPending}
        problem={action.problem}
        onConfirm={() => run(confirm ?? 'close')}
        onClose={() => {
          action.clear();
          setConfirm(null);
        }}
      />
    </Card>
  );
}
