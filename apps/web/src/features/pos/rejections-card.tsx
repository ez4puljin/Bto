import { isErrorCode } from '@tugeel/shared/errors';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { ProblemAlert } from '@/components/problem-alert';
import { Button } from '@/components/ui/button';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import { useOpenRejections, usePosMutations } from './api';

/**
 * «Төв хүлээж аваагүй баримт» (ADR-0063 #4, ADR-0140): what the centre refused from a POS server
 * and nobody replayed yet, oldest first — a shift refused while an old one was still open goes in
 * once that one is closed («Төвөөс хаах»), then the sales that hung on it. Shown only when any:
 * one strip with the count, folded until asked for, so the shifts its hint sends the reader to
 * stay in view (fifteen refused documents stood two screens above them, ADR-0201); open, the
 * documents scroll inside the card.
 */
export function RejectionsCard() {
  const { t } = useTranslation();
  const canManage = useHasPermission('pos.manage');
  const rejections = useOpenRejections(canManage);
  const mutations = usePosMutations();
  const action = useAction();
  const [pending, setPending] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const errorText = (code: string | null | undefined, params?: Record<string, unknown> | null) =>
    code && isErrorCode(code) ? t(`errors.${code}`, params ?? {}) : t('errors.INTERNAL_ERROR');
  const rows = [...(rejections.data ?? [])].sort((a, b) => a.id - b.id);
  if (!canManage || rows.length === 0) return null;
  const replay = (id: number) => {
    setPending(id);
    void action
      .run(async () => {
        const outcome = await mutations.replayRejection.mutateAsync({ id, key: randomUuid() });
        if (outcome.status === 'REJECTED') {
          toast.warning(errorText(outcome.code, outcome.params));
        } else {
          toast.success(t('pos.rejections.replayed'));
        }
      })
      .finally(() => setPending(null));
  };
  return (
    <section
      aria-labelledby="pos-rejections"
      className="mb-4 rounded-xl border border-warning/40 bg-warning-soft/40 px-4 py-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="pos-rejections" className="min-w-0 text-base font-semibold">
          {t('pos.rejections.title', { count: rows.length })}
        </h2>
        <Button
          size="sm"
          variant="outline"
          aria-expanded={open}
          onClick={() => setOpen((shown) => !shown)}
        >
          {open ? t('pos.receiptTemplates.hide') : t('pos.receiptTemplates.show')}
        </Button>
      </div>
      {open ? (
        <div className="mt-1 mb-1.5 flex flex-col gap-3">
          <p className="text-[0.8125rem] text-muted-foreground">{t('pos.rejections.hint')}</p>
          <ProblemAlert problem={action.problem ?? problemFromError(rejections.error)} />
          <ul className="flex max-h-[min(40svh,18rem)] flex-col gap-2 overflow-y-auto [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-card px-3 py-2 text-sm"
              >
                <span className="font-mono">{row.edgeNodeCode}</span>
                <span className="font-medium">{t(`pos.eventKinds.${row.kind}`)}</span>
                <span className="text-muted-foreground">
                  {formatUbDateTime(Date.parse(row.createdAt))}
                </span>
                <span className="min-w-0 flex-1 text-destructive">
                  {errorText(row.code, row.params)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => replay(row.id)}
                >
                  <RotateCcw />
                  {t('pos.rejections.replay')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
