import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { STORE_KEY, useStoreBalance, useStoreMe } from '../api/customer';
import { problemFrom } from '../api/problem';
import { monthDay } from '../dates/calendar';
import { formatMnt } from '../format/format';
import { useCustomer } from '../state/session';
import { colors, fonts, radii, spacing, tabular, type } from '../theme/tokens';
import { ProblemText } from '../ui/kit';
import { Text } from '../ui/text';
import { creditBarOf, debtOf, settlementCardOf } from './account';
import { StatementPanel } from './statement-panel';

/**
 * «Тооцоо» (the Account board, ADR-0079 #7; redrawn by the owner's word 2026-11-06, ADR-0167), read
 * only from finance's own figures, a part of the «Захиалга» tab: the blue card with the debt (or an
 * advance), a credit hold (never its reason), what remains of the credit limit (only when one is
 * set), «Тооцоо хийх өдөр» with the amount due by then and its overdue part (ADR-0101 #6); then the
 * statement. The company's accounts open from the header's ⓘ (`BankInfoSheet`).
 */
export function AccountPanel({ bottom }: { bottom: number }) {
  const { t } = useTranslation();
  const me = useStoreMe();
  const balance = useStoreBalance();
  const queryClient = useQueryClient();
  const { me: signedIn } = useCustomer();
  const today = me.data?.today ?? signedIn.store.today;
  const [refreshing, setRefreshing] = useState(false);

  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const account = balance.data;
  const problem = balance.error ?? me.error ?? null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        me.refetch(),
        balance.refetch(),
        queryClient.invalidateQueries({ queryKey: [...STORE_KEY, 'statement'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const debt = account ? debtOf(account.balance) : null;
  const credit = account ? creditBarOf(account) : null;
  // Blue while nothing is overdue, red once something is (ADR-0101 #6, the Account board).
  const settlement = account?.settlement ?? null;
  const card = settlement ? settlementCardOf(settlement) : null;
  const ink = card?.tone === 'overdue' ? colors.destructiveText : colors.newBadge;
  const purchases = card
    ? card.purchases.kind === 'month'
      ? t('mobile.customer.account.purchasesMonth', { month: card.purchases.month })
      : t('mobile.customer.account.purchasesRange', {
          from: monthDay(card.purchases.from),
          to: monthDay(card.purchases.to),
        })
    : null;

  return (
    <ScrollView
      contentContainerStyle={[styles.body, { paddingBottom: bottom + spacing.lg }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      {account && debt ? (
        <View style={styles.hero}>
          <View style={styles.heroHead}>
            <Text style={styles.heroLabel}>
              {debt.kind === 'advance'
                ? t('mobile.customer.account.advance')
                : t('mobile.customer.account.debt')}
            </Text>
            {account.creditHold ? (
              <View style={styles.hold}>
                <Lock size={12} strokeWidth={2.4} color={colors.blocked} />
                <Text style={styles.holdText}>{t('mobile.customer.account.creditHold')}</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
            {debt.kind === 'clear' ? t('mobile.customer.account.clear') : money(debt.amount)}
          </Text>
          {me.data ? (
            <Text style={styles.heroAsOf} numberOfLines={1}>
              {t('mobile.customer.account.asOf', {
                store: me.data.name,
                date: monthDay(me.data.today),
              })}
            </Text>
          ) : null}

          {credit ? (
            <View style={styles.credit}>
              <View style={styles.creditLine}>
                <Text style={[styles.heroAsOf, styles.grow]} numberOfLines={1}>
                  {t('mobile.customer.account.creditLeft')}
                </Text>
                <Text style={styles.creditValue} numberOfLines={1}>
                  {t('mobile.customer.account.creditOf', {
                    available: money(credit.available),
                    limit: money(credit.limit),
                  })}
                </Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(credit.free * 100)}%` }]} />
              </View>
            </View>
          ) : null}

          {card ? (
            <View style={styles.settle}>
              <View style={styles.settleTop}>
                <View style={styles.settleHalf}>
                  <View style={styles.settleLabel}>
                    <CalendarDays size={13} strokeWidth={2.2} color={ink} />
                    <Text style={styles.settleCaption} numberOfLines={1}>
                      {t('mobile.customer.account.term')}
                    </Text>
                  </View>
                  <Text style={[styles.settleValue, { color: ink }]}>{monthDay(card.dueDate)}</Text>
                  <Text style={[styles.settleNote, styles.semibold, { color: ink }]}>
                    {card.days.kind === 'left'
                      ? t('mobile.customer.account.dueLeft', { n: card.days.days })
                      : t('mobile.customer.account.settleToday')}
                  </Text>
                </View>
                <View style={styles.settleRule} />
                <View style={[styles.settleHalf, styles.settleEnd]}>
                  <Text style={styles.settleCaption} numberOfLines={1}>
                    {t('mobile.customer.account.amountDue')}
                  </Text>
                  <Text
                    style={[styles.settleValue, { color: ink }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {money(card.amountDue)}
                  </Text>
                  <Text style={[styles.settleNote, styles.right]} numberOfLines={1}>
                    {purchases}
                  </Text>
                </View>
              </View>
              {card.overdue ? (
                <View style={styles.overdue}>
                  <AlertTriangle size={14} strokeWidth={2.2} color={colors.destructiveText} />
                  <Text style={styles.overdueText}>
                    {t('mobile.customer.account.overdueOfDue', { amount: money(card.overdue) })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : balance.isLoading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : null}
      {problem ? <ProblemText problem={problemFrom(problem)} /> : null}
      {settlement ? (
        <Text style={[type.secondary, styles.rule]}>
          {t(`mobile.customer.account.settleRule.${settlement.group}`)}
        </Text>
      ) : null}

      <StatementPanel today={today} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  right: { textAlign: 'right' },
  semibold: { fontFamily: fonts.semibold },
  loading: { marginVertical: spacing.xxl },
  hero: {
    borderRadius: radii.card,
    backgroundColor: colors.primary,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  heroLabel: { ...type.row, flex: 1, color: colors.onPrimaryMuted },
  heroAmount: { ...type.largeTitle, ...tabular, marginTop: 2, color: colors.primaryForeground },
  heroAsOf: { ...type.secondary, color: colors.onPrimaryMuted },
  hold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
  },
  holdText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.blocked },
  credit: { marginTop: spacing.md, gap: 6 },
  creditLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  creditValue: {
    ...type.secondary,
    ...tabular,
    fontFamily: fonts.semibold,
    color: colors.primaryForeground,
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.onPrimaryHairline,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primaryForeground },
  settle: {
    marginTop: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  settleTop: { flexDirection: 'row', padding: spacing.md, gap: spacing.md },
  settleRule: { width: StyleSheet.hairlineWidth, backgroundColor: colors.hairlineStrong },
  settleHalf: { flex: 1, minWidth: 0, gap: 1 },
  settleEnd: { alignItems: 'flex-end' },
  settleLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  settleCaption: { ...type.secondary, flexShrink: 1, color: colors.label2 },
  settleValue: { ...type.title3, ...tabular },
  settleNote: { ...type.secondary, color: colors.label2 },
  overdue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.destructiveSoft,
  },
  overdueText: {
    ...type.secondary,
    flex: 1,
    fontFamily: fonts.semibold,
    color: colors.destructiveText,
  },
  rule: { marginTop: spacing.sm, marginHorizontal: spacing.xs, color: colors.muted },
});
