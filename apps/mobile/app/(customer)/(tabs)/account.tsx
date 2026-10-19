import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { CircleAlert, Lock } from 'lucide-react-native';
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
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { useCustomer } from '../../../src/state/session';
import { creditBarOf, debtOf, overdueOf } from '../../../src/customer/account';
import { StatementPanel } from '../../../src/customer/statement-panel';
import { splitAround } from '../../../src/customer/money';
import { monthDay } from '../../../src/dates/calendar';
import { formatMnt, initialsOf } from '../../../src/format/format';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Group, Separator } from '../../../src/ui/grouped';
import { ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page, SectionHeader } from '../../../src/ui/layout';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/**
 * «Тооцоо» (the Account board, ADR-0079 #7), read-only from finance's own figures: the debt (or an
 * advance), the overdue amount and its oldest due date, what remains of the credit limit (only
 * when one is set), a credit hold (never its reason) and the payment term; the open invoices,
 * oldest due first, and the payments, newest first; the company's accounts to pay into, each
 * number copied with one press, and the advice to write the invoice number.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const inset = useTabBarInset();
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
  const overdue = account ? overdueOf(account) : null;
  const credit = account ? creditBarOf(account) : null;
  const overdueText = overdue
    ? overdue.since
      ? t('mobile.customer.account.overdueSince', {
          amount: money(overdue.amount),
          date: monthDay(overdue.since),
        })
      : t('mobile.customer.account.overdue', { amount: money(overdue.amount) })
    : null;
  const termDays = account?.paymentTermDays ?? null;
  // The owner (2026-10-20): the copied invoice number must go in the transfer's description.
  const advice = t('mobile.customer.account.adviceMust');
  const adviceStrong = t('mobile.customer.account.adviceMustStrong');

  return (
    <Page>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <View style={styles.bar} />
        <LargeTitle style={styles.title}>{t('mobile.customer.tabs.account')}</LargeTitle>
        {me.data ? (
          <Text style={[type.row, styles.subtitle]} numberOfLines={2}>
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
              {overdueText && overdue ? (
                <View style={styles.overdue}>
                  <CircleAlert size={18} strokeWidth={2.2} color={colors.cancelled} />
                  <Emphasis
                    text={overdueText}
                    strong={money(overdue.amount)}
                    style={[type.body, styles.overdueText]}
                    strongStyle={styles.bold}
                  />
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
              {account.creditHold || termDays !== null ? (
                <View style={styles.cardRows}>
                  {account.creditHold ? (
                    <>
                      <Separator />
                      <View style={styles.cardRow}>
                        <Lock size={16} strokeWidth={2.2} color={colors.blocked} />
                        <Text style={[type.bodyStrong, styles.hold]}>
                          {t('mobile.customer.account.creditHold')}
                        </Text>
                      </View>
                    </>
                  ) : null}
                  {termDays !== null ? (
                    <>
                      <Separator />
                      <View style={styles.cardRow}>
                        <Text style={[type.row, styles.grow, styles.label2]}>
                          {t('mobile.customer.account.term')}
                        </Text>
                        <Text style={type.row}>
                          {t('mobile.customer.account.termDays', { n: termDays })}
                        </Text>
                      </View>
                    </>
                  ) : null}
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
            <SectionHeader style={styles.section}>
              {t('mobile.customer.account.banksHeader')}
            </SectionHeader>
            <Group>
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
  body: { paddingHorizontal: spacing.lg },
  bar: { height: 38 },
  title: { marginHorizontal: spacing.xs },
  subtitle: { marginTop: 2, marginHorizontal: spacing.xs, color: colors.muted },
  grow: { flex: 1 },
  label2: { color: colors.label2 },
  link: { color: colors.primary },
  bold: { fontFamily: fonts.bold },
  debtCard: {
    marginTop: 14,
    backgroundColor: colors.card,
    borderRadius: radii.tile,
    overflow: 'hidden',
  },
  cardLoading: { marginVertical: spacing.xl },
  debtHead: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: 2,
  },
  debtAmount: { ...type.display, ...tabular },
  overdue: {
    marginHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: colors.destructiveSoft,
  },
  overdueText: { flex: 1, color: colors.cancelled },
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
  section: { marginTop: 22 },
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
