import { useLocalSearchParams, useRouter } from 'expo-router';
import { WalletCards } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { problemFrom } from '../../../src/api/problem';
import { formatMnt } from '../../../src/format/format';
import { type Payslip, type PayslipItem, useMyPayslips } from '../../../src/payroll/api';
import { isZero, monthParts, percentText, salaryFraction } from '../../../src/payroll/logic';
import { colors, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { Card } from '../../../src/ui/staff-kit';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';

/**
 * One month's payslip (ADR-0235), whole: the fixed salary, each KPI item with its score and what
 * it earned, the additions and deductions, the total, НДШ and ХХОАТ when present, the advance,
 * and «Гарт олгох» big. It reads the list's cache: no second request.
 */
export default function PayslipScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { month = '' } = useLocalSearchParams<{ month: string }>();
  const slips = useMyPayslips();
  const slip = slips.data?.find((one) => one.month === month);
  const parts = monthParts(month);
  const money = (value: string) => t('payroll.app.money', { amount: formatMnt(value) });

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.calendar.month', { year: parts.year, month: parts.month })}
        subtitle={slip?.fullName ?? null}
        onBack={() => router.back()}
      />
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
        ]}
        refreshControl={
          <RefreshControl refreshing={slips.isRefetching} onRefresh={() => void slips.refetch()} />
        }
      >
        {slip ? (
          <Slip slip={slip} money={money} />
        ) : slips.isLoading ? (
          <ActivityIndicator style={styles.loading} color={colors.primary} />
        ) : slips.error ? (
          <ProblemText problem={problemFrom(slips.error)} />
        ) : (
          <EmptyState
            icon={<WalletCards size={40} strokeWidth={1.5} color={colors.muted} />}
            title={t('payroll.app.empty')}
          />
        )}
      </ScrollView>
    </Page>
  );
}

function Line({
  label,
  value,
  strong = false,
  negative = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[strong ? type.rowStrong : type.row, styles.grow]}>{label}</Text>
      <Text style={[strong ? type.rowStrong : type.row, tabular, negative && styles.negative]}>
        {value}
      </Text>
    </View>
  );
}

function Slip({ slip, money }: { slip: Payslip; money: (value: string) => string }) {
  const { t } = useTranslation();
  const prorated = salaryFraction(slip);
  return (
    <>
      <Group>
        <View>
          <Line label={t('payroll.app.baseSalary')} value={money(slip.baseSalary)} strong />
          {prorated ? (
            <Text style={[type.secondary, styles.fraction]}>
              {t('payroll.salaryDays', prorated)}
            </Text>
          ) : null}
        </View>
      </Group>

      {slip.items.length > 0 ? (
        <>
          <Text style={[type.sectionHeader, styles.section]}>{t('payroll.app.kpiSection')}</Text>
          {slip.items.map((item) => (
            <KpiItem key={item.id} item={item} slip={slip} money={money} />
          ))}
        </>
      ) : null}

      {slip.adjustments.length > 0 ? (
        <>
          <Text style={[type.sectionHeader, styles.section]}>{t('payroll.app.adjustments')}</Text>
          <Group>
            {slip.adjustments.map((line) => (
              <Line
                key={line.id}
                label={line.name}
                value={`${line.kind === 'DEDUCTION' ? '−' : '+'}${money(line.amount)}`}
                negative={line.kind === 'DEDUCTION'}
              />
            ))}
          </Group>
        </>
      ) : null}

      <Group>
        <Line label={t('payroll.app.gross')} value={money(slip.gross)} strong />
        {isZero(slip.employeeSi) ? null : (
          <Line label={t('payroll.app.si')} value={`−${money(slip.employeeSi)}`} negative />
        )}
        {isZero(slip.pit) ? null : (
          <Line label={t('payroll.app.pit')} value={`−${money(slip.pit)}`} negative />
        )}
        {isZero(slip.advance) ? null : (
          <Line label={t('payroll.app.advance')} value={`−${money(slip.advance)}`} negative />
        )}
      </Group>

      <Card style={styles.net}>
        <Text style={type.secondary}>{t('payroll.app.netLabel')}</Text>
        <Text
          style={[type.display, tabular, styles.netValue]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {money(slip.net)}
        </Text>
      </Card>
    </>
  );
}

function KpiItem({
  item,
  slip,
  money,
}: {
  item: PayslipItem;
  slip: Payslip;
  money: (value: string) => string;
}) {
  const { t } = useTranslation();
  const attendance = item.source === 'ATTENDANCE';
  const score = percentText(item.scorePercent);
  return (
    <Card style={styles.item}>
      <Text style={[type.rowStrong, styles.itemName]}>{item.name}</Text>
      <Line label={t('payroll.app.itemAmount')} value={money(item.amount)} />
      <Line
        label={t('payroll.app.itemScore')}
        value={score === null ? t('payroll.app.notScored') : `${score}%`}
      />
      <Line label={t('payroll.app.itemEarned')} value={money(item.earned)} strong />
      {attendance && slip.attendanceMeasured ? (
        <>
          <Line label={t('payroll.app.workdays')} value={String(slip.workdays ?? 0)} />
          <Line label={t('payroll.app.attended')} value={String(slip.attendedDays ?? 0)} />
          <Line label={t('payroll.app.late')} value={String(slip.lateDays ?? 0)} />
          <Line
            label={t('payroll.app.penalty')}
            value={`${percentText(item.penaltyPercent) ?? '0'}%`}
          />
        </>
      ) : null}
      {item.note ? (
        <Text style={type.secondary}>{`${t('payroll.app.note')}: ${item.note}`}</Text>
      ) : null}
    </Card>
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
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  negative: { color: colors.destructive },
  fraction: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, marginTop: -spacing.xs },
  itemName: { paddingHorizontal: spacing.lg },
  item: { paddingHorizontal: 0, gap: 0, paddingVertical: spacing.md },
  net: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
    borderRadius: radii.card,
  },
  netValue: { color: colors.primary },
});
