import type { PrintKind, StageAction } from '@tugeel/shared/sales';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTugrik } from '@/lib/money';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useSalesMutations } from './pipelines-api';

/** What a move needs to know of its target stage. */
export interface MoveTarget {
  id: number;
  action: StageAction;
}

/**
 * Moving a card (ADR-0056 #3), on the board or from the order panel (ADR-0059): the request with
 * its key, a reason first for a CANCEL stage, then the documents the stage prints. A confirmation
 * of a customer with an overdue debt goes through and reminds in red (ADR-0101).
 */
export function useMover() {
  const { t } = useTranslation();
  const mutations = useSalesMutations();
  const action = useAction();
  const [pending, setPending] = useState<{ orderId: number; stage: MoveTarget } | null>(null);
  const [reason, setReason] = useState('');
  const [print, setPrint] = useState<{ orderId: number; kinds: PrintKind[] } | null>(null);
  const [key, setKey] = useState(randomUuid);

  const run = (orderId: number, stage: MoveTarget, why?: string) =>
    void action.run(async () => {
      const result = await mutations.move.mutateAsync({
        orderId,
        key,
        stageId: stage.id,
        reason: why,
      });
      setKey(randomUuid());
      setPending(null);
      setReason('');
      const overdue = result.order.customerOverdue;
      if (stage.action === 'CONFIRM' && overdue) {
        toast.warning(t('sales.overdue.confirmed', { amount: formatTugrik(overdue.amount) }));
      }
      if (result.print.length > 0) setPrint({ orderId, kinds: result.print });
    });
  return {
    pending,
    reason,
    setReason,
    print,
    problem: action.problem,
    busy: mutations.move.isPending,
    start(orderId: number, stage: MoveTarget) {
      action.clear();
      if (stage.action === 'CANCEL') setPending({ orderId, stage });
      else run(orderId, stage);
    },
    confirm() {
      if (pending) run(pending.orderId, pending.stage, reason.trim());
    },
    cancel() {
      setPending(null);
      setReason('');
      action.clear();
    },
    closePrint: () => setPrint(null),
  };
}

export type Mover = ReturnType<typeof useMover>;
