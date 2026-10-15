import { isFinished, type PrintKind } from '@tugeel/shared/sales';
import { Archive, ArchiveRestore, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { plainDecimal } from '@/lib/money';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { type SalesOrder, useSalesOrder } from './api';
import { OrderStatusBadge, OrderView, PaymentLabel } from './orders-pages';
import { openPrint, orderPrintPath, usePickInfo, useSalesMutations } from './pipelines-api';
import { usePrintFormat } from './print-format';
import { PrintFormatToggle } from './print-format-toggle';

/**
 * The order beside the board or the list (ADR-0056, ADR-0057): the documents to print, the pick
 * form for pickers, archiving a finished order (or taking it back), and the order itself.
 */
export function OrderSheet({ orderId, onClose }: { orderId: number | null; onClose: () => void }) {
  const { t } = useTranslation();
  const order = useSalesOrder(orderId ?? 0, { enabled: orderId !== null });
  const canPick = useHasPermission('sales.orders.pick');
  const mutations = useSalesMutations();
  const action = useAction();
  const detail = order.data;
  const title = detail ? (detail.number ?? t('sales.order.draftNo', { id: detail.id })) : '';
  const archive = (archived: boolean) =>
    void action.run(async () => {
      if (!detail) return;
      if (archived) await mutations.archiveOrder.mutateAsync(detail.id);
      else await mutations.unarchiveOrder.mutateAsync(detail.id);
      toast.success(archived ? t('sales.work.archivedOrder') : t('sales.work.unarchivedOrder'));
    });
  return (
    <Sheet
      open={orderId !== null}
      onOpenChange={(open) => {
        if (open) return;
        action.clear();
        onClose();
      }}
    >
      <SheetContent closeLabel={t('common.close')} className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {detail
              ? [detail.customerName, detail.pipelineName, detail.stageName]
                  .filter(Boolean)
                  .join(' · ')
              : ''}
          </SheetDescription>
        </SheetHeader>
        <ProblemAlert problem={problemFromError(order.error) ?? action.problem} />
        {detail ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={detail.status} />
              <PaymentLabel method={detail.paymentMethod} />
              {detail.archivedAt ? (
                <Badge variant="outline">{t('sales.work.archivedBadge')}</Badge>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {detail.status === 'DRAFT' || detail.status === 'CONFIRMED' ? (
                <Button asChild variant="outline">
                  <Link to={`/sales/orders/${detail.id}`}>{t('sales.boards.openOrder')}</Link>
                </Button>
              ) : null}
              <PrintButtons order={detail} />
              {detail.canEdit && isFinished(detail.status) && !detail.archivedAt ? (
                <Button
                  variant="outline"
                  disabled={mutations.archiveOrder.isPending}
                  onClick={() => archive(true)}
                >
                  <Archive />
                  {t('sales.work.archive')}
                </Button>
              ) : null}
              {detail.canEdit && detail.archivedAt ? (
                <Button
                  variant="outline"
                  disabled={mutations.unarchiveOrder.isPending}
                  onClick={() => archive(false)}
                >
                  <ArchiveRestore />
                  {t('sales.work.unarchive')}
                </Button>
              ) : null}
            </div>
            {canPick && (detail.status === 'CONFIRMED' || detail.status === 'PICKING') ? (
              <PickForm order={detail} />
            ) : null}
            <OrderView order={detail} canManage={false} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The paper (ADR-0058), then the order's documents: the delivery note once it has prices. */
function PrintButtons({ order }: { order: SalesOrder }) {
  const { t } = useTranslation();
  const [format, setFormat] = usePrintFormat();
  const print = (kind: PrintKind) => openPrint(orderPrintPath(order.id, kind, format));
  return (
    <>
      <PrintFormatToggle value={format} onChange={setFormat} />
      <Button variant="outline" onClick={() => print('PICK_LIST')}>
        <Printer />
        {t('sales.printKinds.PICK_LIST')}
      </Button>
      {order.total !== null ? (
        <Button variant="outline" onClick={() => print('DELIVERY_NOTE')}>
          <Printer />
          {t('sales.printKinds.DELIVERY_NOTE')}
        </Button>
      ) : null}
    </>
  );
}

/** The picked count and shelf of every line, confirmed at once (ADR-0056 #5). */
function PickForm({ order }: { order: SalesOrder }) {
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
  const complete = order.lines.every((line) => lines[line.id]?.binId);
  return (
    <section className="rounded-xl border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{t('sales.pick.title')}</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('sales.order.product')}</TableHead>
            <TableHead className="text-right">{t('sales.order.reserved')}</TableHead>
            <TableHead>{t('sales.pick.qty')}</TableHead>
            <TableHead>{t('sales.pick.bin')}</TableHead>
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
                    qty: plainDecimal(line.qtyApproved),
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
                <TableCell>
                  <NativeSelect
                    aria-label={`${t('sales.pick.bin')}: ${line.productName}`}
                    value={lines[line.id]?.binId ?? ''}
                    onChange={(event) =>
                      setLines((current) => ({
                        ...current,
                        [line.id]: { qty: current[line.id]?.qty ?? '0', binId: event.target.value },
                      }))
                    }
                  >
                    <option value="">{t('sales.pick.chooseBin')}</option>
                    {(own?.bins ?? []).map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {t('sales.pick.binOption', {
                          code: bin.code,
                          onHand: plainDecimal(bin.onHand),
                        })}
                      </option>
                    ))}
                  </NativeSelect>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <ProblemAlert problem={action.problem} />
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('sales.pick.hint')}</p>
        <Button disabled={!complete || mutations.pick.isPending} onClick={confirm}>
          {t('sales.pick.confirm')}
        </Button>
      </div>
    </section>
  );
}
