import { Decimal } from '@tugeel/shared/money';
import { FileText, LoaderCircle, RotateCw, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DateInput } from '@/components/date-input';
import { FormField } from '@/components/form';
import { ListCard } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useProducts } from '@/features/catalog/api';
import { SupplierSelect } from '@/features/partners/party-select';
import type { PickedSupplier } from '@/features/partners/supplier-picker';
import { formatMnt, formatQty } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  amountOf,
  draftOf,
  failureKeyOf,
  problemOf,
  type ReviewLine,
  reviewLinesOf,
  type ReviewProduct,
  totalAgrees,
} from './receipt-note-review';
import { NoteStatusBadge } from './receipt-note-start-page';
import {
  isReading,
  type NoteLine,
  type NoteReading,
  openNotePage,
  useNoteMutations,
  useNoteReading,
} from './receipt-notes-api';

const NOTES = '/inventory/receipts/notes';

/**
 * One reading of a delivery note (ADR-0210): while the model reads, a line says so; a failed one
 * says why and can be read again; a read one is checked here, line by line, and saved as a draft
 * receipt, which opens in the receipt window to be finished like any other.
 */
export function ReceiptNotePage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const reading = useNoteReading(id, !Number.isNaN(id));
  const crumbs = [
    { label: t('inventory.receipts.title'), to: '/inventory/receipts' },
    { label: t('inventory.noteReading.title'), to: NOTES },
  ];
  const data = reading.data;
  // The header keeps its own margin: it never sits in the column's gap (docs/ui.md §4).
  return (
    <div>
      <PageHeader
        dense
        title={
          data?.supplier?.name ??
          data?.proposal?.supplierRead.name ??
          t('inventory.noteReading.readingTitle', { id: Number.isNaN(id) ? '' : id })
        }
        crumbs={crumbs}
        meta={data ? <NoteStatusBadge reading={data} /> : undefined}
      />
      <div className="flex flex-col gap-3">
        <ProblemAlert problem={problemFromError(reading.error)} />
        {data ? <ReadingBody key={`${data.id}-${data.status}`} reading={data} /> : null}
      </div>
    </div>
  );
}

function ReadingBody({ reading }: { reading: NoteReading }) {
  const { t } = useTranslation();
  const mutations = useNoteMutations();
  const action = useAction();
  const navigate = useNavigate();
  const canManage = useHasPermission('inventory.receipts.manage');

  const discard = () =>
    void action.run(async () => {
      await mutations.discard.mutateAsync(reading.id);
      await navigate(NOTES);
    });
  const retry = () => void action.run(() => mutations.retry.mutateAsync(reading.id));
  const discardButton = canManage ? (
    <Button variant="outline" disabled={mutations.discard.isPending} onClick={discard}>
      <Trash2 />
      {t('inventory.noteReading.discard')}
    </Button>
  ) : null;

  if (isReading(reading)) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <LoaderCircle aria-hidden className="size-7 animate-spin text-muted-foreground" />
          <p role="status" className="text-sm">
            {t('inventory.noteReading.readingNow', { count: reading.pages.length })}
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            {t('inventory.noteReading.readingHint')}
          </p>
          <Pages reading={reading} />
        </CardContent>
      </Card>
    );
  }
  if (reading.status === 'FAILED' || reading.status === 'READING') {
    return (
      <>
        <ProblemAlert problem={action.problem} />
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>
            {reading.status === 'READING'
              ? t('inventory.noteReading.failure.STALE')
              : t(failureKeyOf(reading.failure), { page: reading.failure?.status ?? '' })}
          </AlertDescription>
        </Alert>
        <Pages reading={reading} />
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button disabled={mutations.retry.isPending} onClick={retry}>
              <RotateCw />
              {t('inventory.noteReading.retry')}
            </Button>
            {discardButton}
          </div>
        ) : null}
      </>
    );
  }
  if (reading.status === 'SAVED' || reading.status === 'DISCARDED') {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col gap-3">
            {reading.status === 'SAVED' && reading.receiptId !== null ? (
              <p className="text-sm">
                {t('inventory.noteReading.savedAs')}{' '}
                <Link
                  to={`/inventory/receipts/${reading.receiptId}`}
                  className="font-mono font-medium underline underline-offset-4"
                >
                  {reading.receiptNumber ?? t('inventory.draftNo', { id: reading.receiptId })}
                </Link>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('inventory.noteReading.discarded')}
              </p>
            )}
            <Pages reading={reading} />
          </CardContent>
        </Card>
        <ReadLines reading={reading} />
      </>
    );
  }
  return canManage ? (
    <Review reading={reading} onDiscard={discard} discarding={mutations.discard.isPending} />
  ) : (
    <>
      <Pages reading={reading} />
      <ReadLines reading={reading} />
    </>
  );
}

/** The pages of the note, each opened in a new tab: what the person checks the reading against. */
function Pages({ reading }: { reading: NoteReading }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const action = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProblemAlert problem={action.problem} />
      {reading.pages.map((page, index) => (
        <Button
          key={page.fileId}
          variant="outline"
          size="sm"
          onClick={() => void action.run(() => openNotePage(api, reading.id, page.fileId))}
        >
          <FileText />
          {t('inventory.noteReading.pageNo', { number: index + 1 })}
        </Button>
      ))}
    </div>
  );
}

/** The lines as read, without editing: a saved or discarded reading, or a reader without the right. */
function ReadLines({ reading }: { reading: NoteReading }) {
  const { t } = useTranslation();
  const lines = reading.proposal?.lines ?? [];
  if (lines.length === 0) return null;
  const withPrices = lines.some((line) => line.amount !== null);
  return (
    <ListCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('inventory.noteReading.columns.printed')}</TableHead>
            <TableHead className="text-right">{t('inventory.noteReading.columns.qty')}</TableHead>
            {withPrices ? (
              <TableHead className="text-right">
                {t('inventory.noteReading.columns.amount')}
              </TableHead>
            ) : null}
            <TableHead>{t('inventory.noteReading.columns.product')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.index}>
              <TableCell>
                <Printed line={line} />
              </TableCell>
              <TableCell className="text-right font-mono">
                {line.qty ? formatQty(line.qty) : t('common.none')}
              </TableCell>
              {withPrices ? (
                <TableCell className="text-right font-mono">
                  {line.amount !== null ? formatMnt(line.amount) : t('common.none')}
                </TableCell>
              ) : null}
              <TableCell>
                {line.match ? (
                  <>
                    <span className="font-mono text-muted-foreground">{line.match.sku}</span>{' '}
                    {line.match.productName}
                  </>
                ) : (
                  t('common.none')
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ListCard>
  );
}

function Printed({ line }: { line: NoteLine }) {
  const { t } = useTranslation();
  const facts = [line.code, line.barcode, line.unit].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <p className="text-sm">
        {line.name}
        {line.free ? (
          <Badge variant="outline" className="ml-1.5">
            {t('inventory.noteReading.free')}
          </Badge>
        ) : null}
      </p>
      {facts ? <p className="font-mono text-xs text-muted-foreground">{facts}</p> : null}
    </div>
  );
}

/**
 * The check of a read note. The header on top (the supplier must be chosen, the number and the date
 * may be corrected), then every line as printed beside what it will become: its quantity and its
 * product unit. A line without a product is chosen here or left out; «Ноорог хадгалах» waits until
 * every line that goes in has both.
 */
function Review(props: { reading: NoteReading; onDiscard: () => void; discarding: boolean }) {
  const { reading } = props;
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mutations = useNoteMutations();
  const action = useAction();
  const proposal = reading.proposal;
  const [supplier, setSupplier] = useState<PickedSupplier | null>(reading.supplier);
  const [docNo, setDocNo] = useState(proposal?.docNo ?? '');
  const [docDate, setDocDate] = useState(proposal?.docDate ?? '');
  const [lines, setLines] = useState<ReviewLine[]>(() => reviewLinesOf(reading));
  const [forgetting, setForgetting] = useState(false);
  const saveKey = useRef(randomUuid());

  const read = proposal?.lines ?? [];
  const withPrices = read.some((line) => line.amount !== null || line.unitPrice !== null);
  const draft = draftOf({ supplierId: supplier?.id ?? null, docNo, docDate }, lines);
  const included = lines.filter((line) => line.include);
  const waiting = included.filter((line) => problemOf(line) !== null).length;
  const sum = amountOf(reading, lines);
  const agrees = totalAgrees(sum, proposal?.totalAmount ?? null);

  const change = (index: number, patch: Partial<ReviewLine>) =>
    setLines((before) =>
      before.map((line) => (line.index === index ? { ...line, ...patch } : line)),
    );

  const save = () => {
    if (draft === null) return;
    void action.run(async () => {
      try {
        const saved = await mutations.saveDraft.mutateAsync({
          key: saveKey.current,
          id: reading.id,
          body: draft,
        });
        toast.success(t('inventory.noteReading.saved'));
        await navigate(`/inventory/receipts/${saved.receiptId}`);
      } catch (error) {
        // A refused draft is a new intent once the form changes.
        saveKey.current = randomUuid();
        throw error;
      }
    });
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,22rem)_12rem_auto]">
            <FormField
              label={t('inventory.noteReading.supplier')}
              htmlFor="note-review-supplier"
              hint={
                supplier === null && proposal?.supplierRead.name
                  ? t('inventory.noteReading.supplierRead', {
                      name: proposal.supplierRead.name,
                      regNo: proposal.supplierRead.regNo ?? t('common.none'),
                    })
                  : undefined
              }
            >
              <SupplierSelect id="note-review-supplier" value={supplier} onChange={setSupplier} />
            </FormField>
            <FormField label={t('inventory.receipts.supplierDoc')} htmlFor="note-review-no">
              <Input
                id="note-review-no"
                value={docNo}
                maxLength={50}
                className="font-mono"
                onChange={(event) => setDocNo(event.target.value)}
              />
            </FormField>
            <FormField label={t('inventory.date')} htmlFor="note-review-date">
              <DateInput id="note-review-date" value={docDate} onChange={setDocDate} />
            </FormField>
          </div>
          <Pages reading={reading} />
          {proposal?.remark ? (
            <Alert>
              <TriangleAlert />
              <AlertDescription>{proposal.remark}</AlertDescription>
            </Alert>
          ) : null}
          {proposal && proposal.cut > 0 ? (
            <p role="alert" className="text-sm text-destructive">
              {t('inventory.noteReading.cut', { count: proposal.cut })}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted-foreground">
            <span>
              {t('inventory.noteReading.summary.lines', {
                count: included.length,
                total: lines.length,
              })}
            </span>
            {proposal?.totalQty ? (
              <span>
                {t('inventory.noteReading.summary.totalQty', { qty: formatQty(proposal.totalQty) })}
              </span>
            ) : null}
            {sum !== null ? (
              <span className={cn(agrees === false && 'font-medium text-destructive')}>
                {proposal?.totalAmount
                  ? t('inventory.noteReading.summary.amountOf', {
                      sum: formatMnt(sum),
                      total: formatMnt(proposal.totalAmount),
                    })
                  : t('inventory.noteReading.summary.amount', { sum: formatMnt(sum) })}
              </span>
            ) : null}
            {proposal?.vat === 'ADDED' ? (
              <span>{t('inventory.noteReading.summary.vatAdded')}</span>
            ) : null}
            {reading.memory && reading.memory.readings > 0 ? (
              <span className="flex items-center gap-2">
                {t('inventory.noteReading.memory.known', {
                  readings: reading.memory.readings,
                  lines: reading.memory.lines,
                })}
                <Button variant="outline" size="xs" onClick={() => setForgetting(true)}>
                  {t('inventory.noteReading.memory.forget')}
                </Button>
              </span>
            ) : reading.supplier ? (
              <span>{t('inventory.noteReading.memory.first')}</span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <ListCard>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">{t('inventory.noteReading.columns.include')}</span>
              </TableHead>
              <TableHead className="w-[34%]">
                {t('inventory.noteReading.columns.printed')}
              </TableHead>
              <TableHead className="w-28 text-right">
                {t('inventory.noteReading.columns.qty')}
              </TableHead>
              {withPrices ? (
                <TableHead className="w-32 text-right">
                  {t('inventory.noteReading.columns.amount')}
                </TableHead>
              ) : null}
              <TableHead>{t('inventory.noteReading.columns.product')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const printed = read[line.index];
              if (!printed) return null;
              const problem = problemOf(line);
              return (
                <TableRow
                  key={line.index}
                  className={cn(!line.include && 'opacity-50')}
                  data-problem={problem ?? undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={t('inventory.noteReading.includeLine', { name: printed.name })}
                      checked={line.include}
                      onCheckedChange={(checked) =>
                        change(line.index, { include: checked === true })
                      }
                    />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <Printed line={printed} />
                    {printed.unsure ? (
                      <p className="text-xs text-warning">{t('inventory.noteReading.unsure')}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={t('inventory.noteReading.qtyOf', { name: printed.name })}
                      inputMode="decimal"
                      className="ml-auto w-24 text-right font-mono"
                      aria-invalid={problem === 'qty' || undefined}
                      disabled={!line.include}
                      value={line.qty}
                      onChange={(event) => change(line.index, { qty: event.target.value })}
                    />
                  </TableCell>
                  {withPrices ? (
                    <TableCell className="text-right font-mono text-sm">
                      {printed.amount !== null ? (
                        formatMnt(printed.amount)
                      ) : printed.unitPrice !== null && line.qty && problem !== 'qty' ? (
                        formatMnt(new Decimal(printed.unitPrice).times(line.qty).toFixed(2))
                      ) : (
                        <span className="text-muted-foreground">{t('common.none')}</span>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell className="whitespace-normal">
                    <LineProduct
                      line={line}
                      printedName={printed.name}
                      invalid={problem === 'product'}
                      onChange={(patch) => change(line.index, patch)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </ListCard>

      <ProblemAlert problem={action.problem} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={draft === null || mutations.saveDraft.isPending} onClick={save}>
          {mutations.saveDraft.isPending ? <LoaderCircle className="animate-spin" /> : <Save />}
          {t('inventory.noteReading.save')}
        </Button>
        <Button variant="outline" disabled={props.discarding} onClick={props.onDiscard}>
          <Trash2 />
          {t('inventory.noteReading.discard')}
        </Button>
        <p role="status" className="text-sm text-muted-foreground">
          {supplier === null
            ? t('inventory.noteReading.waiting.supplier')
            : waiting > 0
              ? t('inventory.noteReading.waiting.lines', { count: waiting })
              : included.length === 0
                ? t('inventory.noteReading.waiting.none')
                : t('inventory.noteReading.waiting.ready')}
        </p>
      </div>
      <ConfirmDialog
        open={forgetting}
        title={t('inventory.noteReading.memory.forgetTitle')}
        description={t('inventory.noteReading.memory.forgetAbout')}
        confirmLabel={t('inventory.noteReading.memory.forget')}
        variant="destructive"
        pending={mutations.forget.isPending}
        onClose={() => setForgetting(false)}
        onConfirm={() => {
          if (!reading.supplier) return;
          void action
            .run(() => mutations.forget.mutateAsync(reading.supplier?.id ?? 0))
            .then(() => setForgetting(false));
        }}
      />
    </>
  );
}

/**
 * A line's product: the matched one with how it was matched and its unit, changeable; or a search
 * of the catalogue, started from the printed name's first word.
 */
function LineProduct(props: {
  line: ReviewLine;
  printedName: string;
  invalid: boolean;
  onChange: (patch: Partial<ReviewLine>) => void;
}) {
  const { t } = useTranslation();
  const { line } = props;
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const products = useProducts(
    { q, status: 'ACTIVE' },
    { enabled: q !== '' && line.product === null, limit: 12 },
  );
  const rows = q === '' ? [] : (products.data?.pages[0]?.data ?? []);

  if (line.product) {
    const product = line.product;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="basis-full text-sm">
          <span className="font-mono text-muted-foreground">{product.sku}</span> {product.name}
        </span>
        <NativeSelect
          className="w-36 shrink-0"
          aria-label={t('inventory.noteReading.unitOf', { name: product.name })}
          disabled={!line.include}
          value={String(product.productUnitId)}
          onChange={(event) =>
            props.onChange({
              product: { ...product, productUnitId: Number.parseInt(event.target.value, 10) },
              how: 'PERSON',
            })
          }
        >
          {product.units.map((unit) => (
            <option key={unit.unitId} value={unit.unitId}>
              {new Decimal(unit.factor).equals(1) ? unit.name : `${unit.name} ×${unit.factor}`}
            </option>
          ))}
        </NativeSelect>
        {line.how ? (
          <Badge variant={line.how === 'MODEL' ? 'warning' : 'outline'}>
            {t(`inventory.noteReading.how.${line.how}`)}
          </Badge>
        ) : null}
        <Button
          variant="outline"
          size="xs"
          disabled={!line.include}
          onClick={() => props.onChange({ product: null, how: null })}
        >
          {t('inventory.noteReading.change')}
        </Button>
      </div>
    );
  }
  return (
    <SearchSelect
      aria-label={t('inventory.noteReading.productOf', { name: props.printedName })}
      value=""
      invalid={props.invalid}
      placeholder={t('inventory.noteReading.pickProduct')}
      options={rows.map((row) => ({ value: String(row.id), label: `${row.sku} · ${row.name}` }))}
      searching={products.isFetching}
      onSearch={setSearch}
      onChange={(value) => {
        const row = rows.find((entry) => String(entry.id) === value);
        if (!row) return;
        const picked: ReviewProduct = {
          productUnitId: (row.units.find((unit) => unit.isBase) ?? row.units[0])?.id ?? 0,
          sku: row.sku,
          name: row.name,
          units: row.units.map((unit) => ({
            unitId: unit.id,
            name: unit.uomName,
            factor: unit.factorToBase,
          })),
        };
        if (picked.productUnitId !== 0) props.onChange({ product: picked, how: 'PERSON' });
      }}
    />
  );
}
