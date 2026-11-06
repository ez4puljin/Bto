import { ENGAGEMENT_LIMITS } from '@tugeel/shared/hr';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Check, Circle, CircleCheck, Square, SquareCheck, Vote } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  type Poll,
  type PollAnswer,
  type PollQuestion,
  useAnswerPoll,
  useMyPolls,
} from '../../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../../src/api/problem';
import { FirstLoad } from '../../../../src/community/parts';
import { ubDate } from '../../../../src/dates/dates';
import { useSignedIn } from '../../../../src/state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../../../../src/theme/tokens';
import { ChoiceChip, PillButton } from '../../../../src/ui/controls';
import { TextField } from '../../../../src/ui/field';
import { Group, Row } from '../../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
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

/** One question to answer: radio, checkboxes, a text field or the 1..5 chips. */
function QuestionForm({
  question,
  draft,
  missing,
  onChange,
}: {
  question: PollQuestion;
  draft: Draft;
  missing: boolean;
  onChange: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const multi = question.kind === 'MULTI';
  return (
    <View style={styles.question}>
      <Text style={type.rowStrong}>{question.text}</Text>
      {question.required || multi ? (
        <Text style={type.secondary}>
          {[
            question.required ? t('mobile.community.polls.required') : null,
            multi ? t('mobile.community.polls.many') : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      {question.kind === 'SINGLE' || multi ? (
        <Group inset={spacing.lg + 22 + spacing.md} style={styles.options}>
          {question.options.map((option) => {
            const on = draft.optionIds.includes(option.id);
            const Mark = multi ? (on ? SquareCheck : Square) : on ? CircleCheck : Circle;
            return (
              <Row
                key={option.id}
                role={multi ? 'checkbox' : 'radio'}
                chevron={false}
                title={option.text}
                icon={<Mark size={22} strokeWidth={2} color={on ? colors.primary : colors.input} />}
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
              />
            );
          })}
        </Group>
      ) : null}
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
        <>
          <Text style={type.secondary}>
            {t('mobile.community.polls.scaleLabel', { max: ENGAGEMENT_LIMITS.scaleMax })}
          </Text>
          <View style={styles.scale}>
            {SCALE.map((value) => (
              <ChoiceChip
                key={value}
                label={String(value)}
                selected={draft.value === value}
                onWhite
                onPress={() => onChange({ ...draft, value })}
              />
            ))}
          </View>
        </>
      ) : null}
      {missing ? (
        <Text style={[type.secondary, styles.error]}>{t('mobile.community.polls.missing')}</Text>
      ) : null}
    </View>
  );
}

/** A question's counts: bars per option, the scale's average, the written answers unnamed. */
function QuestionResults({ question }: { question: PollQuestion }) {
  const { t } = useTranslation();
  return (
    <View style={styles.question}>
      <Text style={type.rowStrong}>{question.text}</Text>
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
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  { width: `${percent}%`, backgroundColor: mine ? colors.primary : colors.input },
                ]}
              />
            </View>
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
        ? question.texts.map((text, index) => (
            <Text key={`${index}-${text}`} style={[type.body, styles.written]}>
              {text}
            </Text>
          ))
        : null}
      {question.kind === 'SCALE' && question.mine.value !== null ? (
        <Text style={type.secondary}>
          {`${t('mobile.community.polls.mine')}: ${question.mine.value}`}
        </Text>
      ) : null}
    </View>
  );
}

/** What the person answered, when the poll keeps its counts to HR. */
function QuestionMine({ question }: { question: PollQuestion }) {
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
    <View style={styles.question}>
      <Text style={type.rowStrong}>{question.text}</Text>
      <Text style={[type.body, !answer && styles.none]}>
        {answer || t('mobile.community.polls.noAnswer')}
      </Text>
    </View>
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
        right={null}
      />
      {poll ? (
        <PollBody poll={poll} />
      ) : (
        <FirstLoad query={polls}>
          <EmptyState
            icon={<Vote size={44} strokeWidth={1.5} color={colors.input} />}
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
  const insets = useSafeAreaInsets();
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
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.head}>
          {poll.imageUrl ? (
            <Image
              source={{ uri: `${server}${poll.imageUrl}` }}
              style={styles.picture}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
          <View style={styles.headText}>
            <Text style={type.title3}>{poll.title}</Text>
            {poll.note ? <Text style={type.body}>{poll.note}</Text> : null}
            {poll.open && poll.endsAt ? (
              <Text style={type.secondary}>
                {t('mobile.community.polls.until', { date: ubDate(poll.endsAt) })}
              </Text>
            ) : null}
            {poll.open ? null : (
              <Text style={[type.secondary, styles.closed]}>
                {t('mobile.community.polls.closedNote')}
              </Text>
            )}
            {poll.anonymous ? (
              <Text style={type.secondary}>{t('mobile.community.polls.anonymous')}</Text>
            ) : null}
            {!answering && poll.resultsShown ? (
              <Text style={type.secondary}>
                {t('mobile.community.polls.respondents', { n: poll.respondents })}
              </Text>
            ) : null}
          </View>
        </View>

        {poll.questions.map((question) =>
          answering ? (
            <QuestionForm
              key={question.id}
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
            <QuestionResults key={question.id} question={question} />
          ) : (
            <QuestionMine key={question.id} question={question} />
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
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {editing ? (
            <PillButton
              style={styles.flex}
              variant="white"
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
            loading={answer.isPending}
            onPress={submit}
          />
        </View>
      ) : poll.open && poll.allowChange ? (
        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <PillButton
            style={styles.flex}
            variant="white"
            title={t('mobile.community.polls.change')}
            onPress={() => {
              setDrafts(draftsOf(poll));
              setProblem(null);
              setEditing(true);
            }}
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  body: { padding: 14, paddingBottom: 24, gap: spacing.md },
  head: { borderRadius: radii.card, backgroundColor: colors.card, overflow: 'hidden' },
  picture: { width: '100%', height: 176 },
  headText: { padding: spacing.lg, gap: 6 },
  closed: { color: colors.destructiveText, fontFamily: fonts.semibold },
  question: {
    padding: spacing.lg,
    gap: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  options: { marginHorizontal: -spacing.lg, borderRadius: 0 },
  scale: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  error: { color: colors.destructiveText },
  center: { textAlign: 'center' },
  none: { color: colors.muted },
  mine: { fontFamily: fonts.semibold },
  result: { gap: 4 },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.fill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  written: {
    padding: spacing.sm,
    borderRadius: radii.field,
    backgroundColor: colors.imageFill,
  },
  problem: { marginTop: 0 },
  bar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    backgroundColor: colors.canvas,
  },
});
