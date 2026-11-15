import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { Ban, BellRing, Megaphone, Newspaper, Plus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useHasPermission } from '@/app/auth-context';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DialogFormFooter, FormField } from '@/components/form';
import {
  EmptyState,
  FilterBar,
  ListCard,
  ListTable,
  RowAction,
  RowActions,
  RowActionSpacer,
  SearchField,
  SegmentedControl,
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { FactChips } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { cn } from '@/lib/utils';
import { randomUuid } from '@/lib/uuid';
import {
  type HrMessage,
  type HrMessageKind,
  useEngagementMutations,
  useHrMessages,
} from '../engagement-api';
import { ROW_TITLE } from '../hr-helpers';
import {
  emptyMoment,
  MESSAGE_STATES,
  type MessageState,
  messageState,
  momentInstant,
  useAudience,
} from './community-helpers';
import { AudienceField, MomentField, PictureField, SettingSwitch } from './community-kit';

const STATE_VARIANT = {
  PUBLISHED: 'success',
  SCHEDULED: 'default',
  WITHDRAWN: 'outline',
} as const satisfies Record<MessageState, string>;

const WHEN_MODES = ['NOW', 'LATER'] as const;
type WhenMode = (typeof WHEN_MODES)[number];

// A notice needs 48.25rem and news, with its category, 55.25rem: sized on a till PC (55.5rem), the
// count («120 / 120»), the minute-long date and the pill at their own widths. Narrower, the author
// goes first (47.25rem for news), then the category: both lists are 40.25rem on a tablet upright
// (40.5rem), and the row's dialog says what left.
const NOTICE_COLUMNS: readonly ColumnSpec[] = [
  { key: 'title', kind: 'text', weight: 4, min: 15 },
  { key: 'reads', kind: 'count', width: 6 },
  { key: 'author', kind: 'text', weight: 1, min: 8, drop: 1 },
  { key: 'when', kind: 'datetime', width: 9 },
  { key: 'state', kind: 'status', width: 7 },
  { key: 'actions', kind: 'actions', actions: 1 },
];
const NEWS_COLUMNS: readonly ColumnSpec[] = [
  { key: 'title', kind: 'text', weight: 4, min: 15 },
  { key: 'category', kind: 'text', weight: 1, min: 7, drop: 2 },
  { key: 'reads', kind: 'count', width: 6 },
  { key: 'author', kind: 'text', weight: 1, min: 8, drop: 1 },
  { key: 'when', kind: 'datetime', width: 9 },
  { key: 'state', kind: 'status', width: 7 },
  { key: 'actions', kind: 'actions', actions: 1 },
];

/** «Шинэ мэдэгдэл» / «Шинэ мэдээ» (?new=1). */
function MessageDialog(props: { kind: HrMessageKind; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useEngagementMutations();
  const action = useAction();
  const audience = useAudience();
  const [key] = useState(randomUuid);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('');
  const [popup, setPopup] = useState(true);
  const [imageFileId, setImageFileId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [whenMode, setWhenMode] = useState<WhenMode>('NOW');
  const [moment, setMoment] = useState(() => ({ ...emptyMoment(), date: businessDate() }));
  const [tried, setTried] = useState(false);
  const isNotice = props.kind === 'NOTICE';
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    const publishAt = whenMode === 'LATER' ? momentInstant(moment) : null;
    if (
      title.trim() === '' ||
      body.trim() === '' ||
      audience.missing ||
      (whenMode === 'LATER' && publishAt === null)
    ) {
      return;
    }
    const ok = await action.run(() =>
      mutations.createMessage.mutateAsync({
        key,
        kind: props.kind,
        title: title.trim(),
        body: body.trim(),
        category: isNotice ? null : category.trim() || null,
        imageFileId,
        popup: isNotice ? popup : false,
        publishAt,
        userIds: audience.userIds,
      }),
    );
    if (ok) {
      toast.success(
        publishAt === null
          ? t(`hr.community.messages.${props.kind}.sent`)
          : t(`hr.community.messages.${props.kind}.scheduled`),
      );
      close();
    }
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="md">
        <DialogHeader>
          <DialogTitle>{t(`hr.community.messages.${props.kind}.create`)}</DialogTitle>
        </DialogHeader>
        {/* The form goes by its own width (ADR-0201): news' category beside its title and the two
            short choices, to whom and when, on one row, so the form opens with room under a
            laptop's 600px for the people, the time or a picture (news scrolled from the start). */}
        <form
          className="@container flex flex-col gap-4"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <ProblemAlert problem={action.problem} />
          <div
            className={cn(
              'grid gap-4 *:min-w-0',
              isNotice ? null : '@md:grid-cols-[minmax(0,1fr)_12rem]',
            )}
          >
            <FormField
              label={t('hr.community.messages.fields.title')}
              htmlFor="message-title"
              error={tried && title.trim() === '' ? 'validation.required' : undefined}
            >
              <Input
                id="message-title"
                maxLength={ENGAGEMENT_LIMITS.maxTitle}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
            {isNotice ? null : (
              <FormField
                label={t('hr.community.messages.fields.category')}
                htmlFor="message-category"
              >
                <Input
                  id="message-category"
                  maxLength={ENGAGEMENT_LIMITS.maxCategory}
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </FormField>
            )}
          </div>
          <FormField
            label={t('hr.community.messages.fields.body')}
            htmlFor="message-body"
            error={tried && body.trim() === '' ? 'validation.required' : undefined}
          >
            <Textarea
              id="message-body"
              rows={4}
              maxLength={ENGAGEMENT_LIMITS.maxBody}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </FormField>
          <PictureField
            label={t('hr.community.messages.fields.picture')}
            onChange={setImageFileId}
            onBusy={setUploading}
          />
          <AudienceField
            audience={audience}
            showMissing={tried}
            beside={
              <div className="flex min-w-0 flex-col items-start gap-1.5">
                <Label>{t('hr.community.messages.fields.when')}</Label>
                <SegmentedControl
                  name={t('hr.community.messages.fields.when')}
                  options={WHEN_MODES}
                  value={whenMode}
                  label={(mode) => t(`hr.community.messages.whenModes.${mode}`)}
                  onChange={setWhenMode}
                />
              </div>
            }
          />
          {whenMode === 'LATER' ? (
            <MomentField
              id="message-moment"
              label={t('hr.community.messages.fields.moment')}
              required
              min={businessDate()}
              value={moment}
              onChange={setMoment}
              error={
                tried && momentInstant(moment) === null
                  ? t('hr.community.messages.momentMissing')
                  : null
              }
            />
          ) : null}
          {isNotice ? (
            <SettingSwitch
              id="message-popup"
              label={t('hr.community.messages.fields.popup')}
              hint={t('hr.community.messages.fields.popupHint')}
              checked={popup}
              onChange={setPopup}
            />
          ) : null}
          <DialogFormFooter
            pending={mutations.createMessage.isPending}
            onCancel={close}
            disabled={uploading}
            submitLabel={
              whenMode === 'NOW'
                ? t('hr.community.messages.sendNow')
                : t('hr.community.messages.sendLater')
            }
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A message read in full: the list shows one cut line of it, and a finger has no tooltip to ask
 * for the rest (ADR-0201). Nothing to lose here, so it closes without a question.
 */
function MessageReadDialog(props: { message: HrMessage; onClose: () => void }) {
  const { t } = useTranslation();
  const { message } = props;
  const state = messageState(message);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent closeLabel={t('common.close')} size="md" guard={false}>
        <DialogHeader>
          <DialogTitle>{message.title}</DialogTitle>
          <DialogDescription>
            {message.createdByName} · {formatUbMinute(message.publishAt)}
          </DialogDescription>
        </DialogHeader>
        {message.imageUrl ? (
          <img
            src={message.imageUrl}
            alt=""
            aria-hidden
            className="max-h-40 w-full rounded-xl bg-secondary object-cover"
          />
        ) : null}
        <p className="text-sm break-words whitespace-pre-wrap">{message.body}</p>
        <FactChips
          facts={[
            {
              label: t('hr.community.messages.columns.state'),
              value: (
                <Badge variant={STATE_VARIANT[state]}>
                  {t(`hr.community.messages.states.${state}`)}
                </Badge>
              ),
            },
            {
              label: t('hr.community.messages.columns.reads'),
              value: (
                <span className="font-mono">
                  {t('hr.community.ofTotal', { value: message.reads, total: message.recipients })}
                </span>
              ),
            },
            {
              label: t('hr.community.audience.label'),
              value:
                message.userIds.length > 0
                  ? t('hr.community.audience.chosenCount', { count: message.userIds.length })
                  : t('hr.community.audience.modes.ALL'),
            },
            ...(message.category
              ? [{ label: t('hr.community.messages.fields.category'), value: message.category }]
              : []),
            ...(message.popup
              ? [{ label: t('hr.community.messages.fields.popup'), value: t('common.yes') }]
              : []),
          ]}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * «Мэдэгдэл» and «Мэдээ» (ADR-0146 #2): what HR has sent, who has read it, when it goes out; a
 * message is never edited, it is withdrawn and written again. A row opens the message to read.
 */
export function MessagesPage({ kind }: { kind: HrMessageKind }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  const messages = useHrMessages(kind);
  const mutations = useEngagementMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const search = params.get('q') ?? '';
  const state = params.get('state') ?? '';
  const [withdrawing, setWithdrawing] = useState<HrMessage | null>(null);
  const [readingId, setReadingId] = useState<number | null>(null);
  const reading = messages.data?.find((message) => message.id === readingId) ?? null;
  const isNotice = kind === 'NOTICE';
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (messages.data ?? []).filter(
      (message) =>
        (state === '' || messageState(message) === state) &&
        (words === '' ||
          `${message.title} ${message.body} ${message.category ?? ''}`
            .toLowerCase()
            .includes(words)),
    );
  }, [messages.data, search, state]);
  const filtered = search !== '' || state !== '';
  const clearFilters = () => setParams({}, { replace: true });
  const withdraw = async () => {
    if (!withdrawing) return;
    const ok = await action.run(() => mutations.withdrawMessage.mutateAsync(withdrawing.id));
    if (ok) {
      toast.success(t('hr.community.messages.withdrawn'));
      setWithdrawing(null);
    }
  };
  const columns = isNotice ? NOTICE_COLUMNS : NEWS_COLUMNS;
  return (
    <div>
      <PageHeader
        title={isNotice ? t('nav.hrNotices') : t('nav.hrNews')}
        description={t(`hr.community.messages.${kind}.description`)}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t(`hr.community.messages.${kind}.create`)}
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <SearchField
          aria-label={t('common.search')}
          placeholder={t('common.search')}
          value={search}
          onChange={(event) => setParam('q', event.target.value)}
        />
        <NativeSelect
          variant="filter"
          aria-label={t('hr.community.messages.columns.state')}
          value={state}
          onChange={(event) => setParam('state', event.target.value)}
        >
          <option value="">{t('hr.community.messages.allStates')}</option>
          {MESSAGE_STATES.map((value) => (
            <option key={value} value={value}>
              {t(`hr.community.messages.states.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(messages.error)} onRetry={messages.refetch} />
      <ListCard scroll>
        {messages.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('hr.community.noMatch') : t(`hr.community.messages.${kind}.empty`)}
            icon={isNotice ? Megaphone : Newspaper}
            onClearFilters={filtered ? clearFilters : undefined}
          />
        ) : (
          <ListTable columns={columns}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.community.messages.columns.title')}</TableHead>
                {isNotice ? null : (
                  <TableHead>{t('hr.community.messages.columns.category')}</TableHead>
                )}
                <TableHead>{t('hr.community.messages.columns.reads')}</TableHead>
                <TableHead>{t('hr.community.messages.columns.author')}</TableHead>
                <TableHead>{t('hr.community.messages.columns.when')}</TableHead>
                <TableHead>{t('hr.community.messages.columns.state')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.isPending ? <SkeletonRows columns={columns.length} /> : null}
              {rows.map((message) => {
                const rowState = messageState(message);
                return (
                  // The whole row opens the message (a finger's target); the title stays the
                  // keyboard's button, and «Буцаах» does its own work.
                  <TableRow
                    key={message.id}
                    className="cursor-pointer has-[button:focus-visible]:bg-accent"
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest('button')) return;
                      setReadingId(message.id);
                    }}
                  >
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2.5">
                        {message.imageUrl ? (
                          <img
                            src={message.imageUrl}
                            alt=""
                            aria-hidden
                            loading="lazy"
                            className="h-9 w-14 shrink-0 rounded-md bg-secondary object-cover"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <p className="flex min-w-0 items-center gap-1.5">
                            <button
                              type="button"
                              className={cn('min-w-0', ROW_TITLE)}
                              title={message.title}
                              onClick={() => setReadingId(message.id)}
                            >
                              <span className="block truncate">{message.title}</span>
                            </button>
                            {isNotice && message.popup ? (
                              <BellRing
                                role="img"
                                aria-label={t('hr.community.messages.fields.popup')}
                                className="size-3.5 shrink-0 text-muted-foreground"
                              />
                            ) : null}
                          </p>
                          <p
                            className="truncate text-[0.8125rem] text-muted-foreground"
                            title={message.body}
                          >
                            {message.body}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    {isNotice ? null : (
                      <TableCell className="text-muted-foreground">
                        <span className="block truncate">
                          {message.category ?? t('common.none')}
                        </span>
                      </TableCell>
                    )}
                    <TableCell
                      className="font-mono"
                      title={
                        message.userIds.length > 0
                          ? t('hr.community.audience.chosenCount', {
                              count: message.userIds.length,
                            })
                          : t('hr.community.audience.modes.ALL')
                      }
                    >
                      {t('hr.community.ofTotal', {
                        value: message.reads,
                        total: message.recipients,
                      })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="block truncate">{message.createdByName}</span>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">
                      {formatUbMinute(message.publishAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[rowState]}>
                        {t(`hr.community.messages.states.${rowState}`)}
                      </Badge>
                    </TableCell>
                    <RowActions>
                      {canManage && rowState !== 'WITHDRAWN' ? (
                        <RowAction
                          label={t('hr.community.messages.withdrawFor', { title: message.title })}
                          icon={Ban}
                          destructive
                          onClick={() => setWithdrawing(message)}
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
      {creating && canManage ? (
        <MessageDialog kind={kind} onClose={() => setCreating(false)} />
      ) : null}
      {reading ? <MessageReadDialog message={reading} onClose={() => setReadingId(null)} /> : null}
      <ConfirmDialog
        open={withdrawing !== null}
        title={t('hr.community.messages.withdrawTitle')}
        description={t('hr.community.messages.withdrawDescription', {
          title: withdrawing?.title ?? '',
        })}
        confirmLabel={t('hr.community.messages.withdraw')}
        pending={mutations.withdrawMessage.isPending}
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
