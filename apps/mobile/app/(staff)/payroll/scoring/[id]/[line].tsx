import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppProblem, problemFrom } from '../../../../../src/api/problem';
import {
  type ScoreEntry,
  type ScoringLine,
  useSaveScores,
  useScoring,
} from '../../../../../src/payroll/api';
import { mayScoreKpi, parseScore, percentText } from '../../../../../src/payroll/logic';
import { useSignedIn } from '../../../../../src/state/session';
import { colors, radii, spacing, type } from '../../../../../src/theme/tokens';
import { PillButton } from '../../../../../src/ui/controls';
import { EmptyState, ProblemText } from '../../../../../src/ui/kit';
import { Page } from '../../../../../src/ui/layout';
import { Card, FooterBar } from '../../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../../src/ui/store-header';
import { Text, TextInput } from '../../../../../src/ui/text';
import { useToast } from '../../../../../src/ui/toast';

/**
 * One employee's manual KPI items: a score percent (0–100, empty takes it back) and a note for
 * each, saved together. The api gives no money here, so none is shown.
 */
export default function ScoreEmployeeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me } = useSignedIn();
  const params = useLocalSearchParams<{ id: string; line: string }>();
  const runId = Number(params.id);
  const scoring = useScoring(runId, mayScoreKpi(me));
  const line = scoring.data?.lines.find((one) => one.lineId === Number(params.line));

  return (
    <Page edges={[]}>
      <StoreHeader
        title={line?.fullName ?? t('payroll.app.scoring')}
        onBack={() => router.back()}
      />
      {line && scoring.data ? (
        <Form key={line.lineId} runId={runId} line={line} draft={scoring.data.status === 'DRAFT'} />
      ) : scoring.isLoading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : scoring.error ? (
        <ProblemText problem={problemFrom(scoring.error)} style={styles.problemBox} />
      ) : (
        <EmptyState title={t('payroll.app.noEmployees')} />
      )}
    </Page>
  );
}

function Form({ runId, line, draft }: { runId: number; line: ScoringLine; draft: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const save = useSaveScores(runId);
  const [scores, setScores] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      line.items.map((item) => [item.itemId, percentText(item.scorePercent) ?? '']),
    ),
  );
  const [notes, setNotes] = useState<Record<number, string>>(() =>
    Object.fromEntries(line.items.map((item) => [item.itemId, item.note ?? ''])),
  );
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [invalid, setInvalid] = useState<Set<number>>(new Set());

  const submit = () => {
    const bad = new Set<number>();
    const entries: ScoreEntry[] = [];
    for (const item of line.items) {
      const parsed = parseScore(scores[item.itemId] ?? '');
      if (!parsed.ok) {
        bad.add(item.itemId);
        continue;
      }
      const value = parsed.value;
      const note = (notes[item.itemId] ?? '').trim();
      const before = percentText(item.scorePercent);
      const same =
        value === before || (value !== null && before !== null && Number(value) === Number(before));
      if (same && note === (item.note ?? '')) continue;
      entries.push({ itemId: item.itemId, scorePercent: value, note: note === '' ? null : note });
    }
    setInvalid(bad);
    if (bad.size > 0) return;
    if (entries.length === 0) {
      router.back();
      return;
    }
    setProblem(null);
    save.mutate(entries, {
      onSuccess: () => {
        toast.show({ message: t('payroll.app.saved') });
        router.back();
      },
      onError: (error) => setProblem(problemFrom(error)),
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={type.secondary}>
          {[line.position, line.divisionName].filter(Boolean).join(' · ')}
        </Text>
        {line.items.map((item) => (
          <Card key={item.itemId} style={styles.card}>
            <Text style={type.rowStrong}>{item.name}</Text>
            <View style={styles.field}>
              <Text style={type.label}>{t('payroll.app.scorePercent')}</Text>
              <TextInput
                value={scores[item.itemId] ?? ''}
                onChangeText={(text) => setScores((prev) => ({ ...prev, [item.itemId]: text }))}
                keyboardType="decimal-pad"
                editable={draft}
                maxLength={6}
                placeholder="0–100"
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={`${item.name}: ${t('payroll.app.scorePercent')}`}
                style={[type.field, styles.input, invalid.has(item.itemId) && styles.invalid]}
              />
              {invalid.has(item.itemId) ? (
                <Text style={[type.secondary, styles.invalidText]}>
                  {t('payroll.app.scoreRange')}
                </Text>
              ) : null}
            </View>
            <View style={styles.field}>
              <Text style={type.label}>{t('payroll.app.note')}</Text>
              <TextInput
                value={notes[item.itemId] ?? ''}
                onChangeText={(text) => setNotes((prev) => ({ ...prev, [item.itemId]: text }))}
                editable={draft}
                multiline
                maxLength={300}
                accessibilityLabel={`${item.name}: ${t('payroll.app.note')}`}
                style={[type.field, styles.input, styles.noteInput]}
              />
            </View>
            {item.scoredByName ? (
              <Text style={type.secondary}>
                {t('payroll.app.scoredBy', { name: item.scoredByName })}
              </Text>
            ) : null}
          </Card>
        ))}
        <ProblemText problem={problem} style={styles.problem} />
      </ScrollView>
      <FooterBar>
        <PillButton
          title={t('common.save')}
          onPress={submit}
          loading={save.isPending}
          disabled={!draft}
          style={styles.flex}
        />
      </FooterBar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  problemBox: { margin: spacing.lg },
  problem: { marginTop: 0 },
  card: { gap: spacing.md },
  field: { gap: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    color: colors.foreground,
  },
  noteInput: { minHeight: 64, textAlignVertical: 'top' },
  invalid: { borderColor: colors.destructive },
  invalidText: { color: colors.destructive },
});
