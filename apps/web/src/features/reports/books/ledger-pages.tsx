import { Landmark, Wallet } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FormField } from '@/components/form';
import { CustomerPicker, type PickedCustomer } from '@/features/partners/customer-picker';
import { SupplierPicker, type PickedSupplier } from '@/features/partners/supplier-picker';
import { saveBlob } from '@/lib/download';
import { problemFromError } from '@/lib/problem';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import {
  type LedgerKind,
  type LedgerLine,
  type LedgerQuery,
  type LedgerRow,
  useBookDownloads,
  useBookOptions,
  useLedgerAccounts,
  useLedgerLines,
  useLedgerReport,
} from './book-api';
import { addMoney, amount, BOOK_TABLE, NUM, type Precision, sidesOf } from './book-format';
import {
  BookActions,
  BookSheet,
  DateFields,
  DetailRow,
  DrillMark,
  DrillRow,
  MultiPick,
  NoteRow,
  PickedField,
  PrecisionField,
  PromptDialog,
  SelectField,
} from './book-kit';
import { ledgerLineHref } from './book-links';
import { idParamOf, idsParam, useBookParams, useDrill, usePromptDates } from './book-state';

type Grouping = 'ACCOUNT_PARTY' | 'PARTY_ACCOUNT';
const GROUPINGS: readonly Grouping[] = ['ACCOUNT_PARTY', 'PARTY_ACCOUNT'];
const PARTY_CONTROLS = ['RECEIVABLE', 'PAYABLE', 'ADVANCE_RECEIVED', 'ADVANCE_PAID'];

/** The query of a ledger report from the address, or null until the prompt was answered. */
function useLedgerQuery(kind: LedgerKind) {
  const params = useBookParams();
  const { search } = params;
  const query = useMemo<LedgerQuery | null>(() => {
    if (!params.ready) return null;
    const accountIds = idsParam(search, 'a');
    const groupCodes = search.getAll('g');
    const customerId = idParamOf(search, 'c');
    const supplierId = idParamOf(search, 's');
    return {
      kind,
      from: params.from,
      to: params.to,
      ...(accountIds.length ? { accountIds } : {}),
      ...(groupCodes.length ? { groupCodes } : {}),
      ...(customerId ? { customerIds: [customerId] } : {}),
      ...(supplierId ? { supplierIds: [supplierId] } : {}),
      ...(idParamOf(search, 'cc') ? { customerCategoryId: idParamOf(search, 'cc') } : {}),
      ...(search.get('d') ? { description: search.get('d') ?? '' } : {}),
      ...(search.get('x') ? { counterAccount: search.get('x') ?? '' } : {}),
      ...(search.get('e') === '1' ? { withEmpty: true } : {}),
    };
  }, [kind, params.ready, params.from, params.to, search]);
  const grouping: Grouping =
    search.get('by') === 'PARTY_ACCOUNT' ? 'PARTY_ACCOUNT' : 'ACCOUNT_PARTY';
  return { ...params, query, grouping };
}

/** «Тайлан → Авлага өглөгийн тайлан» (ADR-0133). */
export function PartyLedgerPage() {
  return <LedgerPage kind="PARTY" />;
}

/** «Тайлан → Мөнгөн хөрөнгийн тайлан» (ADR-0133). */
export function MoneyLedgerPage() {
  return <LedgerPage kind="MONEY" />;
}

function LedgerPage({ kind }: { kind: LedgerKind }) {
  const { t } = useTranslation();
  const state = useLedgerQuery(kind);
  const [prompting, setPrompting] = useState(!state.ready);
  const report = useLedgerReport(state.query);
  const downloads = useBookDownloads();
  const action = useAction();
  const accounts = useLedgerAccounts();
  const options = useBookOptions();
  const title = t(`reports.ledger.titles.${kind}`);
  const filters = describe(state, accounts.data ?? [], options.data?.customerCategories ?? []);
  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={title}
          description={t(`reports.ledger.descriptions.${kind}`)}
          actions={
            <BookActions
              ready={state.query !== null}
              onPrompt={() => setPrompting(true)}
              excelPending={downloads.ledger.isPending}
              onExcel={() => {
                const query = state.query;
                if (!query) return;
                void action.run(async () =>
                  saveBlob(
                    await downloads.ledger.mutateAsync(query),
                    `${kind === 'PARTY' ? 'avlaga-oglog' : 'mongon-hurungu'}-${query.from}-${query.to}.xlsx`,
                  ),
                );
              }}
            />
          }
        />
      </div>
      <LedgerPrompt
        kind={kind}
        open={prompting}
        onOpenChange={setPrompting}
        state={state}
        title={title}
      />
      <ProblemAlert problem={action.problem ?? problemFromError(report.error)} />
      {state.query && report.data ? (
        <BookSheet title={title} from={state.query.from} to={state.query.to} filters={filters}>
          {kind === 'PARTY' ? (
            <PartyTable
              rows={report.data.data}
              totals={report.data}
              grouping={state.grouping}
              query={state.query}
              precision={state.precision}
            />
          ) : (
            <MoneyTable
              rows={report.data.data}
              totals={report.data}
              query={state.query}
              precision={state.precision}
            />
          )}
        </BookSheet>
      ) : !state.query ? (
        <EmptyState
          icon={kind === 'PARTY' ? Landmark : Wallet}
          title={t('reports.prompt.waiting')}
        />
      ) : null}
    </div>
  );
}

/** The conditions above the table, as Erkhet prints them. */
function describe(
  state: ReturnType<typeof useLedgerQuery>,
  accounts: readonly { accountId: number; code: string; name: string }[],
  categories: readonly { id: number; name: string }[],
): string[] {
  const { search } = state;
  const out: string[] = [];
  const accountIds = idsParam(search, 'a');
  if (accountIds.length) {
    out.push(
      accountIds
        .map((id) => accounts.find((a) => a.accountId === id))
        .filter((a) => a !== undefined)
        .map((a) => `${a.code} - ${a.name}`)
        .join(', '),
    );
  }
  const groups = search.getAll('g');
  if (groups.length) out.push(groups.join(', '));
  const category = categories.find((c) => c.id === idParamOf(search, 'cc'));
  if (category) out.push(category.name);
  for (const key of ['cn', 'sn', 'd', 'x']) {
    const value = search.get(key);
    if (value) out.push(value);
  }
  return out;
}

function LedgerPrompt(props: {
  kind: LedgerKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReturnType<typeof useLedgerQuery>;
  title: string;
}) {
  const { t } = useTranslation();
  const { search } = props.state;
  const accounts = useLedgerAccounts();
  const options = useBookOptions();
  const dates = usePromptDates(props.state.from, props.state.to);
  const [groupCodes, setGroupCodes] = useState<string[]>(search.getAll('g'));
  const [accountIds, setAccountIds] = useState<string[]>(search.getAll('a'));
  const [categoryId, setCategoryId] = useState(search.get('cc') ?? '');
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [customerLabel, setCustomerLabel] = useState(search.get('cn'));
  const [supplier, setSupplier] = useState<PickedSupplier | null>(null);
  const [supplierLabel, setSupplierLabel] = useState(search.get('sn'));
  const [withEmpty, setWithEmpty] = useState(search.get('e') === '1');
  const [description, setDescription] = useState(search.get('d') ?? '');
  const [counter, setCounter] = useState(search.get('x') ?? '');
  const [grouping, setGrouping] = useState<Grouping>(props.state.grouping);
  const [precision, setPrecision] = useState<Precision>(props.state.precision);

  // Opening the prompt again starts from what the report shows.
  useEffect(() => {
    if (!props.open) return;
    setGroupCodes(search.getAll('g'));
    setAccountIds(search.getAll('a'));
    setCategoryId(search.get('cc') ?? '');
    setCustomer(null);
    setCustomerLabel(search.get('cn'));
    setSupplier(null);
    setSupplierLabel(search.get('sn'));
    setWithEmpty(search.get('e') === '1');
    setDescription(search.get('d') ?? '');
    setCounter(search.get('x') ?? '');
  }, [props.open, search]);

  const own = (accounts.data ?? []).filter((account) =>
    props.kind === 'MONEY' ? account.control === 'MONEY' : PARTY_CONTROLS.includes(account.control),
  );
  const groupOptions = [
    ...new Map(
      (accounts.data ?? [])
        .filter((account) => account.groupCode !== null)
        .map((account) => [
          account.groupCode ?? '',
          { value: account.groupCode ?? '', label: `${account.groupCode} - ${account.groupName}` },
        ]),
    ).values(),
  ];
  const customerId = customer?.id ?? (customerLabel ? idParamOf(search, 'c') : undefined);
  const supplierId = supplier?.id ?? (supplierLabel ? idParamOf(search, 's') : undefined);
  const submit = () => {
    props.state.apply({
      from: dates.start,
      to: dates.end,
      p: precision === '2' ? null : precision,
      g: props.kind === 'PARTY' ? groupCodes : null,
      a: accountIds,
      cc: props.kind === 'PARTY' ? categoryId : null,
      c: customerId,
      cn: customerId ? (customer ? `${customer.name} · ${customer.code}` : customerLabel) : null,
      s: supplierId,
      sn: supplierId ? (supplier ? `${supplier.name} · ${supplier.code}` : supplierLabel) : null,
      e: withEmpty ? '1' : null,
      d: description.trim(),
      x: counter.trim(),
      by: props.kind === 'PARTY' && grouping !== 'ACCOUNT_PARTY' ? grouping : null,
    });
    props.onOpenChange(false);
  };
  return (
    <PromptDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      valid={dates.valid}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-4">
        {props.kind === 'PARTY' ? (
          <MultiPick
            label={t('reports.ledger.prompt.accountGroups')}
            options={groupOptions}
            values={groupCodes}
            onChange={setGroupCodes}
          />
        ) : null}
        <MultiPick
          label={t('reports.ledger.prompt.accounts')}
          options={(props.kind === 'PARTY' && groupCodes.length > 0
            ? (accounts.data ?? []).filter((a) => groupCodes.includes(a.groupCode ?? ''))
            : own
          ).map((account) => ({
            value: String(account.accountId),
            label: `${account.code} - ${account.name}`,
            keys: [account.code],
          }))}
          values={accountIds}
          onChange={setAccountIds}
        />
        {props.kind === 'PARTY' && options.data ? (
          <SelectField
            id="book-customer-category"
            label={t('reports.ledger.prompt.customerCategory')}
            value={categoryId}
            options={options.data.customerCategories.map((c) => ({
              value: String(c.id),
              label: c.name,
            }))}
            onChange={setCategoryId}
          />
        ) : null}
        <PickedField
          label={t('reports.ledger.prompt.customer')}
          htmlFor="book-customer"
          picked={customer ? `${customer.name} · ${customer.code}` : customerLabel}
          onClear={() => {
            setCustomer(null);
            setCustomerLabel(null);
          }}
        >
          <CustomerPicker id="book-customer" value={customer} onChange={setCustomer} searchFirst />
        </PickedField>
        <PickedField
          label={t('reports.ledger.prompt.supplier')}
          htmlFor="book-supplier"
          picked={supplier ? `${supplier.name} · ${supplier.code}` : supplierLabel}
          onClear={() => {
            setSupplier(null);
            setSupplierLabel(null);
          }}
        >
          <SupplierPicker id="book-supplier" value={supplier} onChange={setSupplier} floating />
        </PickedField>
        <div className="flex items-center gap-2">
          <Checkbox
            id="book-with-empty"
            checked={withEmpty}
            onCheckedChange={(value) => setWithEmpty(value === true)}
          />
          <Label htmlFor="book-with-empty">{t('reports.ledger.prompt.withEmpty')}</Label>
        </div>
        <FormField label={t('reports.ledger.prompt.description')} htmlFor="book-description">
          <Input
            id="book-description"
            value={description}
            maxLength={100}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('reports.ledger.prompt.counterAccount')}
          htmlFor="book-counter"
          hint={t('reports.ledger.prompt.counterAccountHint')}
        >
          <Input
            id="book-counter"
            value={counter}
            maxLength={32}
            inputMode="numeric"
            onChange={(event) => setCounter(event.target.value.replace(/[^0-9A-Za-z.-]/g, ''))}
          />
        </FormField>
      </div>
      <div className="flex flex-col gap-4">
        <PrecisionField value={precision} onChange={setPrecision} />
        {props.kind === 'PARTY' ? (
          <SelectField
            id="book-grouping"
            label={t('reports.ledger.prompt.grouping')}
            value={grouping}
            emptyLabel=""
            options={GROUPINGS.map((value) => ({
              value,
              label: t(`reports.ledger.prompt.groupings.${value}`),
            }))}
            onChange={(value) => setGrouping(value === 'PARTY_ACCOUNT' ? value : 'ACCOUNT_PARTY')}
          />
        ) : null}
        <DateFields {...dates} />
      </div>
    </PromptDialog>
  );
}

interface Totals {
  opening: string;
  debit: string;
  credit: string;
  closing: string;
}

function sumOf(rows: readonly LedgerRow[]): Totals {
  return rows.reduce<Totals>(
    (sum, row) => ({
      opening: addMoney(sum.opening, row.opening) ?? '0',
      debit: addMoney(sum.debit, row.debit) ?? '0',
      credit: addMoney(sum.credit, row.credit) ?? '0',
      closing: addMoney(sum.closing, row.closing) ?? '0',
    }),
    { opening: '0', debit: '0', credit: '0', closing: '0' },
  );
}

/** Opening D, opening C, debit, credit, closing D, closing C. */
function SixCells(props: { totals: Totals; precision: Precision; zero?: string }) {
  const opening = sidesOf(props.totals.opening);
  const closing = sidesOf(props.totals.closing);
  const cell = (value: string) => (
    <TableCell className={NUM}>{amount(value, props.precision, props.zero)}</TableCell>
  );
  return (
    <>
      {cell(opening.debit)}
      {cell(opening.credit)}
      {cell(props.totals.debit)}
      {cell(props.totals.credit)}
      {cell(closing.debit)}
      {cell(closing.credit)}
    </>
  );
}

function SixHead() {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <TableHead rowSpan={2} className="w-28 text-center">
          {t('reports.ledger.table.code')}
        </TableHead>
        <TableHead rowSpan={2} className="text-center">
          {t('reports.ledger.table.name')}
        </TableHead>
        <TableHead colSpan={2} className="text-center">
          {t('reports.ledger.table.opening')}
        </TableHead>
        <TableHead colSpan={2} className="text-center">
          {t('reports.ledger.table.turnover')}
        </TableHead>
        <TableHead colSpan={2} className="text-center">
          {t('reports.ledger.table.closing')}
        </TableHead>
      </TableRow>
      <TableRow>
        {['opening', 'turnover', 'closing'].flatMap((group) => [
          <TableHead key={`${group}-d`} className="text-right">
            {t('reports.ledger.table.debit')}
          </TableHead>,
          <TableHead key={`${group}-c`} className="text-right">
            {t('reports.ledger.table.credit')}
          </TableHead>,
        ])}
      </TableRow>
    </TableHeader>
  );
}

/** «Авлага өглөгийн тайлан»: groups of account (or party), their rows, the lines on a double click. */
function PartyTable(props: {
  rows: readonly LedgerRow[];
  totals: Totals;
  grouping: Grouping;
  query: LedgerQuery;
  precision: Precision;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const byAccount = props.grouping === 'ACCOUNT_PARTY';
  const groups = useMemo(() => {
    const map = new Map<string, LedgerRow[]>();
    for (const row of props.rows) {
      const key = byAccount ? String(row.accountId) : (row.party?.partyId ?? 'none');
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [props.rows, byAccount]);
  if (props.rows.length === 0) {
    return <EmptyState icon={Landmark} title={t('reports.prompt.empty')} />;
  }
  return (
    <Table className={BOOK_TABLE}>
      <SixHead />
      <TableBody>
        {groups.map(([key, rows]) => {
          const first = rows[0];
          if (!first) return null;
          const head = byAccount
            ? { code: first.code, name: first.name }
            : {
                code: first.party?.code ?? '',
                name: first.party?.name ?? t('reports.ledger.table.noParty'),
              };
          return (
            <Fragment key={key}>
              <TableRow className="bg-muted/30 font-semibold">
                <TableCell>{head.code}</TableCell>
                <TableCell>{head.name}</TableCell>
                <SixCells totals={sumOf(rows)} precision={props.precision} zero="0" />
              </TableRow>
              {rows.map((row) => {
                const rowKey = `${row.accountId}:${row.party?.partyId ?? 'none'}`;
                const expanded = drill.open.has(rowKey);
                const label = byAccount
                  ? {
                      code: row.party?.code ?? '',
                      name: row.party?.name ?? t('reports.ledger.table.noParty'),
                    }
                  : { code: row.code, name: row.name };
                return (
                  <Fragment key={rowKey}>
                    <DrillRow expanded={expanded} onToggle={() => drill.toggle(rowKey)}>
                      <TableCell className="text-center">
                        <DrillMark expanded={expanded} />
                        {label.code}
                      </TableCell>
                      <TableCell>{label.name}</TableCell>
                      <SixCells totals={row} precision={props.precision} />
                    </DrillRow>
                    {expanded ? (
                      <LedgerDetail
                        kind="PARTY"
                        query={props.query}
                        accountId={row.accountId}
                        partyId={row.party?.partyId ?? 'none'}
                        precision={props.precision}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
        <TableRow className="font-semibold">
          <TableCell />
          <TableCell className="text-right">{t('reports.prompt.total')}</TableCell>
          <SixCells totals={props.totals} precision={props.precision} zero="0" />
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** «Мөнгөн хөрөнгийн тайлан»: one row per cash or bank account, its lines on a double click. */
function MoneyTable(props: {
  rows: readonly LedgerRow[];
  totals: Totals;
  query: LedgerQuery;
  precision: Precision;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  if (props.rows.length === 0) {
    return <EmptyState icon={Wallet} title={t('reports.prompt.empty')} />;
  }
  const cells = (totals: Totals, zero?: string) =>
    [totals.opening, totals.debit, totals.credit, totals.closing].map((value, index) => (
      <TableCell key={index} className={NUM}>
        {amount(value, props.precision, zero)}
      </TableCell>
    ));
  return (
    <Table className={BOOK_TABLE}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28 text-center">{t('reports.ledger.table.code')}</TableHead>
          <TableHead className="text-center">{t('reports.ledger.table.name')}</TableHead>
          <TableHead className="text-right">{t('reports.ledger.table.opening')}</TableHead>
          <TableHead className="text-right">{t('reports.ledger.table.in')}</TableHead>
          <TableHead className="text-right">{t('reports.ledger.table.out')}</TableHead>
          <TableHead className="text-right">{t('reports.ledger.table.closing')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.rows.map((row) => {
          const key = String(row.accountId);
          const expanded = drill.open.has(key);
          return (
            <Fragment key={key}>
              <DrillRow expanded={expanded} onToggle={() => drill.toggle(key)}>
                <TableCell className="text-center">
                  <DrillMark expanded={expanded} />
                  {row.code}
                </TableCell>
                <TableCell>{row.name}</TableCell>
                {cells(row, '0')}
              </DrillRow>
              {expanded ? (
                <LedgerDetail
                  kind="MONEY"
                  query={props.query}
                  accountId={row.accountId}
                  precision={props.precision}
                />
              ) : null}
            </Fragment>
          );
        })}
        <TableRow className="font-semibold">
          <TableCell />
          <TableCell className="text-right">{t('reports.prompt.total')}</TableCell>
          {cells(props.totals, '0')}
        </TableRow>
      </TableBody>
    </Table>
  );
}

/** The journal lines behind a row, Erkhet's italic lines; a click opens the document. */
function LedgerDetail(props: {
  kind: LedgerKind;
  query: LedgerQuery;
  accountId: number;
  partyId?: string;
  precision: Precision;
}) {
  const { t } = useTranslation();
  const lines = useLedgerLines(props.query, {
    accountId: props.accountId,
    ...(props.partyId ? { partyId: props.partyId } : {}),
  });
  const span = props.kind === 'PARTY' ? 8 : 6;
  if (lines.isPending) return <NoteRow colSpan={span}>{t('reports.prompt.loadingLines')}</NoteRow>;
  if (lines.error) {
    return (
      <NoteRow colSpan={span}>
        <ProblemAlert problem={problemFromError(lines.error)} />
      </NoteRow>
    );
  }
  if (lines.data.data.length === 0) {
    return <NoteRow colSpan={span}>{t('reports.prompt.noLines')}</NoteRow>;
  }
  const counters = (line: LedgerLine) =>
    line.counters
      .map((counter) =>
        counter.startsWith('D:')
          ? t('reports.ledger.table.counterDebit', { code: counter.slice(2) })
          : t('reports.ledger.table.counterCredit', { code: counter.slice(2) }),
      )
      .join(', ');
  return (
    <>
      {lines.data.data.map((line) => {
        const text = [
          `#${line.documentNumber ?? line.entryNumber}`,
          line.entryDate,
          line.lineDescription ?? line.entryDescription,
          ...(props.kind === 'MONEY' && line.party ? [line.party.name] : []),
        ].join(' - ');
        const balance = sidesOf(line.balanceAfter);
        return (
          <DetailRow key={line.lineId} href={ledgerLineHref(line)} label={text}>
            <TableCell colSpan={2} className="text-right">
              {text}
            </TableCell>
            <TableCell colSpan={props.kind === 'PARTY' ? 2 : 1} className="text-right">
              {counters(line)}
            </TableCell>
            <TableCell className={NUM}>{amount(line.debit, props.precision, '0')}</TableCell>
            <TableCell className={NUM}>{amount(line.credit, props.precision, '0')}</TableCell>
            {props.kind === 'PARTY' ? (
              <>
                <TableCell className={NUM}>{amount(balance.debit, props.precision, '0')}</TableCell>
                <TableCell className={NUM}>
                  {amount(balance.credit, props.precision, '0')}
                </TableCell>
              </>
            ) : (
              <TableCell className={cn(NUM)}>
                {amount(line.balanceAfter, props.precision, '0')}
              </TableCell>
            )}
          </DetailRow>
        );
      })}
      {lines.data.truncated ? (
        <NoteRow colSpan={span}>{t('reports.prompt.truncated')}</NoteRow>
      ) : null}
    </>
  );
}
