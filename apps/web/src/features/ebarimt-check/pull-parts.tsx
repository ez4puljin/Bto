import { CloudDownload, EyeOff, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHasPermission } from '@/app/auth-context';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import type { useAction } from '@/lib/use-action';
import { randomUuid } from '@/lib/uuid';
import {
  type EbarimtMonth,
  type EbarimtPullResult,
  useEbarimtConnection,
  useEbarimtMutations,
} from './api';
import { usePullTexts } from './pull-texts';

/**
 * The month bar's part of e-Barimt's API (ADR-0228): where the month's file came from, how many of
 * its lines came with a hidden register, the last pull's failure, and «Одоо татах» once the
 * connection is complete.
 */
export function PullBar(props: {
  period: number;
  monthName: string;
  month: EbarimtMonth | null;
  /** The page's: its problem shows under the bars, where the page's other problems show. */
  action: ReturnType<typeof useAction>;
}) {
  const { t } = useTranslation();
  const canPull = useHasPermission('ebarimt.check.edit');
  const connection = useEbarimtConnection();
  const mutations = useEbarimtMutations();
  const texts = usePullTexts();
  const { action } = props;
  const file = props.month?.file ?? null;
  const last = connection.data?.lastPull ?? null;

  const announce = (result: EbarimtPullResult) => {
    if (!result.ok) {
      toast.warning(
        t('ebarimtCheck.pull.failed', { reason: texts.reason(result.reason, result.message) }),
      );
      return;
    }
    const month = props.monthName;
    const count = result.receipts ?? 0;
    if (count === 0) toast.info(t('ebarimtCheck.pull.empty', { month }));
    else if (result.months.some((pulled) => pulled.changed)) {
      toast.success(t('ebarimtCheck.pull.done', { month, count }));
    } else toast.info(t('ebarimtCheck.pull.unchanged', { month, count }));
  };
  const pull = () =>
    void action.run(async () => {
      announce(await mutations.pull.mutateAsync({ period: props.period, key: randomUuid() }));
    });

  return (
    <div className="flex items-center gap-2">
      {file ? (
        <span
          className="text-[0.8125rem] whitespace-nowrap text-muted-foreground"
          title={last ? texts.status(last) : undefined}
        >
          {t('ebarimtCheck.pull.source', {
            source: t(`ebarimtCheck.pull.sources.${file.source}`),
          })}
        </span>
      ) : null}
      {file && file.maskedCount > 0 ? (
        <span
          className="inline-flex items-center gap-1 text-[0.8125rem] whitespace-nowrap text-warning"
          title={t('ebarimtCheck.pull.maskedTitle')}
        >
          <EyeOff aria-hidden className="size-3.5" />
          {t('ebarimtCheck.pull.masked', { count: file.maskedCount })}
        </span>
      ) : null}
      {last && !last.ok ? (
        <span
          role="status"
          className="inline-flex items-center gap-1 text-[0.8125rem] font-medium whitespace-nowrap text-destructive"
          title={texts.status(last)}
        >
          <TriangleAlert aria-hidden className="size-3.5" />
          {t('ebarimtCheck.pull.failedShort')}
          <span className="sr-only">{texts.status(last)}</span>
        </span>
      ) : null}
      {canPull && connection.data?.complete ? (
        <Button
          size="sm"
          variant="outline"
          pending={mutations.pull.isPending}
          title={t('ebarimtCheck.pull.nowTitle', { month: props.monthName })}
          onClick={pull}
        >
          <CloudDownload />
          {t('ebarimtCheck.pull.now')}
        </Button>
      ) : null}
    </div>
  );
}
