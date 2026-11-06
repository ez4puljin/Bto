import { ENGAGEMENT_LIMITS, FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@tugeel/shared/hr';
import { MessagesSquare, Reply } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  DateFilter,
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  RowActionSpacer,
  SearchField,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import {
  type HrFeedback,
  type HrFeedbackCategory,
  type HrFeedbackStatus,
  useEngagementMutations,
  useHrFeedback,
} from '../engagement-api';
import { Avatar } from '../hr-kit';
import { FEEDBACK_STATUS_VARIANT } from './community-helpers';

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'who', kind: 'text', weight: 1, min: 11 },
  { key: 'category', kind: 'status' },
  { key: 'title', kind: 'text', weight: 3, min: 16 },
  { key: 'status', kind: 'status' },
  { key: 'createdAt', kind: 'datetime' },
  { key: 'actions', kind: 'actions', actions: 1 },
];

/** Read by all who may see the list; HR also sets the status and writes the answer. */
function FeedbackDialog(props: { feedback: HrFeedback; canManage: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useEngagementMutations();
  const action = useAction();
  const { feedback } = props;
  // A row opened for the first time has been seen, unless HR says otherwise.
  const [status, setStatus] = useState<HrFeedbackStatus>(
    feedback.status === 'NEW' ? 'SEEN' : feedback.status,
  );
  const [reply, setReply] = useState(feedback.reply ?? '');
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await action.run(() =>
      mutations.decideFeedback.mutateAsync({
        id: feedback.id,
        status,
        reply: reply.trim() || null,
      }),
    );
    if (ok) {
      toast.success(t('hr.community.feedback.saved'));
      close();
    }
  };
  const who = feedback.fullName ?? t('hr.community.feedback.anonymous');
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>{feedback.title}</DialogTitle>
          <DialogDescription>
            {who} · {t(`hr.community.feedback.categories.${feedback.category}`)} ·{' '}
            {formatUbMinute(feedback.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-fill/60 px-3 py-2 text-[0.8125rem] whitespace-pre-wrap">
          {feedback.body}
        </p>
        {props.canManage ? (
          <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
            <ProblemAlert problem={action.problem} />
            <FormField label={t('hr.community.feedback.status')} htmlFor="feedback-status">
              <NativeSelect
                id="feedback-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as HrFeedbackStatus)}
              >
                {FEEDBACK_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`hr.community.feedback.statuses.${value}`)}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label={t('hr.community.feedback.reply')}
              htmlFor="feedback-reply"
              hint={
                feedback.userId === null
                  ? t('hr.community.feedback.anonymousHint')
                  : t('hr.community.feedback.replyHint')
              }
            >
              <Textarea
                id="feedback-reply"
                rows={4}
                maxLength={ENGAGEMENT_LIMITS.maxBody}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
            </FormField>
            <DialogFormFooter
              pending={mutations.decideFeedback.isPending}
              onCancel={close}
              submitLabel={t('common.save')}
            />
          </form>
        ) : feedback.reply ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t('hr.community.feedback.reply')}
            </p>
            <p className="text-[0.8125rem] whitespace-pre-wrap">{feedback.reply}</p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** «Санал хүсэлт» (ADR-0146 #4): what the staff wrote to HR; a row with no person stays «Нэргүй». */
export function FeedbackPage() {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const search = params.get('q') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const status = (params.get('status') ?? '') as HrFeedbackStatus | '';
  const category = (params.get('category') ?? '') as HrFeedbackCategory | '';
  const feedback = useHrFeedback({
    from: from || undefined,
    to: to || undefined,
    status: status || undefined,
    category: category || undefined,
  });
  const [openId, setOpenId] = useState<number | null>(null);
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (feedback.data ?? []).filter(
      (row) =>
        words === '' ||
        `${row.title} ${row.body} ${row.fullName ?? ''}`.toLowerCase().includes(words),
    );
  }, [feedback.data, search]);
  const open = feedback.data?.find((row) => row.id === openId) ?? null;
  const filtered = search !== '' || from !== '' || to !== '' || status !== '' || category !== '';
  return (
    <div>
      <PageHeader
        title={t('nav.hrFeedback')}
        description={t('hr.community.feedback.description')}
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={search}
          onChange={(event) => setParam('q', event.target.value)}
        />
        <DateFilter
          label={t('hr.community.from')}
          value={from || undefined}
          onChange={(value) => setParam('from', value ?? null)}
        />
        <DateFilter
          label={t('hr.community.to')}
          value={to || undefined}
          onChange={(value) => setParam('to', value ?? null)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('hr.community.feedback.category')}
          value={category}
          onChange={(event) => setParam('category', event.target.value || null)}
        >
          <option value="">{t('hr.community.feedback.allCategories')}</option>
          {FEEDBACK_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {t(`hr.community.feedback.categories.${value}`)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          variant="filter"
          aria-label={t('hr.community.feedback.status')}
          value={status}
          onChange={(event) => setParam('status', event.target.value || null)}
        >
          <option value="">{t('hr.community.feedback.allStatuses')}</option>
          {FEEDBACK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`hr.community.feedback.statuses.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(feedback.error)} onRetry={feedback.refetch} />
      <ListCard scroll>
        {feedback.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('hr.community.noMatch') : t('hr.community.feedback.empty')}
            icon={MessagesSquare}
            onClearFilters={filtered ? () => setParams({}, { replace: true }) : undefined}
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.community.feedback.columns.who')}</TableHead>
                <TableHead>{t('hr.community.feedback.columns.category')}</TableHead>
                <TableHead>{t('hr.community.feedback.columns.title')}</TableHead>
                <TableHead>{t('hr.community.feedback.columns.status')}</TableHead>
                <TableHead>{t('hr.community.feedback.columns.createdAt')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedback.isPending ? <SkeletonRows columns={COLUMNS.length} /> : null}
              {rows.map((row) => {
                const who = row.fullName ?? t('hr.community.feedback.anonymous');
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar name={who} className="size-7 text-[0.6875rem]" />
                        <span
                          className={
                            row.userId === null
                              ? 'truncate text-muted-foreground'
                              : 'truncate font-medium'
                          }
                        >
                          {who}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {t(`hr.community.feedback.categories.${row.category}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium text-link hover:underline"
                        title={row.title}
                        onClick={() => setOpenId(row.id)}
                      >
                        {row.title}
                      </button>
                      <p
                        className="truncate text-[0.8125rem] text-muted-foreground"
                        title={row.body}
                      >
                        {row.body}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={FEEDBACK_STATUS_VARIANT[row.status]}>
                        {t(`hr.community.feedback.statuses.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">
                      {formatUbMinute(row.createdAt)}
                    </TableCell>
                    <RowActions>
                      {canManage ? (
                        <RowAction
                          label={t('hr.community.feedback.answerFor', { title: row.title })}
                          icon={Reply}
                          onClick={() => setOpenId(row.id)}
                        />
                      ) : (
                        <RowActionSpacer />
                      )}
                    </RowActions>
                  </TableRow>
                );
              })}
            </TableBody>
          </ListTable>
        )}
      </ListCard>
      {open ? (
        <FeedbackDialog
          key={open.id}
          feedback={open}
          canManage={canManage}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
