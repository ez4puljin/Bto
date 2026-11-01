import { Landmark, Wallet } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Input } from '@/components/ui/input';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import {
  addMoney,
  amount,
  type BookColumn,
  COL,
  detailParts,
  detailText,
  GROUP_END,
  isZero,
  NUM,
  type Precision,
  sidesOf,
  textColumn,
} from './book-format';
import {
  BookActions,
  BookBlank,
  BookPage,
  BookSheet,
  BookTable,
  CheckField,
  DetailLabel,
  DetailRow,
  DetailSkeleton,
  DrillCell,
  DrillRow,
  EmptyRow,
  GroupRow,
  MultiPick,
  NoteRow,
  PickedField,
  PrecisionField,
  PromptDialog,
  SelectField,
  SkeletonBody,
  TextCell,
  TotalRow,
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
  const columns = kind === 'PARTY' ? PARTY_COLUMNS : MONEY_COLUMNS;
  const openPrompt = () => setPrompting(true);
  const rows = report.data?.data ?? null;
  return (
    <BookPage columns={columns}>
      <div className="print:hidden">
        <PageHeader
          compact
          title={title}
          actions={
            <BookActions
              ready={state.query !== null && report.data !== undefined}
              period={state.query}
              onPrompt={openPrompt}
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
      {state.query && (report.data || report.isPending) ? (
        <BookSheet
          title={title}
          period={state.query}
          filters={filters}
          orientation="portrait"
          loading={!report.data}
        >
          {kind === 'PARTY' ? (
            <PartyTable
              rows={rows}
              totals={report.data ?? null}
              grouping={state.grouping}
              query={state.query}
              precision={state.precision}
              onPrompt={openPrompt}
            />
          ) : (
            <MoneyTable
              rows={rows}
              totals={report.data ?? null}
              query={state.query}
              precision={state.precision}
              onPrompt={openPrompt}
            />
          )}
        </BookSheet>
      ) : (
        <BookBlank
          title={title}
          icon={kind === 'PARTY' ? Landmark : Wallet}
          orientation="portrait"
          onPrompt={openPrompt}
        />
      )}
    </BookPage>
  );
}

/** Code, name, then opening, turnover and closing as debit / credit (portrait A4). */
const PARTY_COLUMNS: readonly BookColumn[] = [
  COL.code,
  textColumn(16),
  ...Array<BookColumn>(6).fill(COL.money),
];
/** Code, name, opening, in, out, closing (portrait A4). */
const MONEY_COLUMNS: readonly BookColumn[] = [
  COL.code,
  textColumn(19),
  ...Array<BookColumn>(4).fill(COL.money),
];

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
  const accountsField = (
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
  );
  const customerField = (
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
  );
  const supplierField = (
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
  );
  const descriptionField = (
    <FormField label={t('reports.ledger.prompt.description')} htmlFor="book-description">
      <Input
        id="book-description"
        value={description}
        maxLength={100}
        onChange={(event) => setDescription(event.target.value)}
      />
    </FormField>
  );
  const counterField = (
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
  );
  return (
    <PromptDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      valid={dates.valid}
      onSubmit={submit}
      dates={dates}
      filters={
        props.kind === 'PARTY' ? (
          <>
            <MultiPick
              label={t('reports.ledger.prompt.accountGroups')}
              options={groupOptions}
              values={groupCodes}
              onChange={setGroupCodes}
            />
            {accountsField}
            {options.data ? (
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
            {customerField}
            {supplierField}
            {descriptionField}
            {counterField}
          </>
        ) : (
          <>
            {accountsField}
            {descriptionField}
            {customerField}
            {supplierField}
            {counterField}
          </>
        )
      }
      view={
        <>
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
          <CheckField
            id="book-with-empty"
            label={t('reports.ledger.prompt.withEmpty')}
            checked={withEmpty}
            onChange={setWithEmpty}
          />
        </>
      }
    />
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

/** Whether a row moved in the period (so it has lines to open). */
const moved = (row: Totals) => !isZero(row.debit) || !isZero(row.credit);

/**
 * A balance as debit / credit: the side it falls on, «0» on the debit side when it is zero, so a
 * row is never blank.
 */
function BalanceCells(props: { balance: string; precision: Precision; groupEnd?: boolean }) {
  const sides = sidesOf(props.balance);
  return (
    <>
      <TableCell className={NUM}>
        {amount(sides.debit, props.precision, isZero(props.balance) ? '0' : '')}
      </TableCell>
      <TableCell className={cn(NUM, props.groupEnd && GROUP_END)}>
        {amount(sides.credit, props.precision)}
      </TableCell>
    </>
  );
}

/**
 * Opening D / C, debit, credit, closing D / C: the balances with «0» when zero, the turnover blank
 * when zero in a body row (`sum` writes «0», a group's or the total's).
 */
function SixCells(props: { totals: Totals; precision: Precision; sum?: boolean }) {
  const zero = props.sum ? '0' : '';
  return (
    <>
      <BalanceCells balance={props.totals.opening} precision={props.precision} groupEnd />
      <TableCell className={NUM}>{amount(props.totals.debit, props.precision, zero)}</TableCell>
      <TableCell className={cn(NUM, GROUP_END)}>
        {amount(props.totals.credit, props.precision, zero)}
      </TableCell>
      <BalanceCells balance={props.totals.closing} precision={props.precision} />
    </>
  );
}

function SixHead() {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <TableHead rowSpan={2}>{t('reports.ledger.table.code')}</TableHead>
        <TableHead rowSpan={2} className={GROUP_END}>
          {t('reports.ledger.table.name')}
        </TableHead>
        {(['opening', 'turnover', 'closing'] as const).map((group) => (
          <TableHead key={group} colSpan={2} className={cn('text-center', GROUP_END)}>
            {t(`reports.ledger.table.${group}`)}
          </TableHead>
        ))}
      </TableRow>
      <TableRow>
        {['opening', 'turnover', 'closing'].flatMap((group) => [
          <TableHead key={`${group}-d`} className="text-right">
            {t('reports.ledger.table.debit')}
          </TableHead>,
          <TableHead key={`${group}-c`} className={cn('text-right', GROUP_END)}>
            {t('reports.ledger.table.credit')}
          </TableHead>,
        ])}
      </TableRow>
    </TableHeader>
  );
}

/** «Авлага өглөгийн тайлан»: groups of account (or party), their rows, the lines on a double click. */
function PartyTable(props: {
  rows: readonly LedgerRow[] | null;
  totals: Totals | null;
  grouping: Grouping;
  query: LedgerQuery;
  precision: Precision;
  onPrompt: () => void;
}) {
  const { t } = useTranslation();
  const drill = useDrill();
  const byAccount = props.grouping === 'ACCOUNT_PARTY';
  const groups = useMemo(() => {
    const map = new Map<string, LedgerRow[]>();
    for (const row of props.rows ?? []) {
      const key = byAccount ? String(row.accountId) : (row.party?.partyId ?? 'none');
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()];
  }, [props.rows, byAccount]);
  if (props.rows === null || props.totals === null) {
    return (
      <BookTable columns={PARTY_COLUMNS}>
        <SixHead />
        <SkeletonBody columns={8} />
      </BookTable>
    );
  }
  if (props.rows.length === 0) {
    return (
      <BookTable columns={PARTY_COLUMNS}>
        <SixHead />
        <EmptyRow colSpan={8} onPrompt={props.onPrompt} />
      </BookTable>
    );
  }
  return (
    <BookTable columns={PARTY_COLUMNS}>
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
              <GroupRow>
                <TextCell text={head.code} />
                <TextCell text={head.name} className={GROUP_END} />
                <SixCells totals={sumOf(rows)} precision={props.precision} sum />
              </GroupRow>
              {rows.map((row) => {
                const rowKey = `${row.accountId}:${row.party?.partyId ?? 'none'}`;
                const expanded = drill.open.has(rowKey);
                const toggle = () => drill.toggle(rowKey);
                const drillable = moved(row);
                const label = byAccount
                  ? {
                      code: row.party?.code ?? '',
                      name: row.party?.name ?? t('reports.ledger.table.noParty'),
                    }
                  : { code: row.code, name: row.name };
                return (
                  <Fragment key={rowKey}>
                    <DrillRow expanded={expanded} onToggle={toggle} drillable={drillable}>
                      <DrillCell
                        expanded={expanded}
                        onToggle={toggle}
                        drillable={drillable}
                        text={label.code}
                        name={label.code || label.name}
                      />
                      <TextCell text={label.name} className={GROUP_END} />
                      <SixCells totals={row} precision={props.precision} />
                    </DrillRow>
                    {expanded && drillable ? (
                      <LedgerDetail
                        kind="PARTY"
                        query={props.query}
                        accountId={row.accountId}
                        partyId={row.party?.partyId ?? 'none'}
                        omit={[head.name, label.name]}
                        precision={props.precision}
                      />
                    ) : null}
                  </Fragment>
                );
              })}
            </Fragment>
          );
        })}
        <TotalRow labelSpan={2}>
          <SixCells totals={props.totals} precision={props.precision} sum />
        </TotalRow>
      </TableBody>
    </BookTable>
  );
}

function MoneyHead() {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <TableHead>{t('reports.ledger.table.code')}</TableHead>
        <TableHead className={GROUP_END}>{t('reports.ledger.table.name')}</TableHead>
        <TableHead className={cn('text-right', GROUP_END)}>
          {t('reports.ledger.table.opening')}
        </TableHead>
        <TableHead className="text-right">{t('reports.ledger.table.in')}</TableHead>
        <TableHead className={cn('text-right', GROUP_END)}>
          {t('reports.ledger.table.out')}
        </TableHead>
        <TableHead className="text-right">{t('reports.ledger.table.closing')}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** «Мөнгөн хөрөнгийн тайлан»: one row per cash or bank account, its lines on a double click. */
function MoneyTable(props: {
  rows: readonly LedgerRow[] | null;
  totals: Totals | null;
  query: LedgerQuery;
  precision: Precision;
  onPrompt: () => void;
}) {
  const drill = useDrill();
  if (props.rows === null || props.totals === null) {
    return (
      <BookTable columns={MONEY_COLUMNS}>
        <MoneyHead />
        <SkeletonBody columns={6} />
      </BookTable>
    );
  }
  if (props.rows.length === 0) {
    return (
      <BookTable columns={MONEY_COLUMNS}>
        <MoneyHead />
        <EmptyRow colSpan={6} onPrompt={props.onPrompt} />
      </BookTable>
    );
  }
  // The balances keep their «0»; the movement is blank when there was none (but «0» in the total).
  const cells = (totals: Totals, sum = false) => (
    <>
      <TableCell className={cn(NUM, GROUP_END)}>
        {amount(totals.opening, props.precision, '0')}
      </TableCell>
      <TableCell className={NUM}>{amount(totals.debit, props.precision, sum ? '0' : '')}</TableCell>
      <TableCell className={cn(NUM, GROUP_END)}>
        {amount(totals.credit, props.precision, sum ? '0' : '')}
      </TableCell>
      <TableCell className={NUM}>{amount(totals.closing, props.precision, '0')}</TableCell>
    </>
  );
  return (
    <BookTable columns={MONEY_COLUMNS}>
      <MoneyHead />
      <TableBody>
        {props.rows.map((row) => {
          const key = String(row.accountId);
          const expanded = drill.open.has(key);
          const toggle = () => drill.toggle(key);
          const drillable = moved(row);
          return (
            <Fragment key={key}>
              <DrillRow expanded={expanded} onToggle={toggle} drillable={drillable}>
                <DrillCell
                  expanded={expanded}
                  onToggle={toggle}
                  drillable={drillable}
                  text={row.code}
                />
                <TextCell text={row.name} className={GROUP_END} />
                {cells(row)}
              </DrillRow>
              {expanded && drillable ? (
                <LedgerDetail
                  kind="MONEY"
                  query={props.query}
                  accountId={row.accountId}
                  omit={[row.name]}
                  precision={props.precision}
                />
              ) : null}
            </Fragment>
          );
        })}
        <TotalRow labelSpan={2}>{cells(props.totals, true)}</TotalRow>
      </TableBody>
    </BookTable>
  );
}

/** The journal lines behind a row; a click opens the document. */
function LedgerDetail(props: {
  kind: LedgerKind;
  query: LedgerQuery;
  accountId: number;
  partyId?: string;
  /** Names already on screen (the group's, the row's), left out of the lines. */
  omit: readonly string[];
  precision: Precision;
}) {
  const { t } = useTranslation();
  const lines = useLedgerLines(props.query, {
    accountId: props.accountId,
    ...(props.partyId ? { partyId: props.partyId } : {}),
  });
  const span = props.kind === 'PARTY' ? 8 : 6;
  if (lines.isPending) return <DetailSkeleton colSpan={span} />;
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
  const money = (value: string) => amount(value, props.precision);
  return (
    <>
      {lines.data.data.map((line) => {
        const number = line.documentNumber ?? line.entryNumber;
        const parts = detailParts(
          number,
          [
            line.entryDate,
            line.lineDescription ?? line.entryDescription,
            ...(props.kind === 'MONEY' && line.party ? [line.party.name] : []),
          ],
          props.omit,
        );
        return (
          <DetailRow
            key={line.lineId}
            href={ledgerLineHref(line)}
            label={detailText(number, parts)}
          >
            <DetailLabel number={number} parts={parts} colSpan={2} />
            <TextCell
              text={counters(line)}
              colSpan={props.kind === 'PARTY' ? 2 : 1}
              className={cn('text-right', GROUP_END)}
            />
            <TableCell className={NUM}>{money(line.debit)}</TableCell>
            <TableCell className={cn(NUM, GROUP_END)}>{money(line.credit)}</TableCell>
            {props.kind === 'PARTY' ? (
              <BalanceCells balance={line.balanceAfter} precision={props.precision} />
            ) : (
              <TableCell className={NUM}>
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
