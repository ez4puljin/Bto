import { BellRing, ImageIcon, Megaphone, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  EmptyState,
  ListCard,
  LoadMore,
  RowAction,
  RowActions,
  SkeletonRows,
} from '@/components/list';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatUbDateTime } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { lastDayOf } from '@/features/pricing/helpers';
import { type AppNotice, type NoticeState, useAppNotices, useNoticeMutations } from './api';
import { NoticeDialog } from './notice-form';

const STATE_BADGES: Record<NoticeState, 'success' | 'default' | 'secondary' | 'outline'> = {
  RUNNING: 'success',
  SCHEDULED: 'default',
  ENDED: 'secondary',
  WITHDRAWN: 'outline',
};

/**
 * «Систем» → «Апп мэдэгдэл» (ADR-0062, notifications.send): every notice sent to the rep app or to
 * the customers' «Bto300» (ADR-0079 #8), newest first, with its readers, period, state and how many
 * of them read it; «Шинэ мэдэгдэл» opens the create dialog (`?new=1`) and a running or scheduled
 * notice can be withdrawn.
 */
export function AppNoticesPage() {
  const { t } = useTranslation();
  const notices = useAppNotices();
  const [creating, setCreating] = useCreateParam();
  const [withdrawing, setWithdrawing] = useState<AppNotice | null>(null);
  const mutations = useNoticeMutations();
  const action = useAction();
  const rows = notices.data?.pages.flatMap((page) => page.data) ?? [];

  const withdraw = async () => {
    if (!withdrawing) return;
    const ok = await action.run(() => mutations.withdraw.mutateAsync(withdrawing.id));
    if (!ok) return;
    setWithdrawing(null);
    toast.success(t('notifications.withdrawn'));
  };

  return (
    <div>
      <PageHeader
        title={t('notifications.title')}
        meta={<p className="max-w-3xl">{t('notifications.intro')}</p>}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            {t('notifications.new')}
          </Button>
        }
      />
      <ProblemAlert problem={problemFromError(notices.error)} />
      <ListCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('notifications.columns.notice')}</TableHead>
              <TableHead>{t('notifications.columns.period')}</TableHead>
              <TableHead>{t('notifications.columns.state')}</TableHead>
              <TableHead className="text-right" title={t('notifications.readsHint')}>
                {t('notifications.columns.reads')}
              </TableHead>
              <TableHead>{t('notifications.columns.sent')}</TableHead>
              <TableHead>
                <span className="sr-only">{t('common.actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {notices.isPending ? <SkeletonRows columns={6} /> : null}
            {rows.map((notice) => (
              <NoticeRow
                key={notice.id}
                notice={notice}
                onWithdraw={() => setWithdrawing(notice)}
              />
            ))}
          </TableBody>
        </Table>
        {!notices.isPending && rows.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={t('notifications.empty')}
            action={
              <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {t('notifications.new')}
              </Button>
            }
          />
        ) : null}
        <LoadMore query={notices} />
      </ListCard>
      {creating ? <NoticeDialog onClose={() => setCreating(false)} /> : null}
      <ConfirmDialog
        open={withdrawing !== null}
        title={t('notifications.withdrawTitle', { title: withdrawing?.title ?? '' })}
        description={t('notifications.withdrawDescription')}
        confirmLabel={t('notifications.withdraw')}
        variant="destructive"
        pending={mutations.withdraw.isPending}
        problem={action.problem}
        onConfirm={() => void withdraw()}
        onClose={() => {
          action.clear();
          setWithdrawing(null);
        }}
      />
    </div>
  );
}

function NoticeRow(props: { notice: AppNotice; onWithdraw: () => void }) {
  const { t } = useTranslation();
  const { notice } = props;
  const live = notice.state === 'RUNNING' || notice.state === 'SCHEDULED';
  return (
    <TableRow>
      <TableCell className="max-w-md whitespace-normal">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{t(`notifications.kinds.${notice.kind}`)}</Badge>
          <Badge variant="outline">{t(`notifications.audiences.${notice.audience}`)}</Badge>
          <span className="font-medium">{notice.title}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{notice.body}</p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {notice.popup ? (
            <span className="inline-flex items-center gap-1">
              <BellRing aria-hidden className="size-3.5" />
              {t('notifications.popupBadge')}
            </span>
          ) : null}
          {notice.imageUrl ? (
            <span className="inline-flex items-center gap-1">
              <ImageIcon aria-hidden className="size-3.5" />
              {t('notifications.withImage')}
            </span>
          ) : null}
          {notice.products.length > 0 ? (
            <span>{t('notifications.productsCount', { n: notice.products.length })}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="font-mono whitespace-nowrap">
        {notice.validTo
          ? t('notifications.period', { from: notice.validFrom, to: lastDayOf(notice.validTo) })
          : t('notifications.periodOpen', { from: notice.validFrom })}
      </TableCell>
      <TableCell>
        <Badge variant={STATE_BADGES[notice.state]}>
          {t(`notifications.states.${notice.state}`)}
        </Badge>
      </TableCell>
      <TableCell className="text-right font-mono" title={t('notifications.readsHint')}>
        {t('notifications.readsCell', { reads: notice.reads, recipients: notice.recipients })}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <div className="text-sm">{notice.createdByName}</div>
        <div className="text-xs text-muted-foreground">
          {formatUbDateTime(Date.parse(notice.createdAt))}
        </div>
      </TableCell>
      <RowActions>
        {live ? (
          <RowAction
            label={t('notifications.withdraw')}
            icon={Undo2}
            destructive
            onClick={props.onWithdraw}
          />
        ) : null}
      </RowActions>
    </TableRow>
  );
}
