import { useLocalSearchParams, useRouter } from 'expo-router';
import { Users } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../../../src/api/problem';
import { useScoring } from '../../../../../src/payroll/api';
import { mayScoreKpi, monthParts } from '../../../../../src/payroll/logic';
import { useSignedIn } from '../../../../../src/state/session';
import { colors, spacing } from '../../../../../src/theme/tokens';
import { Group, Row } from '../../../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../../../src/ui/kit';
import { Page } from '../../../../../src/ui/layout';
import { Pill } from '../../../../../src/ui/staff-kit';
import { StoreHeader } from '../../../../../src/ui/store-header';

/** One draft run's employees with a manual KPI item; a tap opens that person's scores. */
export default function ScoringEmployeesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const { id } = useLocalSearchParams<{ id: string }>();
  const runId = Number(id);
  const scoring = useScoring(runId, mayScoreKpi(me));
  const data = scoring.data;
  const parts = monthParts(data?.month ?? '');

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('payroll.app.scoring')}
        subtitle={
          data ? t('mobile.calendar.month', { year: parts.year, month: parts.month }) : null
        }
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={scoring.isRefetching}
            onRefresh={() => void scoring.refetch()}
          />
        }
      >
        {data && data.lines.length > 0 ? (
          <Group>
            {data.lines.map((line) => {
              const missing = line.items.filter((item) => item.scorePercent === null).length;
              return (
                <Row
                  key={line.lineId}
                  title={line.fullName}
                  subtitle={[line.position, line.divisionName].filter(Boolean).join(' · ') || null}
                  right={
                    missing > 0 ? (
                      <Pill label={String(missing)} tone="warn" />
                    ) : (
                      <Pill label={t('payroll.app.scoredAll')} tone="ok" />
                    )
                  }
                  onPress={() => router.push(`/payroll/scoring/${runId}/${line.lineId}`)}
                />
              );
            })}
          </Group>
        ) : scoring.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : scoring.error ? (
          <ProblemText problem={problemFrom(scoring.error)} />
        ) : (
          <EmptyState
            icon={<Users size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('payroll.app.noEmployees')}
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
