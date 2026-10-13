import { Decimal } from '@tugeel/shared/money';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { formatMnt } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type ReceiptCosting, useInventoryMutations, useReceiptCosting } from './api';
import { type CostingMode, type CostingValue, lineAmount } from './helpers';

/**
 * The accountant's costing of a posted receipt (ADR-0033): every line at once, ex-VAT, by line
 * amount or by price per entered unit; bonus goods cost 0. Re-costing uses the same form until the
 * end of the next month.
 */
export function ReceiptCostingPage() {
  const { t } = useTranslation();
  const id = Number.parseInt(useParams().id ?? '', 10);
  const costing = useReceiptCosting(id);

  const loadProblem = problemFromError(costing.error);
  if (loadProblem) return <ProblemAlert problem={loadProblem} />;
  if (!costing.data) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('inventory.costing.title', { number: costing.data.number ?? '' })}
        crumbs={[
          {
            label: costing.data.number ?? t('inventory.draftNo', { id }),
            to: `/inventory/receipts/${id}`,
          },
        ]}
      />
      <CostingForm key={costing.data.costingVersion} costing={costing.data} />
    </div>
  );
}

function CostingForm(props: { costing: ReceiptCosting }) {
  const { costing } = props;
  const { t } = useTranslation();
  const mutations = useInventoryMutations();
  const action = useAction();
  const [key, setKey] = useState(randomUuid);
  const [mode, setMode] = useState<CostingMode>('amount');
  const [values, setValues] = useState<Record<number, CostingValue>>(() =>
    Object.fromEntries(
      costing.lines.map((line) => [
        line.lineId,
        { value: line.freeGoods ? '' : (line.amount ?? ''), free: line.freeGoods },
      ]),
    ),
  );
  const entryOf = (lineId: number): CostingValue => values[lineId] ?? { value: '', free: false };
  const amounts = costing.lines.map((line) =>
    lineAmount(mode, entryOf(line.lineId), line.enteredQty),
  );
  const complete = amounts.every((amount) => amount !== null);
  const total = amounts.reduce<Decimal>((sum, amount) => sum.plus(amount ?? 0), new Decimal(0));
  const set = (lineId: number, patch: Partial<CostingValue>) => {
    setValues((previous) => ({ ...previous, [lineId]: { ...entryOf(lineId), ...patch } }));
  };

  const submit = () =>
    void action.run(async () => {
      await mutations.costReceipt.mutateAsync({
        id: costing.receiptId,
        key,
        body: {
          costingVersion: costing.costingVersion,
          lines: costing.lines.map((line) => {
            const entry = entryOf(line.lineId);
            if (entry.free) return { lineId: line.lineId, freeGoods: true };
            return mode === 'amount'
              ? { lineId: line.lineId, amount: entry.value.trim() }
              : { lineId: line.lineId, unitPrice: entry.value.trim() };
          }),
        },
      });
      setKey(randomUuid());
      toast.success(t('inventory.costing.saved'));
    });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t('inventory.costing.hint')}</p>
        {costing.costingStatus === 'COSTED' && costing.recostUntil ? (
          <p className="text-sm">
            {t('inventory.costing.recostUntil', { date: costing.recostUntil })}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-4">
          {(['amount', 'unitPrice'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="costing-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {t(
                value === 'amount' ? 'inventory.costing.byAmount' : 'inventory.costing.byUnitPrice',
              )}
            </label>
          ))}
        </div>
        <ProblemAlert problem={action.problem} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('inventory.product')}</TableHead>
              <TableHead className="text-right">{t('inventory.qty')}</TableHead>
              <TableHead className="text-right">{t('inventory.costing.provisional')}</TableHead>
              <TableHead className="text-right">
                {t(mode === 'amount' ? 'inventory.costing.amount' : 'inventory.costing.unitPrice')}
              </TableHead>
              <TableHead>{t('inventory.costing.freeGoods')}</TableHead>
              <TableHead className="text-right">{t('inventory.costing.baseCost')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {costing.lines.map((line, index) => {
              const entry = entryOf(line.lineId);
              const amount = amounts[index] ?? null;
              const unitCost =
                amount === null ? null : amount.dividedBy(line.qtyBase).toDecimalPlaces(4);
              return (
                <TableRow key={line.lineId}>
                  <TableCell className="whitespace-normal">{line.productName}</TableCell>
                  <TableCell className="text-right font-mono">
                    {t('inventory.qtyWithUnit', { qty: line.enteredQty, unit: line.unitName })}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMnt(line.provisionalUnitCost)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      aria-label={`${t(
                        mode === 'amount'
                          ? 'inventory.costing.amount'
                          : 'inventory.costing.unitPrice',
                      )}: ${line.productName}`}
                      inputMode="decimal"
                      autoComplete="off"
                      className="ml-auto w-32 text-right font-mono"
                      disabled={entry.free}
                      value={entry.value}
                      onChange={(event) => set(line.lineId, { value: event.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      aria-label={`${t('inventory.costing.freeGoods')}: ${line.productName}`}
                      checked={entry.free}
                      onCheckedChange={(checked) => set(line.lineId, { free: checked === true })}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {unitCost === null ? t('common.none') : formatMnt(unitCost.toString())}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center gap-4">
          <Label>{t('inventory.costing.total')}</Label>
          <span className="font-mono text-lg">{formatMnt(total.toString())}</span>
        </div>
        {!complete ? (
          <p className="text-sm text-muted-foreground">{t('inventory.costing.missing')}</p>
        ) : null}
        <Button
          className="self-start"
          disabled={!complete || mutations.costReceipt.isPending}
          onClick={submit}
        >
          {costing.costingStatus === 'COSTED'
            ? t('inventory.costing.resubmit')
            : t('inventory.costing.submit')}
        </Button>
      </CardContent>
    </Card>
  );
}
