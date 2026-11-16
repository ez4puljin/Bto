import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarDays, Check, EyeOff, Lock, Send, UsersRound, Vote } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  type Poll,
  type PollAnswer,
  type PollQuestion,
  useAnswerPoll,
  useMyPolls,
} from '../../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../../src/api/problem';
import { FirstLoad } from '../../../../src/community/parts';
import { shortDate, ubDate } from '../../../../src/dates/dates';
import { useSignedIn } from '../../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../../src/theme/tokens';
import { PillButton } from '../../../../src/ui/controls';
import { TextField } from '../../../../src/ui/field';
import { EmptyState, ProblemText } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
import { Card, FooterBar, PAGE, Pill, ProgressBar } from '../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../src/ui/store-header';
import { Text } from '../../../../src/ui/text';
import { useToast } from '../../../../src/ui/toast';

interface Draft {
  optionIds: number[];
  text: string;
  value: number | null;
}

const SCALE = Array.from({ length: ENGAGEMENT_LIMITS.scaleMax }, (_, index) => index + 1);

/** The form's start: what the person answered before when they change it, otherwise nothing. */
function draftsOf(poll: Poll): Record<number, Draft> {
  return Object.fromEntries(
    poll.questions.map((question) => [
      question.id,
      {
        optionIds: question.mine.optionIds,
        text: question.mine.text ?? '',
        value: question.mine.value,
      },
    ]),
  );
}

const isAnswered = (question: PollQuestion, draft: Draft | undefined): boolean => {
  if (!draft) return false;
  if (question.kind === 'TEXT') return draft.text.trim() !== '';
  if (question.kind === 'SCALE') return draft.value !== null;
  return draft.optionIds.length > 0;
};

/** The square (several) or round (one) mark before an option. */
function Mark({ on, round }: { on: boolean; round: boolean }) {
  return (
    <View style={[styles.mark, round && styles.markRound, on && styles.markOn]}>
      {on ? <Check size={16} strokeWidth={3} color={colors.primaryForeground} /> : null}
    </View>
  );
}

/** A question's number and words, with what is asked of the answer under them. */
function QuestionHead({
  index,
  question,
  hint,
}: {
  index: number;
  question: PollQuestion;
  hint?: string | null;
}) {
  return (
    <View style={styles.questionHead}>
      <Text style={type.rowStrong}>{`${index + 1}. ${question.text}`}</Text>
      {hint ? <Text style={type.secondary}>{hint}</Text> : null}
    </View>
  );
}

/** One question to answer: radio, checkboxes, a text field or the 1..5 chips. */
function QuestionForm({
  index,
  question,
  draft,
  missing,
  onChange,
}: {
  index: number;
  question: PollQuestion;
  draft: Draft;
  missing: boolean;
  onChange: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const multi = question.kind === 'MULTI';
  const hint = [
    question.required ? t('mobile.community.polls.required') : null,
    multi ? t('mobile.community.polls.many') : null,
    question.kind === 'SCALE'
      ? t('mobile.community.polls.scaleLabel', { max: ENGAGEMENT_LIMITS.scaleMax })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const error = missing ? (
    <Text style={[type.secondary, styles.error]}>{t('mobile.community.polls.missing')}</Text>
  ) : null;

  if (question.kind === 'SINGLE' || multi) {
    return (
      <Card flush>
        <View style={styles.optionsHead}>
          <QuestionHead index={index} question={question} hint={hint} />
          {error}
        </View>
        {question.options.map((option, at) => {
          const on = draft.optionIds.includes(option.id);
          return (
            <Pressable
              key={option.id}
              accessibilityRole={multi ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: on }}
              onPress={() =>
                onChange({
                  ...draft,
                  optionIds: multi
                    ? on
                      ? draft.optionIds.filter((id) => id !== option.id)
                      : [...draft.optionIds, option.id]
                    : [option.id],
                })
              }
              style={({ pressed }) => [
                styles.option,
                at > 0 && styles.optionRule,
                on && styles.optionOn,
                pressed && !on && styles.pressed,
              ]}
            >
              <Mark on={on} round={!multi} />
              <Text style={[on ? type.rowStrong : type.row, styles.grow]}>{option.text}</Text>
            </Pressable>
          );
        })}
      </Card>
    );
  }
  return (
    <Card style={styles.question}>
      <QuestionHead index={index} question={question} hint={hint} />
      {question.kind === 'TEXT' ? (
        <TextField
          label={t('mobile.community.polls.textLabel')}
          value={draft.text}
          onChangeText={(text) => onChange({ ...draft, text })}
          maxLength={ENGAGEMENT_LIMITS.maxAnswerText}
          multiline
        />
      ) : null}
      {question.kind === 'SCALE' ? (
        <View accessibilityRole="radiogroup" style={styles.scale}>
          {SCALE.map((value) => {
            const on = draft.value === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityLabel={String(value)}
                accessibilityState={{ checked: on }}
                hitSlop={{ top: 4, bottom: 4 }}
                onPress={() => onChange({ ...draft, value })}
                style={[styles.step, on && styles.stepOn]}
              >
                <Text style={[styles.stepText, tabular, on && styles.stepTextOn]}>
                  {String(value)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {error}
    </Card>
  );
}

/** A question's counts: bars per option, the scale's average, the written answers unnamed. */
function QuestionResults({ index, question }: { index: number; question: PollQuestion }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.question}>
      <QuestionHead index={index} question={question} />
      {question.options.map((option) => {
        const percent =
          question.answered > 0 ? Math.round((option.count * 100) / question.answered) : 0;
        const mine = question.mine.optionIds.includes(option.id);
        return (
          <View
            key={option.id}
            style={styles.result}
            accessibilityLabel={
              mine ? `${option.text}, ${t('mobile.community.polls.chosen')}` : option.text
            }
          >
            <View style={styles.resultHead}>
              {mine ? <Check size={16} strokeWidth={2.6} color={colors.primary} /> : null}
              <Text style={[type.body, styles.grow, mine && styles.mine]}>{option.text}</Text>
              <Text style={[type.secondary, tabular]}>
                {t('mobile.community.polls.optionCount', { count: option.count, percent })}
              </Text>
            </View>
            <ProgressBar value={percent / 100} color={mine ? colors.primary : colors.input} />
          </View>
        );
      })}
      {question.kind === 'SCALE' ? (
        <Text style={[type.body, tabular]}>
          {question.average !== null
            ? `${t('mobile.community.polls.average', { value: question.average })} · ${t('mobile.community.polls.answered', { n: question.answered })}`
            : t('mobile.community.polls.answered', { n: question.answered })}
        </Text>
      ) : null}
      {question.kind === 'TEXT'
        ? question.texts.map((text, at) => (
            <Text key={`${at}-${text}`} style={[type.body, styles.written]}>
              {text}
            </Text>
          ))
        : null}
      {question.kind === 'SCALE' && question.mine.value !== null ? (
        <Text style={type.secondary}>
          {`${t('mobile.community.polls.mine')}: ${question.mine.value}`}
        </Text>
      ) : null}
    </Card>
  );
}

/** What the person answered, when the poll keeps its counts to HR. */
function QuestionMine({ index, question }: { index: number; question: PollQuestion }) {
  const { t } = useTranslation();
  const chosen = question.options
    .filter((option) => question.mine.optionIds.includes(option.id))
    .map((option) => option.text);
  const answer =
    question.kind === 'TEXT'
      ? question.mine.text
      : question.kind === 'SCALE'
        ? question.mine.value === null
          ? null
          : String(question.mine.value)
        : chosen.join(', ');
  return (
    <Card style={styles.question}>
      <QuestionHead index={index} question={question} />
      <Text style={[type.body, answer ? styles.answer : styles.none]}>
        {answer || t('mobile.community.polls.noAnswer')}
      </Text>
    </Card>
  );
}

/**
 * A vote or a survey (ADR-0146): open and unanswered, the form over its questions, the required
 * ones checked here before the server does; answered or closed, read only, with the option bars
 * when `resultsShown`; `allowChange` lets the person answer again while it is open.
 */
export default function PollScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const polls = useMyPolls();
  const id = Number.parseInt(params.id, 10);
  const poll = polls.data?.find((entry) => entry.id === id);
  return (
    <Page edges={[]}>
      <StoreHeader
        title={t(
          poll?.kind === 'SURVEY'
            ? 'mobile.community.polls.surveyTitle'
            : 'mobile.community.polls.pollTitle',
        )}
        onBack={() => router.back()}
      />
      {poll ? (
        <PollBody poll={poll} />
      ) : (
        <FirstLoad query={polls}>
          <EmptyState
            icon={<Vote size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('mobile.community.polls.gone')}
          />
        </FirstLoad>
      )}
    </Page>
  );
}

function PollBody({ poll }: { poll: Poll }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { server } = useSignedIn();
  const answer = useAnswerPoll();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => draftsOf(poll));
  const [missing, setMissing] = useState<ReadonlySet<number>>(new Set());
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const answering = poll.open && (!poll.answered || editing);
  const blank: Draft = { optionIds: [], text: '', value: null };

  const submit = () => {
    const unanswered = poll.questions.filter(
      (question) => question.required && !isAnswered(question, drafts[question.id]),
    );
    setMissing(new Set(unanswered.map((question) => question.id)));
    setProblem(null);
    if (unanswered.length > 0) return;
    const answers = poll.questions.flatMap((question): PollAnswer[] => {
      const draft = drafts[question.id];
      if (!draft || !isAnswered(question, draft)) return [];
      if (question.kind === 'TEXT') return [{ questionId: question.id, text: draft.text.trim() }];
      if (question.kind === 'SCALE') return [{ questionId: question.id, value: draft.value }];
      return [{ questionId: question.id, optionIds: draft.optionIds }];
    });
    answer.mutate(
      { id: poll.id, answers },
      {
        onSuccess: () => {
          setEditing(false);
          toast.show({ message: t('mobile.community.polls.sent') });
        },
        onError: (failure) => setProblem(problemFrom(failure)),
      },
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Card flush>
          {poll.imageUrl ? (
            <Image
              source={{ uri: `${server}${poll.imageUrl}` }}
              style={styles.picture}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <View style={styles.headText}>
            <Text accessibilityRole="header" style={type.title3}>
              {poll.title}
            </Text>
            {poll.note ? <Text style={[type.body, styles.answer]}>{poll.note}</Text> : null}
            <View style={styles.pills}>
              {poll.open && poll.endsAt ? (
                <Pill
                  icon={CalendarDays}
                  label={t('mobile.community.polls.until', {
                    date: shortDate(ubDate(poll.endsAt)),
                  })}
                />
              ) : null}
              {poll.open ? null : (
                <Pill icon={Lock} tone="bad" label={t('mobile.community.polls.closedNote')} />
              )}
              {poll.anonymous ? (
                <Pill
                  icon={EyeOff}
                  label={t('mobile.community.polls.anonymous')}
                  style={styles.shrink}
                />
              ) : null}
              {!answering && poll.resultsShown ? (
                <Pill
                  icon={UsersRound}
                  label={t('mobile.community.polls.respondents', { n: poll.respondents })}
                />
              ) : null}
            </View>
          </View>
        </Card>

        {poll.questions.map((question, index) =>
          answering ? (
            <QuestionForm
              key={question.id}
              index={index}
              question={question}
              draft={drafts[question.id] ?? blank}
              missing={missing.has(question.id)}
              onChange={(draft) => {
                setDrafts((current) => ({ ...current, [question.id]: draft }));
                setMissing((current) => {
                  if (!current.has(question.id)) return current;
                  const next = new Set(current);
                  next.delete(question.id);
                  return next;
                });
              }}
            />
          ) : poll.resultsShown ? (
            <QuestionResults key={question.id} index={index} question={question} />
          ) : (
            <QuestionMine key={question.id} index={index} question={question} />
          ),
        )}
        {!answering && !poll.resultsShown ? (
          <Text style={[type.secondary, styles.center]}>
            {t('mobile.community.polls.noResults')}
          </Text>
        ) : null}
        <ProblemText problem={problem} style={styles.problem} />
        {answering && missing.size > 0 ? (
          <Text style={[type.secondary, styles.error, styles.center]}>
            {t('mobile.community.polls.missingAll', { n: missing.size })}
          </Text>
        ) : null}
      </ScrollView>

      {answering ? (
        <FooterBar>
          {editing ? (
            <PillButton
              style={styles.flex}
              variant="soft"
              title={t('mobile.community.polls.cancelChange')}
              onPress={() => {
                setEditing(false);
                setMissing(new Set());
                setProblem(null);
              }}
            />
          ) : null}
          <PillButton
            style={styles.flex}
            title={t('mobile.community.polls.send')}
            icon={<Send size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
            loading={answer.isPending}
            onPress={submit}
          />
        </FooterBar>
      ) : poll.open && poll.allowChange ? (
        <FooterBar>
          <PillButton
            style={styles.flex}
            variant="soft"
            title={t('mobile.community.polls.change')}
            onPress={() => {
              setDrafts(draftsOf(poll));
              setProblem(null);
              setEditing(true);
            }}
          />
        </FooterBar>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const MARK = 24;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  body: { padding: PAGE.padding, gap: PAGE.gap },
  picture: { width: '100%', height: 176 },
  headText: { padding: spacing.lg, gap: spacing.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  question: { gap: spacing.md },
  questionHead: { gap: spacing.xs },
  optionsHead: {
    gap: spacing.xs,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  optionRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionOn: { backgroundColor: colors.secondary },
  pressed: { backgroundColor: colors.accent },
  mark: {
    width: MARK,
    height: MARK,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.fieldBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markRound: { borderRadius: MARK / 2 },
  markOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  scale: { flexDirection: 'row', gap: spacing.sm },
  step: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepText: { ...type.chip, color: colors.label2 },
  stepTextOn: { color: colors.primaryForeground, fontFamily: fonts.semibold },
  error: { color: colors.destructive },
  center: { textAlign: 'center' },
  answer: { color: colors.label2 },
  none: { color: colors.muted },
  mine: { fontFamily: fonts.semibold },
  result: { gap: spacing.xs },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  written: {
    padding: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.canvas,
  },
  problem: { marginTop: 0 },
});
