import { type components } from '@tugeel/api-client';
import {
  linkableRows,
  STATEMENT_KINDS,
  type StatementAccountKind,
  type StatementKind,
} from '@tugeel/shared/finance';
import type mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileChartColumn, Printer } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { EmptyState, FilterBar, ListCard, SegmentedControl, SkeletonRows } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { PrintFrame } from '@/components/print-frame';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { problemFromError, unwrap } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { DATE, save } from './report-helpers';

type Statement = components['schemas']['Statement'];
type StatementRow = components['schemas']['StatementRow'];
type RowCode = keyof (typeof mn)['finance']['statements']['rows'];

const SLUG: Record<StatementKind, 'balance' | 'income'> = { BALANCE: 'balance', INCOME: 'income' };
const KEY = ['finance', 'statements'] as const;
const yearStart = (): string => `${businessDate().slice(0, 4)}-01-01`;
const isKind = (value: string | null): value is StatementKind =>
  STATEMENT_KINDS.some((kind) => kind === value);

function useStatement(query: { kind: StatementKind; from: string; to: string } | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEY, query],
    enabled: query !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/finance/reports/statements/{kind}', {
          params: {
            path: { kind: SLUG[query?.kind ?? 'BALANCE'] },
            query: { from: query?.from ?? '', to: query?.to ?? '' },
          },
          signal,
        }),
      ),
  });
}

function useStatementActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    link: useMutation({
      mutationFn: async (input: { accountId: number; rowCode: string | null }) =>
        unwrap(
          await api.PUT('/api/v1/finance/statement-links/{accountId}', {
            params: { path: { accountId: input.accountId } },
            body: { rowCode: input.rowCode },
          }),
        ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    }),
    xlsx: useMutation({
      mutationFn: async (query: { kind: StatementKind; from: string; to: string }): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/finance/reports/statements/{kind}/xlsx', {
            params: { path: { kind: SLUG[query.kind] }, query: { from: query.from, to: query.to } },
            parseAs: 'blob',
          }),
        ),
    }),
  };
}

const money = (value: string | null): string =>
  value === null ? '' : new Decimal(value).isZero() ? '–' : formatMnt(value);

/**
 * The form's rows, a heading and a total in bold; with `accounts` each row's accounts are listed
 * under it, and whoever keeps the chart may move one to another row of its kind.
 */
function StatementTable(props: {
  statement: Statement;
  accounts: boolean;
  onLink?: ((accountId: number, rowCode: string | null) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { statement } = props;
  const balance = statement.kind === 'BALANCE';
  const name = (code: string) => t(`finance.statements.rows.${code as RowCode}`);
  const rowClass = (row: StatementRow) =>
    cn(
      row.type === 'HEADING' && 'bg-muted/40 font-semibold',
      row.type === 'TOTAL' && 'font-semibold',
      row.type === 'TOTAL' && row.level === 0 && 'border-t-2 border-border',
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">{t('finance.statements.columns.no')}</TableHead>
          <TableHead>{t('finance.statements.columns.row')}</TableHead>
          {balance ? (
            <TableHead className="w-44 text-right">
              {t('finance.statements.columns.opening')}
            </TableHead>
          ) : null}
          <TableHead className="w-44 text-right">
            {t(
              balance ? 'finance.statements.columns.closing' : 'finance.statements.columns.amount',
            )}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {statement.rows.map((row) => (
          <Fragment key={row.code}>
            <TableRow className={rowClass(row)}>
              <TableCell className="font-mono text-muted-foreground">{row.no}</TableCell>
              <TableCell style={{ paddingLeft: `${0.75 + row.level * 1.25}rem` }}>
                {name(row.code)}
              </TableCell>
              {balance ? (
                <TableCell className="text-right font-mono">{money(row.opening)}</TableCell>
              ) : null}
              <TableCell className="text-right font-mono">{money(row.amount)}</TableCell>
            </TableRow>
            {props.accounts
              ? row.accounts.map((account) => (
                  <TableRow key={account.accountId} className="text-[0.8125rem]">
                    <TableCell />
                    <TableCell style={{ paddingLeft: `${2 + row.level * 1.25}rem` }}>
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          className="font-mono text-link underline-offset-4 hover:underline"
                          to={`/finance/accounts/${account.accountId}`}
                        >
                          {account.code}
                        </Link>
                        <span className="text-muted-foreground">{account.name}</span>
                        {account.linked ? (
                          <Badge variant="outline">{t('finance.statements.linked')}</Badge>
                        ) : null}
                        {props.onLink ? (
                          <RowSelect
                            kind={account.kind}
                            label={t('finance.statements.rowOf', {
                              code: account.code,
                              name: account.name,
                            })}
                            value={account.linked ? row.code : ''}
                            onChange={(rowCode) => props.onLink?.(account.accountId, rowCode)}
                          />
                        ) : null}
                      </span>
                    </TableCell>
                    {balance ? (
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {money(account.opening)}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {money(account.amount)}
                    </TableCell>
                  </TableRow>
                ))
              : null}
            {props.accounts && row.result && !new Decimal(row.result.amount).isZero() ? (
              <TableRow className="text-[0.8125rem] text-muted-foreground">
                <TableCell />
                <TableCell colSpan={balance ? 3 : 2} style={{ paddingLeft: '2rem' }}>
                  {t('finance.statements.resultNote', { amount: formatMnt(row.result.amount) })}
                </TableCell>
              </TableRow>
            ) : null}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

/** The rows an account of this kind may sit on; empty = the default row by its code. */
function RowSelect(props: {
  kind: StatementAccountKind;
  label: string;
  value: string;
  onChange: (rowCode: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <NativeSelect
      variant="filter"
      className="ml-auto max-w-72 print:hidden"
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">{t('finance.statements.defaultRow')}</option>
      {linkableRows(props.kind).map((row) => (
        <option key={row.code} value={row.code}>
          {`${row.no} ${t(`finance.statements.rows.${row.code as RowCode}`)}`}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * «Санхүү → Санхүүгийн тайлан» (ADR-0184): СТ-1 and СТ-2 of any dates from the journal, on screen,
 * in Excel and in print. «Дансаар задлах» lists each row's accounts; the accountant moves an
 * account to another row there, and the statement is read again.
 */
export function StatementsPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const canLink = useHasPermission('finance.journal.manage');
  const kindParam = search.get('kind');
  const kind: StatementKind = isKind(kindParam) ? kindParam : 'BALANCE';
  const from = search.get('from') ?? yearStart();
  const to = search.get('to') ?? businessDate();
  const accounts = search.get('accounts') === '1';
  const valid = DATE.test(from) && DATE.test(to) && from <= to;
  const statement = useStatement(valid ? { kind, from, to } : null);
  const actions = useStatementActions();
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
  const difference = statement.data?.difference ?? null;
  const balanced =
    difference === null ||
    (new Decimal(difference.amount).isZero() && new Decimal(difference.opening).isZero());
  return (
    <div>
      <PageHeader
        title={t('finance.statements.title')}
        description={t('finance.statements.hint')}
        actions={
          <>
            <Button
              variant="outline"
              disabled={!valid || actions.xlsx.isPending}
              onClick={() =>
                void action.run(async () =>
                  save(
                    await actions.xlsx.mutateAsync({ kind, from, to }),
                    `${SLUG[kind]}-${from}-${to}.xlsx`,
                  ),
                )
              }
            >
              <Download />
              {t('finance.statements.excel')}
            </Button>
            <Button asChild variant="outline">
              <Link
                to={`/finance/statements/print?kind=${kind}&from=${from}&to=${to}&format=a4`}
                target="_blank"
              >
                <Printer />
                {t('finance.statements.print')}
              </Link>
            </Button>
          </>
        }
      />
      <FilterBar>
        <div className="self-end pb-0.5">
          <SegmentedControl
            options={STATEMENT_KINDS}
            value={kind}
            label={(value) => t(`finance.statements.tabs.${value}`)}
            onChange={(value) => set('kind', value === 'BALANCE' ? null : value)}
          />
        </div>
        <FormField label={t('finance.statements.from')} htmlFor="statement-from">
          <DateInput
            id="statement-from"
            className="sm:w-44"
            value={from}
            max={to}
            onChange={(value) => set('from', value)}
          />
        </FormField>
        <FormField label={t('finance.statements.to')} htmlFor="statement-to">
          <DateInput
            id="statement-to"
            className="sm:w-44"
            value={to}
            min={from}
            onChange={(value) => set('to', value)}
          />
        </FormField>
        <div className="flex items-center gap-2 self-end pb-1.5">
          <Switch
            id="statement-accounts"
            checked={accounts}
            onCheckedChange={(checked) => set('accounts', checked ? '1' : null)}
          />
          <Label htmlFor="statement-accounts">{t('finance.statements.showAccounts')}</Label>
        </div>
        {difference ? (
          <Badge variant={balanced ? 'success' : 'destructive'} className="self-end">
            {balanced
              ? t('finance.statements.balanced')
              : t('finance.statements.notBalanced', { amount: formatMnt(difference.amount) })}
          </Badge>
        ) : null}
      </FilterBar>
      <ProblemAlert
        problem={
          action.problem ??
          problemFromError(statement.error) ??
          problemFromError(actions.link.error)
        }
      />
      <ListCard scroll>
        {statement.isPending && valid ? (
          <Table>
            <TableBody>
              <SkeletonRows columns={4} />
            </TableBody>
          </Table>
        ) : statement.data ? (
          <StatementTable
            statement={statement.data}
            accounts={accounts}
            onLink={
              canLink
                ? (accountId, rowCode) => actions.link.mutate({ accountId, rowCode })
                : undefined
            }
          />
        ) : (
          <EmptyState icon={FileChartColumn} title={t('finance.statements.title')} />
        )}
      </ListCard>
    </div>
  );
}

/** A statement on paper (`/finance/statements/print?kind&from&to`), with the signature lines. */
export function StatementPrintPage() {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const kindParam = search.get('kind');
  const kind: StatementKind = isKind(kindParam) ? kindParam : 'BALANCE';
  const from = search.get('from') ?? yearStart();
  const to = search.get('to') ?? businessDate();
  const statement = useStatement(DATE.test(from) && DATE.test(to) ? { kind, from, to } : null);
  const company = useCompanyName();
  const title = `${t(`finance.statements.kinds.${kind}`)} ${from} – ${to}`;
  return (
    <PrintFrame ready={statement.data !== undefined} error={statement.error} title={title}>
      {() =>
        statement.data ? (
          <div className="flex flex-col gap-3 text-[0.75rem]">
            <div>
              <p className="text-[0.8125rem] font-semibold">{company}</p>
              <h1 className="text-[1rem] font-semibold">{title}</h1>
            </div>
            <StatementTable statement={statement.data} accounts={false} />
            <div className="mt-8 grid grid-cols-2 gap-8">
              {(['director', 'accountant'] as const).map((role) => (
                <div key={role} className="border-t border-foreground pt-1">
                  {t(`finance.statements.signatures.${role}`)}
                </div>
              ))}
            </div>
          </div>
        ) : null
      }
    </PrintFrame>
  );
}
