import { useRouter } from 'expo-router';
import { ClipboardCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../../src/api/problem';
import { useScoringRuns } from '../../../../src/payroll/api';
import { mayScoreKpi, monthParts } from '../../../../src/payroll/logic';
import { useSignedIn } from '../../../../src/state/session';
import { colors, spacing } from '../../../../src/theme/tokens';
import { Group, Row } from '../../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../../src/ui/kit';
import { Page } from '../../../../src/ui/layout';
import { Pill } from '../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../src/ui/store-header';

/** «KPI үнэлгээ»: the draft runs, newest first, with how many manual scores are still missing. */
export default function ScoringRunsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const allowed = mayScoreKpi(me);
  const runs = useScoringRuns(allowed);
  const drafts = (runs.data ?? []).filter((run) => run.status === 'DRAFT');

  return (
    <Page edges={[]}>
      <StoreHeader title={t('payroll.app.scoring')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl refreshing={runs.isRefetching} onRefresh={() => void runs.refetch()} />
        }
      >
        {drafts.length > 0 ? (
          <Group>
            {drafts.map((run) => {
              const { year, month } = monthParts(run.month);
              return (
                <Row
                  key={run.runId}
                  title={t('mobile.calendar.month', { year, month })}
                  subtitle={t('payroll.app.unscoredOf', {
                    unscored: run.unscoredCount,
                    total: run.manualCount,
                  })}
                  right={
                    run.unscoredCount > 0 ? (
                      <Pill label={String(run.unscoredCount)} tone="warn" />
                    ) : (
                      <Pill label={t('payroll.app.scoredAll')} tone="ok" />
                    )
                  }
                  onPress={() => router.push(`/payroll/scoring/${run.runId}`)}
                />
              );
            })}
          </Group>
        ) : !allowed ? (
          <EmptyState title={t('payroll.app.noRight')} />
        ) : runs.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : runs.error ? (
          <ProblemText problem={problemFrom(runs.error)} />
        ) : (
          <EmptyState
            icon={<ClipboardCheck size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('payroll.app.noDrafts')}
          />
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  loading: { marginTop: spacing.xl },
});
