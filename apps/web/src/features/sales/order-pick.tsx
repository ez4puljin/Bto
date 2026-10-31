import { PackageX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeSelect } from '@/components/native-select';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BINS_SOON } from '@/lib/features';
import { formatQty } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import type { SalesOrder, SalesOrderLine } from './api';
import { PickStatusBadge } from './order-badges';
import type { PickDrafts } from './pick-drafts';
import { PICK_TONES } from './pick-tones';
import { type PickPart, usePickers, useSalesMutations } from './pipelines-api';
import { usePickerSelf } from './use-picker-self';

/** The picked count and shelf of one line, typed by the keeper confirming that warehouse's part. */
export function PickDraftCell({ line, drafts }: { line: SalesOrderLine; drafts: PickDrafts }) {
  const { t } = useTranslation();
  const draft = drafts.drafts[line.id];
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label={`${t('sales.pick.qty')}: ${line.productName}`}
          inputMode="decimal"
          className="w-20 text-right font-mono"
          value={draft?.qty ?? ''}
          onChange={(event) => drafts.set(line.id, { qty: event.target.value })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={`${t('sales.pick.outOfStock')}: ${line.productName}`}
          title={t('sales.pick.outOfStock')}
          onClick={() => drafts.set(line.id, { qty: '0' })}
        >
          <PackageX />
        </Button>
      </div>
      {BINS_SOON ? null : (
        <NativeSelect
          aria-label={`${t('sales.pick.bin')}: ${line.productName}`}
          value={draft?.binId ?? ''}
          onChange={(event) => drafts.set(line.id, { binId: event.target.value })}
        >
          <option value="">{t('sales.pick.chooseBin')}</option>
          {drafts.binsOf(line.id).map((bin) => (
            <option key={bin.id} value={bin.id}>
              {t('sales.pick.binOption', { code: bin.code, onHand: formatQty(bin.onHand) })}
            </option>
          ))}
        </NativeSelect>
      )}
    </div>
  );
}

/**
 * A warehouse's part as the products table heads its lines (ADR-0126 #2, the owner's one tab):
 * its tone and status, the picker, and the actions — a keeper takes it, a lead hands it over or
 * opens it again, the picker confirms the counts typed in the rows below.
 */
export function PartGroupHeader({
  order,
  part,
  drafts,
  canPick,
}: {
  order: SalesOrder;
  part: PickPart;
  /** The drafts when the signed-in user confirms this part; null otherwise. */
  drafts: PickDrafts | null;
  canPick: boolean;
}) {
  const { t } = useTranslation();
  const self = usePickerSelf();
  const mutations = useSalesMutations();
  const action = useAction();
  const [assigning, setAssigning] = useState(false);
  const [key, setKey] = useState(randomUuid);
  const lines = order.lines.filter((line) => line.warehouseId === part.warehouseId);
  const canTake = canPick && part.status === 'OPEN' && self.writes(part.warehouseId);
  const missing = BINS_SOON ? 0 : lines.filter((line) => !drafts?.drafts[line.id]?.binId).length;
  const tone = PICK_TONES[part.status];
  const run = (work: () => Promise<unknown>, done: string) =>
    void action.run(async () => {
      await work();
      toast.success(done);
    });
  const confirm = () =>
    run(async () => {
      await mutations.pickPart.mutateAsync({
        orderId: order.id,
        warehouseId: part.warehouseId,
        key,
        lines: lines.map((line) => ({
          lineId: line.id,
          qty: drafts?.drafts[line.id]?.qty.trim() || '0',
          binId: Number.parseInt(drafts?.drafts[line.id]?.binId ?? '', 10),
        })),
      });
      // The next confirmation (after a reopen) is a new request.
      setKey(randomUuid());
    }, t('sales.pick.done'));
  return (
    <div className={cn('border-b border-border px-4 py-2', tone.row)} data-part={part.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={cn('size-2.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
          <h3 className="text-sm font-semibold">{part.warehouseName}</h3>
          <PickStatusBadge part={part} />
          <span className="text-[0.8125rem] text-muted-foreground">
            {t('sales.pick.lineCount', { count: lines.length })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canTake ? (
            <Button
              type="button"
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAssigning((open) => !open)}
            >
              {t('sales.pick.assign')}
            </Button>
          ) : null}
          {self.lead && part.status === 'DONE' ? (
            <Button
              type="button"
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
          {drafts !== null ? (
            <Button
              type="button"
              size="sm"
              disabled={!drafts.ready || missing > 0 || mutations.pickPart.isPending}
              onClick={confirm}
            >
              {t('sales.pick.confirm')}
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
      {drafts?.ready && missing > 0 ? (
        <p className="mt-1 text-[0.8125rem] text-warning">
          {t('sales.pick.missingBins', { count: missing })}
        </p>
      ) : null}
      <ProblemAlert problem={action.problem} />
    </div>
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
      <Button
        type="button"
        size="sm"
        disabled={!userId}
        onClick={() => onAssign(Number.parseInt(userId, 10))}
      >
        {t('sales.pick.assignConfirm')}
      </Button>
    </div>
  );
}
