import { ENGAGEMENT_LIMITS, POLL_QUESTION_KINDS } from '@tugeel/shared/hr';
import { businessDate } from '@tugeel/shared/time';
import { BarChart3, ClipboardList, Lock, Plus, Trash2, Vote } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
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
  SkeletonRows,
} from '@/components/list';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { ProblemAlert } from '@/components/problem-alert';
import { RecordSheet } from '@/components/record-sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import type { ColumnSpec } from '@/lib/column-layout';
import { formatUbMinute } from '@/lib/dayjs';
import { problemFromError } from '@/lib/problem';
import { useSetParam } from '@/lib/search-params';
import { toast } from '@/lib/toast';
import { useAction } from '@/lib/use-action';
import { useCreateParam } from '@/lib/use-create-param';
import { randomUuid } from '@/lib/uuid';
import {
  type HrPoll,
  type HrPollKind,
  type HrPollQuestion,
  type HrPollQuestionKind,
  useEngagementMutations,
  useHrPolls,
} from '../engagement-api';
import {
  emptyMoment,
  momentInstant,
  percentOf,
  POLL_STATES,
  type PollState,
  pollState,
  useAudience,
} from './community-helpers';
import { AudienceField, MomentField, PictureField, SettingSwitch, ShareBar } from './community-kit';

const STATE_VARIANT = {
  RUNNING: 'success',
  SCHEDULED: 'default',
  ENDED: 'secondary',
  CLOSED: 'outline',
} as const satisfies Record<PollState, string>;

const COLUMNS: readonly ColumnSpec[] = [
  { key: 'title', kind: 'text', weight: 3, min: 16 },
  { key: 'progress', kind: 'text', weight: 1, min: 12 },
  { key: 'dates', kind: 'text', weight: 1, min: 14 },
  { key: 'state', kind: 'status' },
  { key: 'actions', kind: 'actions', actions: 2 },
];

/* ------------------------------------------------------------------ create */

interface QuestionDraft {
  key: number;
  text: string;
  kind: HrPollQuestionKind;
  required: boolean;
  options: string[];
}

const hasOptions = (kind: HrPollQuestionKind) => kind === 'SINGLE' || kind === 'MULTI';
const filledOptions = (question: QuestionDraft) =>
  question.options.map((option) => option.trim()).filter((option) => option !== '');

function OptionsEditor(props: {
  idPrefix: string;
  options: string[];
  onChange: (options: string[]) => void;
  showError: boolean;
}) {
  const { t } = useTranslation();
  const filled = props.options.filter((option) => option.trim() !== '').length;
  return (
    <div className="flex flex-col gap-2">
      <Label>{t('hr.community.polls.fields.options')}</Label>
      <ul className="flex flex-col gap-2">
        {props.options.map((option, index) => {
          const number = index + 1;
          return (
            <li key={index} className="flex items-center gap-2">
              <Input
                aria-label={t('hr.community.polls.fields.optionN', { number })}
                placeholder={t('hr.community.polls.fields.optionN', { number })}
                id={`${props.idPrefix}-option-${index}`}
                maxLength={ENGAGEMENT_LIMITS.maxOptionText}
                value={option}
                onChange={(event) =>
                  props.onChange(
                    props.options.map((value, at) => (at === index ? event.target.value : value)),
                  )
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('hr.community.polls.fields.removeOption', { number })}
                title={t('hr.community.polls.fields.removeOption', { number })}
                disabled={props.options.length <= ENGAGEMENT_LIMITS.minOptions}
                onClick={() => props.onChange(props.options.filter((_, at) => at !== index))}
              >
                <Trash2 />
              </Button>
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.options.length >= ENGAGEMENT_LIMITS.maxOptions}
          onClick={() => props.onChange([...props.options, ''])}
        >
          <Plus />
          {t('hr.community.polls.fields.addOption')}
        </Button>
      </div>
      {props.showError && filled < ENGAGEMENT_LIMITS.minOptions ? (
        <p role="alert" className="text-sm text-destructive">
          {t('hr.community.polls.fields.optionsMissing', { min: ENGAGEMENT_LIMITS.minOptions })}
        </p>
      ) : null}
    </div>
  );
}

function QuestionEditor(props: {
  index: number;
  question: QuestionDraft;
  canRemove: boolean;
  onChange: (question: QuestionDraft) => void;
  onRemove: () => void;
  showError: boolean;
}) {
  const { t } = useTranslation();
  const { question, index } = props;
  const number = index + 1;
  const prefix = `question-${question.key}`;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <legend className="float-left text-[0.8125rem] font-semibold">
          {t('hr.community.polls.fields.questionN', { number })}
        </legend>
        {props.canRemove ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={t('hr.community.polls.fields.removeQuestion', { number })}
            title={t('hr.community.polls.fields.removeQuestion', { number })}
            onClick={props.onRemove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </div>
      <FormField
        label={t('hr.community.polls.fields.questionText')}
        htmlFor={`${prefix}-text`}
        error={props.showError && question.text.trim() === '' ? 'validation.required' : undefined}
      >
        <Input
          id={`${prefix}-text`}
          maxLength={ENGAGEMENT_LIMITS.maxTitle * 2}
          value={question.text}
          onChange={(event) => props.onChange({ ...question, text: event.target.value })}
        />
      </FormField>
      <div className="grid items-center gap-3 sm:grid-cols-2">
        <FormField label={t('hr.community.polls.fields.questionKind')} htmlFor={`${prefix}-kind`}>
          <NativeSelect
            id={`${prefix}-kind`}
            value={question.kind}
            onChange={(event) =>
              props.onChange({ ...question, kind: event.target.value as HrPollQuestionKind })
            }
          >
            {POLL_QUESTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`hr.community.polls.questionKinds.${kind}`)}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <div className="flex items-center gap-2 sm:pt-6">
          <Switch
            id={`${prefix}-required`}
            checked={question.required}
            onCheckedChange={(required) => props.onChange({ ...question, required })}
          />
          <Label htmlFor={`${prefix}-required`}>{t('hr.community.polls.fields.required')}</Label>
        </div>
      </div>
      {hasOptions(question.kind) ? (
        <OptionsEditor
          idPrefix={prefix}
          options={question.options}
          onChange={(options) => props.onChange({ ...question, options })}
          showError={props.showError}
        />
      ) : null}
    </fieldset>
  );
}

const newQuestion = (key: number, kind: HrPollQuestionKind): QuestionDraft => ({
  key,
  text: '',
  kind,
  required: true,
  options: ['', ''],
});

function PollDialog(props: { kind: HrPollKind; onClose: () => void }) {
  const { t } = useTranslation();
  const mutations = useEngagementMutations();
  const action = useAction();
  const audience = useAudience();
  const nextKey = useRef(1);
  const [key] = useState(randomUuid);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [imageFileId, setImageFileId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const [allowChange, setAllowChange] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [starts, setStarts] = useState(() => emptyMoment());
  const [ends, setEnds] = useState(() => emptyMoment('18:00'));
  const [questions, setQuestions] = useState<QuestionDraft[]>(() => [newQuestion(0, 'SINGLE')]);
  const [tried, setTried] = useState(false);
  const isVote = props.kind === 'VOTE';
  const startsAt = momentInstant(starts);
  const endsAt = momentInstant(ends);
  const endTooEarly =
    endsAt !== null && Date.parse(endsAt) <= (startsAt ? Date.parse(startsAt) : Date.now());
  const questionBad = (question: QuestionDraft) =>
    (!isVote && question.text.trim() === '') ||
    (hasOptions(question.kind) && filledOptions(question).length < ENGAGEMENT_LIMITS.minOptions);
  const close = () => {
    action.clear();
    props.onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (title.trim() === '' || audience.missing || endTooEarly || questions.some(questionBad)) {
      return;
    }
    const ok = await action.run(() =>
      mutations.createPoll.mutateAsync({
        key,
        kind: props.kind,
        title: title.trim(),
        note: note.trim() || null,
        imageFileId,
        showResults,
        allowChange,
        anonymous,
        startsAt,
        endsAt,
        userIds: audience.userIds,
        questions: questions.map((question) => ({
          // A vote's one question is its title.
          text: isVote ? title.trim() : question.text.trim(),
          kind: question.kind,
          required: question.required,
          options: hasOptions(question.kind) ? filledOptions(question) : [],
        })),
      }),
    );
    if (ok) {
      toast.success(t(`hr.community.polls.${props.kind}.created`));
      close();
    }
  };
  const update = (at: number, question: QuestionDraft) =>
    setQuestions((prev) => prev.map((value, index) => (index === at ? question : value)));
  const voteQuestion = questions[0];
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogContent closeLabel={t('common.close')} size="lg">
        <DialogHeader>
          <DialogTitle>{t(`hr.community.polls.${props.kind}.create`)}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-4" noValidate onSubmit={(event) => void submit(event)}>
          <ProblemAlert problem={action.problem} />
          <FormField
            label={
              isVote
                ? t('hr.community.polls.fields.voteQuestion')
                : t('hr.community.polls.fields.title')
            }
            htmlFor="poll-title"
            error={tried && title.trim() === '' ? 'validation.required' : undefined}
          >
            <Input
              id="poll-title"
              maxLength={ENGAGEMENT_LIMITS.maxTitle}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          {isVote && voteQuestion ? (
            <OptionsEditor
              idPrefix="vote"
              options={voteQuestion.options}
              onChange={(options) => update(0, { ...voteQuestion, options })}
              showError={tried}
            />
          ) : null}
          <FormField label={t('hr.community.polls.fields.note')} htmlFor="poll-note">
            <Textarea
              id="poll-note"
              rows={2}
              maxLength={ENGAGEMENT_LIMITS.maxNote}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>
          {isVote ? null : (
            <div className="flex flex-col gap-3">
              {questions.map((question, index) => (
                <QuestionEditor
                  key={question.key}
                  index={index}
                  question={question}
                  canRemove={questions.length > 1}
                  onChange={(next) => update(index, next)}
                  onRemove={() =>
                    setQuestions((prev) => prev.filter((value) => value.key !== question.key))
                  }
                  showError={tried}
                />
              ))}
              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={questions.length >= ENGAGEMENT_LIMITS.maxQuestions}
                  onClick={() => {
                    const added = newQuestion(nextKey.current, 'SINGLE');
                    nextKey.current += 1;
                    setQuestions((prev) => [...prev, added]);
                  }}
                >
                  <Plus />
                  {t('hr.community.polls.fields.addQuestion')}
                </Button>
              </div>
            </div>
          )}
          <PictureField
            label={t('hr.community.polls.fields.picture')}
            onChange={setImageFileId}
            onBusy={setUploading}
          />
          <AudienceField audience={audience} showMissing={tried} />
          <div className="grid gap-4 sm:grid-cols-2">
            <MomentField
              id="poll-starts"
              label={t('hr.community.polls.fields.starts')}
              value={starts}
              onChange={setStarts}
            />
            <MomentField
              id="poll-ends"
              label={t('hr.community.polls.fields.ends')}
              min={starts.date || businessDate()}
              value={ends}
              onChange={setEnds}
              error={tried && endTooEarly ? t('hr.community.polls.fields.endTooEarly') : null}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-lg bg-fill/50 p-3">
            <SettingSwitch
              id="poll-show-results"
              label={t('hr.community.polls.fields.showResults')}
              hint={t('hr.community.polls.fields.showResultsHint')}
              checked={showResults}
              onChange={setShowResults}
            />
            <SettingSwitch
              id="poll-allow-change"
              label={t('hr.community.polls.fields.allowChange')}
              hint={t('hr.community.polls.fields.allowChangeHint')}
              checked={allowChange}
              onChange={setAllowChange}
            />
            <SettingSwitch
              id="poll-anonymous"
              label={t('hr.community.polls.fields.anonymous')}
              hint={t('hr.community.polls.fields.anonymousHint')}
              checked={anonymous}
              onChange={setAnonymous}
            />
          </div>
          <DialogFormFooter
            pending={mutations.createPoll.isPending}
            onCancel={close}
            disabled={uploading}
            submitLabel={t('common.create')}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------------------------------------- results */

/** One option's bar: its text, the count and share, and who chose it unless the poll is anonymous. */
export function OptionBars(props: { question: HrPollQuestion; voters?: boolean }) {
  const { t } = useTranslation();
  const total = Math.max(
    props.question.answered,
    props.question.options.reduce((sum, option) => sum + option.count, 0),
  );
  return (
    <ul className="flex flex-col gap-2.5">
      {props.question.options.map((option) => (
        <li key={option.id} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
            <span className="min-w-0 truncate" title={option.text}>
              {option.text}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {t('hr.community.polls.countShare', {
                count: option.count,
                percent: percentOf(option.count, total),
              })}
            </span>
          </div>
          <ShareBar value={option.count} total={total} />
          {props.voters && option.voters.length > 0 ? (
            <p className="text-xs text-muted-foreground">{option.voters.join(', ')}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function QuestionResults({ question }: { question: HrPollQuestion }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{question.text}</h3>
        <span className="text-xs text-muted-foreground">
          {t(`hr.community.polls.questionKinds.${question.kind}`)}
          {' · '}
          {t('hr.community.polls.answeredCount', { count: question.answered })}
        </span>
      </header>
      {question.kind === 'SINGLE' || question.kind === 'MULTI' ? (
        <OptionBars question={question} voters />
      ) : null}
      {question.kind === 'SCALE' ? (
        <p className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums">
            {question.average ?? t('common.none')}
          </span>
          <span className="text-[0.8125rem] text-muted-foreground">
            {t('hr.community.polls.scaleAverage', { max: ENGAGEMENT_LIMITS.scaleMax })}
          </span>
        </p>
      ) : null}
      {question.kind === 'TEXT' ? (
        question.texts.length === 0 ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            {t('hr.community.polls.noAnswers')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {question.texts.map((text, index) => (
              <li key={index} className="rounded-lg bg-fill/60 px-3 py-2 text-[0.8125rem]">
                {text}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}

function PollResultsSheet({ poll, onClose }: { poll: HrPoll; onClose: () => void }) {
  const { t } = useTranslation();
  const state = pollState(poll);
  return (
    <RecordSheet
      open
      onClose={onClose}
      title={poll.title}
      description={t('hr.community.polls.byLine', {
        name: poll.createdByName,
        at: formatUbMinute(poll.createdAt),
      })}
      badges={
        <>
          <Badge variant={STATE_VARIANT[state]}>{t(`hr.community.polls.states.${state}`)}</Badge>
          {poll.anonymous ? (
            <Badge variant="secondary">{t('hr.community.polls.fields.anonymous')}</Badge>
          ) : null}
          <span className="text-[0.8125rem] text-muted-foreground">
            {t('hr.community.polls.respondentsLine', {
              value: poll.respondents,
              total: poll.recipients,
            })}
          </span>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {poll.imageUrl ? (
          <img
            src={poll.imageUrl}
            alt=""
            aria-hidden
            className="max-h-56 w-full rounded-xl bg-secondary object-cover"
          />
        ) : null}
        {poll.note ? <p className="text-sm">{poll.note}</p> : null}
        {poll.questions.map((question) => (
          <QuestionResults key={question.id} question={question} />
        ))}
      </div>
    </RecordSheet>
  );
}

/* -------------------------------------------------------------------- page */

/**
 * «Санал хураалт» and «Судалгаа» (ADR-0146 #3): what is running, how many have answered of those it
 * was sent to, and the results.
 */
export function PollsPage({ kind }: { kind: HrPollKind }) {
  const { t } = useTranslation();
  const canManage = useHasPermission('hr.attendance.manage');
  const polls = useHrPolls(kind);
  const mutations = useEngagementMutations();
  const action = useAction();
  const [creating, setCreating] = useCreateParam();
  const [params, setParams] = useSearchParams();
  const setParam = useSetParam();
  const search = params.get('q') ?? '';
  const state = params.get('state') ?? '';
  const [closing, setClosing] = useState<HrPoll | null>(null);
  const isVote = kind === 'VOTE';
  const rows = useMemo(() => {
    const words = search.trim().toLowerCase();
    return (polls.data ?? []).filter(
      (poll) =>
        (state === '' || pollState(poll) === state) &&
        (words === '' || `${poll.title} ${poll.note ?? ''}`.toLowerCase().includes(words)),
    );
  }, [polls.data, search, state]);
  const open = polls.data?.find((poll) => String(poll.id) === params.get('poll')) ?? null;
  const filtered = search !== '' || state !== '';
  const close = async () => {
    if (!closing) return;
    const ok = await action.run(() => mutations.closePoll.mutateAsync(closing.id));
    if (ok) {
      toast.success(t(`hr.community.polls.${kind}.closed`));
      setClosing(null);
    }
  };
  return (
    <div>
      <PageHeader
        title={isVote ? t('nav.hrPolls') : t('nav.hrSurveys')}
        description={t(`hr.community.polls.${kind}.description`)}
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              {t(`hr.community.polls.${kind}.create`)}
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
          aria-label={t('hr.community.polls.columns.state')}
          value={state}
          onChange={(event) => setParam('state', event.target.value)}
        >
          <option value="">{t('hr.community.polls.allStates')}</option>
          {POLL_STATES.map((value) => (
            <option key={value} value={value}>
              {t(`hr.community.polls.states.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      <ProblemAlert problem={problemFromError(polls.error)} onRetry={polls.refetch} />
      <ListCard scroll>
        {polls.data && rows.length === 0 ? (
          <EmptyState
            title={filtered ? t('hr.community.noMatch') : t(`hr.community.polls.${kind}.empty`)}
            icon={isVote ? Vote : ClipboardList}
            onClearFilters={filtered ? () => setParams({}, { replace: true }) : undefined}
          />
        ) : (
          <ListTable columns={COLUMNS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hr.community.polls.columns.title')}</TableHead>
                <TableHead>{t('hr.community.polls.columns.progress')}</TableHead>
                <TableHead>{t('hr.community.polls.columns.dates')}</TableHead>
                <TableHead>{t('hr.community.polls.columns.state')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {polls.isPending ? <SkeletonRows columns={COLUMNS.length} /> : null}
              {rows.map((poll) => {
                const rowState = pollState(poll);
                return (
                  <TableRow key={poll.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium text-link hover:underline"
                        title={poll.title}
                        onClick={() => setParam('poll', String(poll.id))}
                      >
                        {poll.title}
                      </button>
                      {poll.note ? (
                        <p
                          className="truncate text-[0.8125rem] text-muted-foreground"
                          title={poll.note}
                        >
                          {poll.note}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ShareBar
                          value={poll.respondents}
                          total={poll.recipients}
                          className="min-w-12 flex-1"
                        />
                        <span className="shrink-0 font-mono text-[0.8125rem]">
                          {t('hr.community.ofTotal', {
                            value: poll.respondents,
                            total: poll.recipients,
                          })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-[0.75rem]">
                      <span className="block truncate">{formatUbMinute(poll.startsAt)}</span>
                      <span className="block truncate text-muted-foreground">
                        {poll.endsAt ? formatUbMinute(poll.endsAt) : t('hr.community.polls.noEnd')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[rowState]}>
                        {t(`hr.community.polls.states.${rowState}`)}
                      </Badge>
                    </TableCell>
                    <RowActions>
                      <RowAction
                        label={t('hr.community.polls.resultsFor', { title: poll.title })}
                        icon={BarChart3}
                        onClick={() => setParam('poll', String(poll.id))}
                      />
                      {canManage && (rowState === 'RUNNING' || rowState === 'SCHEDULED') ? (
                        <RowAction
                          label={t('hr.community.polls.closeFor', { title: poll.title })}
                          icon={Lock}
                          destructive
                          onClick={() => setClosing(poll)}
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
      {creating && canManage ? <PollDialog kind={kind} onClose={() => setCreating(false)} /> : null}
      {open ? <PollResultsSheet poll={open} onClose={() => setParam('poll', null)} /> : null}
      <ConfirmDialog
        open={closing !== null}
        title={t('hr.community.polls.closeTitle')}
        description={t('hr.community.polls.closeDescription', { title: closing?.title ?? '' })}
        confirmLabel={t('hr.community.polls.close')}
        pending={mutations.closePoll.isPending}
        problem={action.problem}
        onConfirm={() => void close()}
        onClose={() => {
          action.clear();
          setClosing(null);
        }}
      />
    </div>
  );
}
