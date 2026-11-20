import { useRouter } from 'expo-router';
import { ClipboardCheck, Target, WalletCards } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import { formatMnt } from '../../../src/format/format';
import { useMyPayslips } from '../../../src/payroll/api';
import { mayScoreKpi, monthParts } from '../../../src/payroll/logic';
import { useSignedIn } from '../../../src/state/session';
import { colors, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * «Миний цалин» (ADR-0235): the person's approved payslips, newest month first, each with what
 * they take in hand; «Миний KPI» above them, and «KPI үнэлгээ» for a scorer. One request.
 */
export default function PayrollScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const slips = useMyPayslips();
  const rows = slips.data ?? [];

  return (
    <Page edges={[]}>
      <StoreHeader title={t('payroll.app.title')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl refreshing={slips.isRefetching} onRefresh={() => void slips.refetch()} />
        }
      >
        <Group inset={ICON_INSET}>
          <Row
            icon={
              <IconTile color={colors.tint.indigo}>
                <Target size={20} strokeWidth={2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('payroll.app.myKpi')}
            onPress={() => router.push('/payroll/terms')}
          />
          {mayScoreKpi(me) ? (
            <Row
              icon={
                <IconTile color={colors.tint.orange}>
                  <ClipboardCheck size={20} strokeWidth={2} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('payroll.app.scoring')}
              onPress={() => router.push('/payroll/scoring')}
            />
          ) : null}
        </Group>
        {rows.length > 0 ? (
          <Group inset={spacing.lg}>
            {rows.map((slip) => {
              const { year, month } = monthParts(slip.month);
              return (
                <Row
                  key={slip.id}
                  title={t('mobile.calendar.month', { year, month })}
                  subtitle={t('payroll.app.netLabel')}
                  right={
                    <Text style={[type.rowStrong, tabular]}>
                      {t('payroll.app.money', { amount: formatMnt(slip.net) })}
                    </Text>
                  }
                  onPress={() => router.push(`/payroll/${slip.month}`)}
                />
              );
            })}
          </Group>
        ) : slips.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : slips.error ? (
          <ProblemText problem={problemFrom(slips.error)} style={styles.problem} />
        ) : (
          <View>
            <EmptyState
              icon={<WalletCards size={40} strokeWidth={1.5} color={colors.muted} />}
              title={t('payroll.app.empty')}
            />
          </View>
        )}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.lg },
  loading: { marginTop: spacing.xl },
  problem: { marginTop: 0 },
});
