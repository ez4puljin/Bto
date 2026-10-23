import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { CalendarDays, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
} from 'react-native';
import {
  STORE_KEY,
  type StoreBankAccount,
  useBankAccounts,
  useStoreBalance,
  useStoreMe,
} from '../../src/api/customer';
import { problemFrom } from '../../src/api/problem';
import { useCustomer } from '../../src/state/session';
import { creditBarOf, debtOf, settlementCardOf } from '../../src/customer/account';
import { StatementPanel } from '../../src/customer/statement-panel';
import { splitAround } from '../../src/customer/money';
import { monthDay } from '../../src/dates/calendar';
import { formatMnt, initialsOf } from '../../src/format/format';
import { colors, fonts, radii, spacing, storeType, tabular, type } from '../../src/theme/tokens';
import { Group, Separator } from '../../src/ui/grouped';
import { ProblemText } from '../../src/ui/kit';
import { StoreHeader } from '../../src/ui/store-header';
import { Page } from '../../src/ui/layout';
import { Text } from '../../src/ui/text';
import { useToast } from '../../src/ui/toast';

/**
 * «Тооцоо» (the Account board, ADR-0079 #7), read-only from finance's own figures: the debt (or an
 * advance), «Тооцоо хийх өдөр» with the amount due by then and its overdue part (ADR-0101 #6), what
 * remains of the credit limit (only when one is set) and a credit hold (never its reason); the
 * statement; the company's accounts to pay into, each number copied with one press, and the
 * advice to write the invoice number.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const me = useStoreMe();
  const balance = useStoreBalance();
  const banks = useBankAccounts();
  const queryClient = useQueryClient();
  const { me: signedIn } = useCustomer();
  const today = me.data?.today ?? signedIn.store.today;
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const account = balance.data;
  const accounts = banks.data ?? [];
  const problem = balance.error ?? me.error ?? null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        me.refetch(),
        balance.refetch(),
        banks.refetch(),
        queryClient.invalidateQueries({ queryKey: [...STORE_KEY, 'statement'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const copy = async (bank: StoreBankAccount) => {
    if (!bank.bankAccountNo) return;
    try {
      await Clipboard.setStringAsync(bank.bankAccountNo);
      setCopiedId(bank.id);
      toast.show({ message: t('mobile.customer.account.numberCopied') });
    } catch {
      // The phone refused the clipboard: nothing was copied, the button keeps saying «Хуулах».
    }
  };

  const debt = account ? debtOf(account.balance) : null;
  const credit = account ? creditBarOf(account) : null;
  // «Тооцоо хийх өдөр» under the debt (ADR-0101 #6, the Account board): blue while nothing is
  // overdue, red once something is, the overdue part in red under «Төлөх дүн».
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
  // The owner (2026-10-20): the copied invoice number must go in the transfer's description.
  const advice = t('mobile.customer.account.adviceMust');
  const adviceStrong = t('mobile.customer.account.adviceMustStrong');

  return (
    <Page white edges={[]}>
      <StoreHeader title={t('mobile.customer.tabs.account')} onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: 40 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {me.data ? (
          <Text style={[storeType.sectionSub, styles.subtitle]} numberOfLines={2}>
            {t('mobile.customer.account.asOf', {
              store: me.data.name,
              date: monthDay(me.data.today),
            })}
          </Text>
        ) : null}

        <View style={styles.debtCard}>
          {account && debt ? (
            <>
              <View style={styles.debtHead}>
                <Text style={type.secondary}>
                  {debt.kind === 'advance'
                    ? t('mobile.customer.account.advance')
                    : t('mobile.customer.account.debt')}
                </Text>
                <Text style={styles.debtAmount} numberOfLines={1} adjustsFontSizeToFit>
                  {debt.kind === 'clear' ? t('mobile.customer.account.clear') : money(debt.amount)}
                </Text>
              </View>
              {card && settlement ? (
                <View
                  style={[
                    styles.settle,
                    card.tone === 'overdue' ? styles.settleOverdue : styles.settleDue,
                  ]}
                >
                  <View style={styles.settleTop}>
                    <View style={styles.settleHalf}>
                      <View style={styles.settleLabel}>
                        <CalendarDays size={14} strokeWidth={2.2} color={ink} />
                        <Text style={styles.settleCaption}>
                          {t('mobile.customer.account.term')}
                        </Text>
                      </View>
                      <Text style={[styles.settleValue, { color: ink }]}>
                        {monthDay(card.dueDate)}
                      </Text>
                      <Text style={[styles.settleNote, styles.semibold, { color: ink }]}>
                        {card.days.kind === 'left'
                          ? t('mobile.customer.account.dueLeft', { n: card.days.days })
                          : t('mobile.customer.account.settleToday')}
                      </Text>
                    </View>
                    <View style={[styles.settleHalf, styles.settleEnd]}>
                      <Text style={styles.settleCaption}>
                        {t('mobile.customer.account.amountDue')}
                      </Text>
                      <Text
                        style={[styles.settleValue, { color: ink }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {money(card.amountDue)}
                      </Text>
                      <Text style={[styles.settleNote, styles.settleRight]}>{purchases}</Text>
                      {card.overdue ? (
                        <Text style={[styles.settleNote, styles.settleRight, styles.overdueNote]}>
                          {t('mobile.customer.account.overdueOfDue', {
                            amount: money(card.overdue),
                          })}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Text
                    style={[
                      styles.settleRule,
                      card.tone === 'overdue' ? styles.settleRuleOverdue : styles.settleRuleDue,
                    ]}
                  >
                    {t(`mobile.customer.account.settleRule.${settlement.group}`)}
                  </Text>
                </View>
              ) : null}
              {credit ? (
                <View style={styles.credit}>
                  <View style={styles.creditLine}>
                    <Text style={[type.secondary, styles.grow]}>
                      {t('mobile.customer.account.creditLeft')}
                    </Text>
                    <Text style={[type.secondary, styles.creditValue]}>
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
              {account.creditHold ? (
                <View style={styles.cardRows}>
                  <Separator />
                  <View style={styles.cardRow}>
                    <Lock size={16} strokeWidth={2.2} color={colors.blocked} />
                    <Text style={[type.bodyStrong, styles.hold]}>
                      {t('mobile.customer.account.creditHold')}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.cardEnd} />
              )}
            </>
          ) : balance.isLoading ? (
            <ActivityIndicator style={styles.cardLoading} color={colors.primary} />
          ) : null}
        </View>
        {problem ? <ProblemText problem={problemFrom(problem)} /> : null}

        <StatementPanel today={today} />

        {accounts.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={[storeType.sectionTitle, styles.section]}>
              {t('mobile.customer.account.banksHeader')}
            </Text>
            <Group style={styles.outlined}>
              {accounts.map((bank) => {
                const title = [bank.bankName, bank.name].filter(Boolean).join(' · ');
                const copied = copiedId === bank.id;
                return (
                  <View key={bank.id} style={styles.bank}>
                    <View style={styles.bankTile}>
                      <Text style={styles.bankInitials}>
                        {initialsOf(bank.bankName ?? bank.name)}
                      </Text>
                    </View>
                    <View style={styles.grow}>
                      <Text style={type.rowStrong} numberOfLines={2}>
                        {title}
                      </Text>
                      <Text style={[type.row, styles.label2, tabular]} selectable>
                        {bank.bankAccountNo ?? t('common.none')}
                      </Text>
                    </View>
                    {bank.bankAccountNo ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.customer.account.copyNumber', {
                          number: bank.bankAccountNo,
                        })}
                        onPress={() => void copy(bank)}
                        style={styles.copy}
                      >
                        <Text style={[type.rowStrong, styles.link]}>
                          {copied ? t('mobile.customer.account.copied') : t('common.copy')}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              <Emphasis
                key="advice"
                text={advice}
                strong={adviceStrong}
                style={[type.secondary, styles.advice]}
                strongStyle={styles.adviceStrong}
              />
            </Group>
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}

/** A text with one part in bold (the overdue amount, the example invoice number). */
function Emphasis({
  text,
  strong,
  style,
  strongStyle,
}: {
  text: string;
  strong: string;
  style?: StyleProp<TextStyle>;
  strongStyle?: StyleProp<TextStyle>;
}) {
  const parts = splitAround(text, strong);
  return (
    <Text style={style}>
      {parts ? (
        <>
          {parts[0]}
          <Text style={strongStyle}>{parts[1]}</Text>
          {parts[2]}
        </>
      ) : (
        text
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  subtitle: { marginTop: 2 },
  grow: { flex: 1 },
  label2: { color: colors.label2 },
  link: { color: colors.primary },
  debtCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardLoading: { marginVertical: spacing.xl },
  debtHead: {
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 2,
  },
  debtAmount: { ...type.largeTitle, ...tabular },
  settle: { marginHorizontal: 10, borderRadius: 8, overflow: 'hidden' },
  settleDue: { backgroundColor: colors.infoSoft },
  settleOverdue: { backgroundColor: colors.destructiveSoft },
  settleTop: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  settleHalf: { flex: 1, minWidth: 0, gap: 1 },
  settleEnd: { alignItems: 'flex-end' },
  settleLabel: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  settleCaption: { ...type.secondary, color: colors.label2 },
  settleValue: { ...type.title3, ...tabular },
  settleNote: { ...type.secondary, color: colors.label2 },
  settleRight: { textAlign: 'right' },
  semibold: { fontFamily: fonts.semibold },
  overdueNote: { fontFamily: fonts.semibold, color: colors.destructiveText },
  settleRule: {
    ...type.secondary,
    color: colors.label2,
    paddingTop: 7,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  settleRuleDue: { borderTopColor: colors.newBadge },
  settleRuleOverdue: { borderTopColor: colors.destructiveText },
  credit: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
    gap: 6,
  },
  creditLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  creditValue: { fontFamily: fonts.semibold, color: colors.foreground, ...tabular },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  cardRows: { marginTop: 10 },
  cardRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  cardEnd: { height: spacing.md },
  hold: { flex: 1, color: colors.blocked },
  section: { marginTop: spacing.xl, marginBottom: 10, textTransform: 'uppercase' },
  outlined: { borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  bank: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  bankTile: {
    width: 36,
    height: 36,
    borderRadius: radii.control,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bankInitials: { ...type.bodyStrong, fontFamily: fonts.bold, color: colors.primaryForeground },
  copy: { minWidth: 44, height: 44, paddingHorizontal: spacing.md, justifyContent: 'center' },
  advice: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg, color: colors.label2 },
  adviceStrong: { fontFamily: fonts.semibold, color: colors.foreground },
});
