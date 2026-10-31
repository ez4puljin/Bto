import type { PickStatus } from '@tugeel/shared/sales';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
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
import { BINS_SOON } from '@/lib/features';
import { formatQty, plainDecimal } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import type { SalesOrder } from './api';
import { type PickPart, usePickers, usePickInfo, useSalesMutations } from './pipelines-api';
import { usePickerSelf } from './use-picker-self';

const STATUS_VARIANT: Record<PickStatus, 'outline' | 'secondary' | 'default'> = {
  OPEN: 'outline',
  PICKING: 'secondary',
  DONE: 'default',
};

/** A part's status as a badge: waiting, picking (by whom), picked (by whom). */
export function PickStatusBadge({ part }: { part: Pick<PickPart, 'status' | 'pickerName'> }) {
  const { t } = useTranslation();
  return (
    <Badge variant={STATUS_VARIANT[part.status]}>
      {part.status === 'OPEN'
        ? t('sales.pick.status.OPEN')
        : t(`sales.pick.status.${part.status}`, { name: part.pickerName ?? '' })}
    </Badge>
  );
}

/**
 * «Бэлтгэх» (ADR-0126 #2): one card per warehouse of the order. A keeper takes their warehouse's
 * part and confirms its counts; a lead hands a part to another picker and opens a picked one again.
 */
export function PickParts({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  if (order.picks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('sales.pick.noParts')}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.8125rem] text-muted-foreground">{t('sales.pick.partsHint')}</p>
      {order.picks.map((part) => (
        <PartCard key={part.warehouseId} order={order} part={part} />
      ))}
    </div>
  );
}

function PartCard({ order, part }: { order: SalesOrder; part: PickPart }) {
  const { t } = useTranslation();
  const self = usePickerSelf();
  const mutations = useSalesMutations();
  const action = useAction();
  const [assigning, setAssigning] = useState(false);
  const mine = part.status === 'PICKING' && part.pickerId === self.id;
  const canTake = part.status === 'OPEN' && self.writes(part.warehouseId);
  const canPick = part.status === 'PICKING' && (mine || self.lead) && self.writes(part.warehouseId);
  const lines = order.lines.filter((line) => line.warehouseId === part.warehouseId);
  const run = (work: () => Promise<unknown>, done: string) =>
    void action.run(async () => {
      await work();
      toast.success(done);
    });
  return (
    <section aria-label={part.warehouseName} className="rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{part.warehouseName}</h3>
          <PickStatusBadge part={part} />
          <span className="text-[0.8125rem] text-muted-foreground">
            {t('sales.pick.lineCount', { count: lines.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canTake ? (
            <Button
              size="sm"
              disabled={mutations.takePart.isPending}
              onClick={() =>
                run(
                  () =>
                    mutations.takePart.mutateAsync({
                      orderId: order.id,
                      warehouseId: part.warehouseId,
                    }),
                  t('sales.pick.taken'),
                )
              }
            >
              {t('sales.pick.take')}
            </Button>
          ) : null}
          {self.lead && part.status !== 'DONE' ? (
            <Button size="sm" variant="outline" onClick={() => setAssigning((open) => !open)}>
              {t('sales.pick.assign')}
            </Button>
          ) : null}
          {self.lead && part.status === 'DONE' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={mutations.reopenPart.isPending}
              onClick={() =>
                run(
                  () =>
                    mutations.reopenPart.mutateAsync({
                      orderId: order.id,
                      warehouseId: part.warehouseId,
                    }),
                  t('sales.pick.reopened'),
                )
              }
            >
              {t('sales.pick.reopen')}
            </Button>
          ) : null}
        </div>
      </div>
      {assigning ? (
        <AssignRow
          part={part}
          onAssign={(userId) =>
            run(async () => {
              await mutations.assignPart.mutateAsync({
                orderId: order.id,
                warehouseId: part.warehouseId,
                userId,
              });
              setAssigning(false);
            }, t('sales.pick.assigned'))
          }
        />
      ) : null}
      <ProblemAlert problem={action.problem} />
      {canPick ? (
        <PartPickTable order={order} warehouseId={part.warehouseId} />
      ) : (
        <ul className="mt-2 divide-y divide-border text-sm">
          {lines.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate">{line.productName}</span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {line.qtyPicked === null
                  ? t('sales.order.qtyIn', {
                      qty: formatQty(line.qtyApproved),
                      unit: line.baseUnitName,
                    })
                  : t('sales.pick.pickedOf', {
                      picked: formatQty(line.qtyPicked),
                      qty: formatQty(line.qtyBase),
                      unit: line.baseUnitName,
                    })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssignRow({ part, onAssign }: { part: PickPart; onAssign: (userId: number) => void }) {
  const { t } = useTranslation();
  const pickers = usePickers(part.warehouseId);
  const [userId, setUserId] = useState('');
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label={`${t('sales.pick.assignTo')}: ${part.warehouseName}`}
        className="w-64"
        value={userId}
        onChange={(event) => setUserId(event.target.value)}
      >
        <option value="">{t('sales.pick.choosePicker')}</option>
        {(pickers.data ?? []).map((user) => (
          <option key={user.id} value={user.id}>
            {user.fullName}
          </option>
        ))}
      </NativeSelect>
      <Button size="sm" disabled={!userId} onClick={() => onAssign(Number.parseInt(userId, 10))}>
        {t('sales.pick.assignConfirm')}
      </Button>
    </div>
  );
}

/** The picked count (and shelf) of every line of one warehouse, confirmed at once. */
function PartPickTable({ order, warehouseId }: { order: SalesOrder; warehouseId: number }) {
  const { t } = useTranslation();
  const info = usePickInfo(order.id);
  const mutations = useSalesMutations();
  const action = useAction();
  const [key] = useState(randomUuid);
  const lines = order.lines.filter((line) => line.warehouseId === warehouseId);
  const [counts, setCounts] = useState<Record<number, { qty: string; binId: string }>>({});
  useEffect(() => {
    if (!info.data) return;
    setCounts(
      Object.fromEntries(
        order.lines
          .filter((line) => line.warehouseId === warehouseId)
          .map((line) => {
            const own = info.data?.find((entry) => entry.lineId === line.id);
            return [
              line.id,
              { qty: plainDecimal(line.qtyApproved), binId: String(own?.proposedBinId ?? '') },
            ];
          }),
      ),
    );
  }, [info.data, order.lines, warehouseId]);
  const confirm = () =>
    void action.run(async () => {
      await mutations.pickPart.mutateAsync({
        orderId: order.id,
        warehouseId,
        key,
        lines: lines.map((line) => ({
          lineId: line.id,
          qty: counts[line.id]?.qty.trim() || '0',
          binId: Number.parseInt(counts[line.id]?.binId ?? '', 10),
        })),
      });
      toast.success(t('sales.pick.done'));
    });
  const missing = lines.filter((line) => !counts[line.id]?.binId).length;
  const set = (lineId: number, fields: Partial<{ qty: string; binId: string }>) =>
    setCounts((current) => ({
      ...current,
      [lineId]: {
        qty: current[lineId]?.qty ?? '0',
        binId: current[lineId]?.binId ?? '',
        ...fields,
      },
    }));
  return (
    <div className="mt-2">
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
          {lines.map((line) => {
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
                    value={counts[line.id]?.qty ?? ''}
                    onChange={(event) => set(line.id, { qty: event.target.value })}
                  />
                </TableCell>
                {BINS_SOON ? null : (
                  <TableCell>
                    <NativeSelect
                      aria-label={`${t('sales.pick.bin')}: ${line.productName}`}
                      value={counts[line.id]?.binId ?? ''}
                      onChange={(event) => set(line.id, { binId: event.target.value })}
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
          <p className="mr-auto text-[0.8125rem] text-warning">
            {t('sales.pick.missingBins', { count: missing })}
          </p>
        ) : null}
        <Button disabled={missing > 0 || mutations.pickPart.isPending} onClick={confirm}>
          {t('sales.pick.confirm')}
        </Button>
      </div>
    </div>
  );
}
