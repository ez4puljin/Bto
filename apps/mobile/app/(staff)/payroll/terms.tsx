import { useRouter } from 'expo-router';
import { Target } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import { formatMnt } from '../../../src/format/format';
import { useMyTerms } from '../../../src/payroll/api';
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/** «Миний KPI»: the current fixed salary and the KPI items the person is scored on. */
export default function MyKpiScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const terms = useMyTerms();
  const data = terms.data;
  const money = (value: string) => t('payroll.app.money', { amount: formatMnt(value) });
  const line = (key: string, label: string, value: string, strong = false) => (
    <View key={key} style={styles.line}>
      <Text style={[strong ? type.rowStrong : type.row, styles.grow]}>{label}</Text>
      <Text style={[strong ? type.rowStrong : type.row, tabular]}>{value}</Text>
    </View>
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('payroll.app.myKpi')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl refreshing={terms.isRefetching} onRefresh={() => void terms.refetch()} />
        }
      >
        {data?.hasTerms ? (
          <>
            <Group>
              {[line('base', t('payroll.app.baseSalary'), money(data.baseSalary), true)]}
            </Group>
            {data.items.length > 0 ? (
              <>
                <Text style={[type.sectionHeader, styles.section]}>
                  {t('payroll.app.kpiSection')}
                </Text>
                <Group>
                  {[
                    ...data.items.map((item) => line(item.key, item.name, money(item.amount))),
                    line('total', t('payroll.app.kpiTotal'), money(data.kpiTotal), true),
                  ]}
                </Group>
              </>
            ) : null}
          </>
        ) : terms.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : terms.error ? (
          <ProblemText problem={problemFrom(terms.error)} />
        ) : (
          <EmptyState
            icon={<Target size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('payroll.app.noTerms')}
          />
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  loading: { marginTop: spacing.xl },
  section: { marginTop: spacing.sm, paddingHorizontal: spacing.xs },
  grow: { flex: 1 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
});
