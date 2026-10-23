import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { Download, Printer, Scale } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { FormField } from '@/components/form';
import { EmptyState, FilterBar, ListCard, SkeletonRows } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useAction } from '@/lib/use-action';
import {
  type OpeningCheck,
  type OpeningCheckRow,
  useOpeningCheck,
  useReportMutations,
} from './api';
import { DATE, save, sides } from './report-helpers';

/** The balances by account, each account with its parties and its subtotal (ADR-0106 #5). */
function byAccount(rows: readonly OpeningCheckRow[]) {
  const accounts = new Map<string, { code: string; name: string; rows: OpeningCheckRow[] }>();
  for (const row of rows) {
    const account = accounts.get(row.accountCode) ?? {
      code: row.accountCode,
      name: row.accountName,
      rows: [],
    };
    account.rows.push(row);
    accounts.set(row.accountCode, account);
  }
  return [...accounts.values()].map((account) => ({
    ...account,
    parties: account.rows.some((row) => row.partyKind !== null),
    balance: account.rows
      .reduce((total, row) => total.plus(row.balance), new Decimal(0))
      .toFixed(2),
  }));
}

function OpeningCheckTable({ report }: { report: OpeningCheck }) {
  const { t } = useTranslation();
  const columns = 'finance.reports.openingCheck.columns';
  const amounts = (balance: string) =>
    sides(balance).map((value, index) => (
      <TableCell key={index} className="text-right font-mono">
        {value}
      </TableCell>
    ));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${columns}.accountCode`)}</TableHead>
          <TableHead>{t(`${columns}.partyCode`)}</TableHead>
          <TableHead>{t(`${columns}.partyName`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.debit`)}</TableHead>
          <TableHead className="text-right">{t(`${columns}.credit`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {byAccount(report.data).map((account) => (
          <Fragment key={account.code}>
            <TableRow className="bg-muted/40">
              <TableCell className="font-mono font-semibold">{account.code}</TableCell>
              <TableCell colSpan={2} className="font-semibold">
                {account.name}
              </TableCell>
              {account.parties ? <TableCell colSpan={2} /> : amounts(account.balance)}
            </TableRow>
            {account.parties
              ? account.rows.map((row, index) => (
                  <TableRow key={`${row.accountCode}:${index}`}>
                    <TableCell />
                    <TableCell className="font-mono">{row.partyCode}</TableCell>
                    <TableCell>
                      {row.partyName ?? t('finance.reports.openingCheck.noParty')}
                    </TableCell>
                    {amounts(row.balance)}
                  </TableRow>
                ))
              : null}
            {account.parties ? (
              <TableRow>
                <TableCell />
                <TableCell colSpan={2} className="font-medium">
                  {t('finance.reports.openingCheck.subtotal', { account: account.code })}
                </TableCell>
                {amounts(account.balance)}
              </TableRow>
            ) : null}
          </Fragment>
        ))}
        <TableRow className="font-semibold">
          <TableCell />
          <TableCell colSpan={2}>{t(`${columns}.total`)}</TableCell>
          <TableCell className="text-right font-mono">{formatMnt(report.debit)}</TableCell>
          <TableCell className="text-right font-mono">{formatMnt(report.credit)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

/**
 * «Санхүү → Эхний үлдэгдлийн тулгалт» (ADR-0106 #5): every balance per account × party at the
 * opening's date, compared with Erkhet's closing trial balance and signed on paper.
 */
export function OpeningCheckPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const asked = search.get('date');
  const report = useOpeningCheck(asked && DATE.test(asked) ? asked : null);
  const date = report.data?.date ?? asked ?? '';
  const mutations = useReportMutations();
  const action = useAction();
  return (
    <div>
      <PageHeader
        title={t('finance.reports.openingCheck.title')}
        description={t('finance.reports.openingCheck.description')}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!DATE.test(date) || mutations.openingCheckXlsx.isPending}
              onClick={() =>
                void action.run(async () =>
                  save(
                    await mutations.openingCheckXlsx.mutateAsync(date),
                    `opening-check-${date}.xlsx`,
                  ),
                )
              }
            >
              <Download />
              {t('finance.reports.excel')}
            </Button>
            <Button asChild variant="outline">
              <Link to={`/finance/opening-check/print?date=${date}&format=a4`} target="_blank">
                <Printer />
                {t('finance.reports.print')}
              </Link>
            </Button>
          </>
        }
      />
      <FilterBar>
        <FormField label={t('finance.reports.openingCheck.date')} htmlFor="oc-date">
          <Input
            id="oc-date"
            type="date"
            className="sm:w-44"
            value={date}
            max={businessDate()}
            onChange={(event) =>
              setSearch(
                event.target.value ? new URLSearchParams({ date: event.target.value }) : {},
                { replace: true },
              )
            }
          />
        </FormField>
        {report.data ? (
          <p className="self-end pb-1.5 text-[13px] text-muted-foreground">
            {report.data.opening
              ? t('finance.reports.openingCheck.opening', report.data.opening)
              : t('finance.reports.openingCheck.noOpening')}
          </p>
        ) : null}
      </FilterBar>
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      <ListCard scroll>
        {report.isPending ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={5} />
            </TableBody>
          </Table>
        ) : report.data && report.data.data.length > 0 ? (
          <OpeningCheckTable report={report.data} />
        ) : (
          <EmptyState icon={Scale} title={t('finance.reports.openingCheck.empty')} />
        )}
      </ListCard>
    </div>
  );
}

const SIGNERS = ['signAccountant', 'signOwner'] as const;

/** The sign-off on paper (`/finance/opening-check/print?date`), with the two signature lines. */
export function OpeningCheckPrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const asked = search.get('date');
  const report = useOpeningCheck(asked && DATE.test(asked) ? asked : null);
  const company = useCompanyName();
  const title = `${t('finance.reports.openingCheck.title')} ${report.data?.date ?? ''}`;
  return (
    <PrintFrame ready={report.data !== undefined} error={report.error} title={title}>
      {() =>
        report.data ? (
          <div className="flex flex-col gap-3 text-[12px]">
            <div>
              <p className="text-[13px] font-semibold">{company}</p>
              <h1 className="text-[16px] font-semibold">{title}</h1>
            </div>
            <OpeningCheckTable report={report.data} />
            <p>{t('finance.reports.openingCheck.statement', { date: report.data.date })}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead />
                  <TableHead>{t('finance.reports.openingCheck.name')}</TableHead>
                  <TableHead>{t('finance.reports.openingCheck.signature')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SIGNERS.map((key) => (
                  <TableRow key={key} className="h-10">
                    <TableCell className="font-medium">
                      {t(`finance.reports.openingCheck.${key}`)}
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
