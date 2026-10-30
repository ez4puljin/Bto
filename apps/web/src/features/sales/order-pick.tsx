import { BINS_SOON } from '@/lib/features';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
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
import { formatQty, plainDecimal } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import type { SalesOrder } from './api';
import { usePickInfo, useSalesMutations } from './pipelines-api';

/** The picked count and shelf of every line, confirmed at once (ADR-0056 #5). */
export function PickForm({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  const info = usePickInfo(order.id);
  const mutations = useSalesMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const [lines, setLines] = useState<Record<number, { qty: string; binId: string }>>({});
  useEffect(() => {
    if (!info.data) return;
    setLines(
      Object.fromEntries(
        order.lines.map((line) => {
          const own = info.data?.find((entry) => entry.lineId === line.id);
          return [
            line.id,
            { qty: plainDecimal(line.qtyApproved), binId: String(own?.proposedBinId ?? '') },
          ];
        }),
      ),
    );
  }, [info.data, order.lines]);
  const confirm = () =>
    void action.run(async () => {
      await mutations.pick.mutateAsync({
        orderId: order.id,
        key,
        lines: order.lines.map((line) => ({
          lineId: line.id,
          qty: lines[line.id]?.qty.trim() || '0',
          binId: Number.parseInt(lines[line.id]?.binId ?? '', 10),
        })),
      });
      toast.success(t('sales.pick.done'));
    });
  // «Батлах» waits for a shelf on every line; the line under the table says how many lack one.
  const missing = order.lines.filter((line) => !lines[line.id]?.binId).length;
  return (
    <section className="rounded-xl border border-border p-3">
      <h3 className="text-sm font-semibold">{t('sales.pick.title')}</h3>
      <p className="mt-0.5 mb-2 text-[13px] text-muted-foreground">{t('sales.pick.hint')}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sales.order.product')}</TableHead>
            <TableHead className="text-right">{t('sales.order.reserved')}</TableHead>
            <TableHead>{t('sales.pick.qty')}</TableHead>
            {BINS_SOON ? null : <TableHead>{t('sales.pick.bin')}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {order.lines.map((line) => {
            const own = info.data?.find((entry) => entry.lineId === line.id);
            return (
              <TableRow key={line.id}>
                <TableCell className="whitespace-normal">{line.productName}</TableCell>
                <TableCell className="text-right font-mono">
                  {t('sales.order.qtyIn', {
                    qty: formatQty(line.qtyApproved),
                    unit: line.baseUnitName,
                  })}
                </TableCell>
                <TableCell>
                  <Input
                    aria-label={`${t('sales.pick.qty')}: ${line.productName}`}
                    inputMode="decimal"
                    className="w-24 text-right font-mono"
                    value={lines[line.id]?.qty ?? ''}
                    onChange={(event) =>
                      setLines((current) => ({
                        ...current,
                        [line.id]: {
                          qty: event.target.value,
                          binId: current[line.id]?.binId ?? '',
                        },
                      }))
                    }
                  />
                </TableCell>
                {BINS_SOON ? null : (
                  <TableCell>
                    <NativeSelect
                      aria-label={`${t('sales.pick.bin')}: ${line.productName}`}
                      value={lines[line.id]?.binId ?? ''}
                      onChange={(event) =>
                        setLines((current) => ({
                          ...current,
                          [line.id]: {
                            qty: current[line.id]?.qty ?? '0',
                            binId: event.target.value,
                          },
                        }))
                      }
                    >
                      <option value="">{t('sales.pick.chooseBin')}</option>
                      {(own?.bins ?? []).map((bin) => (
                        <option key={bin.id} value={bin.id}>
                          {t('sales.pick.binOption', {
                            code: bin.code,
                            onHand: formatQty(bin.onHand),
                          })}
                        </option>
                      ))}
                    </NativeSelect>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ProblemAlert problem={action.problem} />
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {info.data && missing > 0 ? (
          <p className="mr-auto text-[13px] text-warning">
            {t('sales.pick.missingBins', { count: missing })}
          </p>
        ) : null}
        <Button disabled={missing > 0 || mutations.pick.isPending} onClick={confirm}>
          {t('sales.pick.confirm')}
        </Button>
      </div>
    </section>
  );
}
