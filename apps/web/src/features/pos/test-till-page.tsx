import { useQuery } from '@tanstack/react-query';
import type { ProblemDetails } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { ShoppingBasket, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApiClient } from '@/app/api-client-context';
import { DialogFormFooter, FormField } from '@/components/form';
import { EmptyState, RowAction, RowActions } from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { ScanBox } from '@/components/scan-box';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useBarcodeLookup } from '@/features/catalog/api';
import { formatMnt } from '@/lib/money';
import { problemFromError, unwrap } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type Shift, useCashiers, usePosMutations, useShifts, useTills } from './api';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

interface CartLine {
  productUnitId: number;
  productId: number;
  name: string;
  uomName: string;
  qty: string;
}

/**
 * «Туршилтын касс» (ADR-0063 #8, development builds only): the centre plays a till so the owner
 * walks the whole path — a shift, scanned lines priced at RETAIL, cash or card, the close — before
 * the store's edge exists (S2).
 */
export function PosTestTillPage() {
  const { t } = useTranslation();
  const tills = useTills();
  const cashiers = useCashiers();
  const [tillId, setTillId] = useState<number | null>(null);
  const [cashierId, setCashierId] = useState<number | null>(null);
  const openShifts = useShifts(
    { tillId: tillId ?? undefined, status: 'OPEN' },
    { enabled: tillId !== null },
  );
  const shift = openShifts.data?.pages[0]?.data[0] ?? null;
  const activeCashiers = (cashiers.data ?? []).filter(
    (cashier) => cashier.status === 'ACTIVE' && cashier.userStatus === 'ACTIVE',
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('pos.testTill.title')} description={t('pos.testTill.description')} />
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField label={t('pos.fields.till')} htmlFor="test-till">
            <NativeSelect
              id="test-till"
              value={tillId ?? ''}
              onChange={(event) => setTillId(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('pos.testTill.chooseTill')}</option>
              {(tills.data ?? [])
                .filter((till) => till.status === 'ACTIVE')
                .map((till) => (
                  <option key={till.id} value={till.id}>
                    {till.code} · {till.name}
                  </option>
                ))}
            </NativeSelect>
          </FormField>
          <FormField label={t('pos.fields.cashier')} htmlFor="test-cashier">
            <NativeSelect
              id="test-cashier"
              value={cashierId ?? ''}
              onChange={(event) => setCashierId(Number.parseInt(event.target.value, 10) || null)}
            >
              <option value="">{t('pos.testTill.chooseCashier')}</option>
              {activeCashiers.map((cashier) => (
                <option key={cashier.userId} value={cashier.userId}>
                  {cashier.fullName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        </CardContent>
      </Card>
      {tillId !== null && cashierId !== null ? (
        shift ? (
          <TillScreen shift={shift} cashierId={cashierId} />
        ) : openShifts.isPending ? null : (
          <OpenShiftCard tillId={tillId} cashierId={cashierId} />
        )
      ) : null}
    </div>
  );
}

function OpenShiftCard({ tillId, cashierId }: { tillId: number; cashierId: number }) {
  const { t } = useTranslation();
  const mutations = usePosMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [openingFloat, setOpeningFloat] = useState('50000');
  const floatOk = MONEY.test(openingFloat);
  const open = (event: FormEvent) => {
    event.preventDefault();
    if (!floatOk) return;
    void action
      .run(async () => {
        const opened = await mutations.devOpenShift.mutateAsync({
          key,
          tillId,
          cashierUserId: cashierId,
          openingFloat,
        });
        toast.success(t('pos.testTill.shiftOpened', { number: opened.number }));
      })
      .then(() => setKey(randomUuid()));
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pos.testTill.noOpenShift')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-3" onSubmit={open} noValidate>
          <FormField
            label={t('pos.fields.openingFloat')}
            htmlFor="test-float"
            error={!floatOk ? 'validation.money' : undefined}
          >
            <Input
              id="test-float"
              inputMode="decimal"
              className="w-40 font-mono"
              value={openingFloat}
              onChange={(event) => setOpeningFloat(event.target.value.trim())}
            />
          </FormField>
          <Button type="submit" disabled={mutations.devOpenShift.isPending}>
            {t('pos.testTill.openShift')}
          </Button>
        </form>
        <ProblemAlert problem={action.problem} />
      </CardContent>
    </Card>
  );
}

function TillScreen({ shift, cashierId }: { shift: Shift; cashierId: number }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookup = useBarcodeLookup();
  const mutations = usePosMutations();
  const action = useAction();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cashTendered, setCashTendered] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [key, setKey] = useState(randomUuid);
  const [lastSale, setLastSale] = useState<{ id: number; number: string } | null>(null);
  const [closing, setClosing] = useState(false);
  const [scanProblem, setScanProblem] = useState<ProblemDetails | null>(null);
  const quoteLines = lines.filter((line) => QTY.test(line.qty) && new Decimal(line.qty).gt(0));
  const quote = useQuery({
    queryKey: [
      'pos',
      'test-till',
      'quote',
      quoteLines.map((line) => [line.productUnitId, line.qty]),
    ],
    enabled: quoteLines.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.POST('/api/v1/pricing/quote', {
          body: {
            list: 'RETAIL',
            date: businessDate(),
            lines: quoteLines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
          },
          signal,
        }),
      ),
  });
  const total = quote.data ? new Decimal(quote.data.total) : null;
  const card = MONEY.test(cardAmount) ? new Decimal(cardAmount) : new Decimal(0);
  const cashDue = total ? total.minus(card) : null;
  const tendered = MONEY.test(cashTendered) ? new Decimal(cashTendered) : null;
  const change = cashDue && tendered && cashDue.gt(0) ? tendered.minus(cashDue) : null;
  const payable =
    total !== null &&
    total.gt(0) &&
    (cashDue === null || cashDue.lte(0) || (tendered !== null && tendered.gte(cashDue))) &&
    card.lte(total);

  const scan = (code: string) =>
    lookup.mutate(code, {
      onSuccess: (found) => {
        setScanProblem(null);
        setLines((previous) => {
          const existing = previous.find((line) => line.productUnitId === found.unit.id);
          if (existing) {
            return previous.map((line) =>
              line.productUnitId === found.unit.id
                ? { ...line, qty: new Decimal(line.qty || '0').plus(1).toFixed() }
                : line,
            );
          }
          return [
            ...previous,
            {
              productUnitId: found.unit.id,
              productId: found.product.id,
              name: found.product.name,
              uomName: found.unit.uomName,
              qty: '1',
            },
          ];
        });
      },
      onError: (error) => setScanProblem(problemFromError(error)),
    });

  const sell = () => {
    if (!total || !payable) return;
    const tenders = [
      ...(cashDue && cashDue.gt(0)
        ? [
            {
              kind: 'CASH' as const,
              amount: cashDue.toFixed(),
              tendered: tendered?.toFixed() ?? null,
            },
          ]
        : []),
      ...(card.gt(0) ? [{ kind: 'CARD' as const, amount: card.toFixed() }] : []),
    ];
    void action
      .run(async () => {
        const sale = await mutations.devSale.mutateAsync({
          key,
          shiftId: shift.id,
          cashierUserId: cashierId,
          lines: quoteLines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty })),
          tenders,
          receiptType: 'B2C',
        });
        toast.success(t('pos.testTill.sold', { number: sale.number }));
        setLastSale({ id: sale.id, number: sale.number });
        setLines([]);
        setCashTendered('');
        setCardAmount('');
      })
      .then(() => setKey(randomUuid()));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('pos.testTill.shiftOpen', { number: shift.number })}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setClosing(true)}>
            {t('pos.actions.closeShift')}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('pos.testTill.scanHint')}</p>
          <ScanBox onScan={scan} />
          <ProblemAlert problem={scanProblem} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('pos.fields.product')}</TableHead>
                <TableHead>{t('pos.fields.unit')}</TableHead>
                <TableHead className="w-28 text-right">{t('pos.fields.qty')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.unitPrice')}</TableHead>
                <TableHead className="text-right">{t('pos.fields.lineTotal')}</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const quoted = quote.data?.lines.find(
                  (entry) => entry.productUnitId === line.productUnitId,
                );
                const priced = quoted?.priced ? quoted : null;
                return (
                  <TableRow key={line.productUnitId}>
                    <TableCell>{line.name}</TableCell>
                    <TableCell>{line.uomName}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        aria-label={`${t('pos.fields.qty')}: ${line.name}`}
                        inputMode="decimal"
                        className="ml-auto w-24 text-right font-mono"
                        value={line.qty}
                        onChange={(event) =>
                          setLines((previous) =>
                            previous.map((entry) =>
                              entry.productUnitId === line.productUnitId
                                ? { ...entry, qty: event.target.value.trim() }
                                : entry,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {priced
                        ? formatMnt(priced.parts[0]?.unitPrice ?? '0')
                        : quoted
                          ? t('pos.testTill.priceMissing')
                          : ''}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {priced ? formatMnt(priced.total ?? '0') : ''}
                    </TableCell>
                    <RowActions>
                      <RowAction
                        label={`${t('pos.actions.removeLine')}: ${line.name}`}
                        icon={Trash2}
                        destructive
                        onClick={() =>
                          setLines((previous) =>
                            previous.filter((entry) => entry.productUnitId !== line.productUnitId),
                          )
                        }
                      />
                    </RowActions>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {lines.length === 0 ? (
            <EmptyState icon={ShoppingBasket} title={t('pos.testTill.emptyCart')} />
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('pos.fields.total')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="font-mono text-3xl font-semibold">
            {total ? formatMnt(total.toFixed(2)) : '—'}
          </p>
          <FormField label={t('pos.testTill.cardAmount')} htmlFor="test-card">
            <Input
              id="test-card"
              inputMode="decimal"
              className="font-mono"
              value={cardAmount}
              onChange={(event) => setCardAmount(event.target.value.trim())}
            />
          </FormField>
          <FormField
            label={t('pos.testTill.cashTendered')}
            htmlFor="test-cash"
            hint={
              cashDue && cashDue.gt(0)
                ? `${t('pos.fields.cash')}: ${formatMnt(cashDue.toFixed(2))}`
                : undefined
            }
          >
            <Input
              id="test-cash"
              inputMode="decimal"
              className="font-mono"
              value={cashTendered}
              onChange={(event) => setCashTendered(event.target.value.trim())}
            />
          </FormField>
          {change && change.gte(0) ? (
            <p className="text-sm">
              {t('pos.testTill.change')}:{' '}
              <span className="font-mono">{formatMnt(change.toFixed(2))}</span>
            </p>
          ) : total && !payable ? (
            <p className="text-sm text-destructive">{t('pos.testTill.tenderShort')}</p>
          ) : null}
          <Button disabled={!payable || mutations.devSale.isPending} onClick={sell}>
            {t('pos.actions.sell')}
          </Button>
          <ProblemAlert problem={action.problem ?? problemFromError(quote.error)} />
          {lastSale ? (
            <Link
              className="text-sm text-link underline-offset-2 hover:underline"
              to={`/pos/sales?sale=${lastSale.id}`}
            >
              {t('pos.testTill.openSale')}: {lastSale.number}
            </Link>
          ) : null}
        </CardContent>
      </Card>
      <CloseShiftDialog open={closing} shift={shift} onClose={() => setClosing(false)} />
    </div>
  );
}

function CloseShiftDialog({
  open,
  shift,
  onClose,
}: {
  open: boolean;
  shift: Shift;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const mutations = usePosMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [countedCash, setCountedCash] = useState('');
  const [floatKept, setFloatKept] = useState(shift.openingFloat);
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const countedOk = MONEY.test(countedCash);
  const keptOk = MONEY.test(floatKept);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setChecked(true);
    if (!countedOk || !keptOk) return;
    void action
      .run(async () => {
        const closed = await mutations.devCloseShift.mutateAsync({
          id: shift.id,
          key,
          countedCash,
          floatKept,
          note: note.trim() || null,
        });
        toast.success(t('pos.testTill.shiftClosed', { number: closed.number }));
      })
      .then((ok) => {
        setKey(randomUuid());
        if (ok) onClose();
      });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('pos.testTill.closeTitle')}</DialogTitle>
          <DialogDescription>{t('pos.testTill.closeDescription')}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('pos.fields.countedCash')}
              htmlFor="close-counted"
              error={checked && !countedOk ? 'validation.money' : undefined}
            >
              <Input
                id="close-counted"
                inputMode="decimal"
                className="font-mono"
                value={countedCash}
                onChange={(event) => setCountedCash(event.target.value.trim())}
              />
            </FormField>
            <FormField
              label={t('pos.fields.floatKept')}
              htmlFor="close-kept"
              error={checked && !keptOk ? 'validation.money' : undefined}
            >
              <Input
                id="close-kept"
                inputMode="decimal"
                className="font-mono"
                value={floatKept}
                onChange={(event) => setFloatKept(event.target.value.trim())}
              />
            </FormField>
          </div>
          <FormField label={t('pos.fields.note')} htmlFor="close-note">
            <Input
              id="close-note"
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          <ProblemAlert problem={action.problem} />
          <DialogFormFooter
            pending={mutations.devCloseShift.isPending}
            onCancel={onClose}
            submitLabel={t('pos.actions.closeShift')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
