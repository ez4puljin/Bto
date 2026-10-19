import { useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { CircleAlert, HandCoins, Lock, ReceiptText } from 'lucide-react-native';
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
  type StoreInvoice,
  type StorePayment,
  useBankAccounts,
  useStoreBalance,
  useStoreInvoices,
  useStoreMe,
  useStorePayments,
} from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import { useCustomer } from '../../../src/state/session';
import { creditBarOf, debtOf, invoiceDueOf, overdueOf } from '../../../src/customer/account';
import { StatementPanel } from '../../../src/customer/statement-panel';
import {
  partlyOpen,
  paymentMethodOf,
  paymentSignOf,
  splitAround,
} from '../../../src/customer/money';
import { monthDay } from '../../../src/dates/calendar';
import { formatMnt, initialsOf } from '../../../src/format/format';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { Segmented } from '../../../src/ui/controls';
import { Group, Separator } from '../../../src/ui/grouped';
import { EmptyState, ProblemText } from '../../../src/ui/kit';
import { LargeTitle, Page, SectionHeader } from '../../../src/ui/layout';
import { PaymentDot } from '../../../src/ui/status';
import { useTabBarInset } from '../../../src/ui/tab-bar';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** «Хуулга» (ADR-0084) first: the owner's statement with Дебит and Кредит. */
type Part = 'statement' | 'invoices' | 'payments';

/** The tones of an invoice's due pill: overdue red, due today orange, days left grey. */
const DUE_TONES = {
  overdue: { background: colors.destructiveSoft, text: colors.cancelled },
  today: { background: colors.warningSoft, text: colors.warningText },
  left: { background: colors.canvas, text: colors.label2 },
} as const;

/**
 * «Тооцоо» (the Account board, ADR-0079 #7), read-only from finance's own figures: the debt (or an
 * advance), the overdue amount and its oldest due date, what remains of the credit limit (only
 * when one is set), a credit hold (never its reason) and the payment term; the open invoices,
 * oldest due first, and the payments, newest first; the company's accounts to pay into, each
 * number copied with one press, and the advice to write the invoice number.
 */
export default function AccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
  const toast = useToast();
  const me = useStoreMe();
  const balance = useStoreBalance();
  const invoices = useStoreInvoices();
  const payments = useStorePayments();
  const banks = useBankAccounts();
  const queryClient = useQueryClient();
  const { me: signedIn } = useCustomer();
  const today = me.data?.today ?? signedIn.store.today;
  const [part, setPart] = useState<Part>('statement');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const account = balance.data;
  const openInvoices = invoices.data ?? [];
  const paymentRows = payments.data?.pages.flatMap((page) => page.data) ?? [];
  const accounts = banks.data ?? [];
  const problem = balance.error ?? invoices.error ?? payments.error ?? me.error ?? null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        me.refetch(),
        balance.refetch(),
        invoices.refetch(),
        payments.refetch(),
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
  const example = openInvoices[0]?.number ?? null;
  const advice = example
    ? t('mobile.customer.account.adviceExample', { number: example })
    : t('mobile.customer.account.advice');

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

        <View style={styles.tabs}>
          <Segmented<Part>
            label={t('mobile.customer.account.sections')}
            value={part}
            onChange={setPart}
            options={[
              { value: 'statement', label: t('mobile.customer.statement.tab') },
              {
                value: 'invoices',
                label: t('mobile.customer.account.invoicesTab', {
                  n: account?.openInvoices ?? openInvoices.length,
                }),
              },
              {
                value: 'payments',
                label: t('mobile.customer.account.paymentsTab', {
                  n: account?.payments ?? payments.data?.pages[0]?.total ?? paymentRows.length,
                }),
              },
            ]}
          />
        </View>

        {part === 'statement' ? <StatementPanel today={today} /> : null}

        {part === 'invoices' ? (
          <>
            <SectionHeader style={styles.listHeader}>
              {t('mobile.customer.account.invoicesHeader')}
            </SectionHeader>
            {invoices.isLoading ? (
              <ActivityIndicator style={styles.loading} color={colors.primary} />
            ) : openInvoices.length === 0 ? (
              invoices.error ? null : (
                <EmptyState
                  icon={<ReceiptText size={44} strokeWidth={1.5} color={colors.input} />}
                  title={t('mobile.customer.account.noInvoices')}
                />
              )
            ) : (
              <Group>
                {openInvoices.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    onPress={() => router.push(`/invoice/${invoice.id}`)}
                  />
                ))}
              </Group>
            )}
          </>
        ) : (
          <>
            <SectionHeader style={styles.listHeader}>
              {t('mobile.customer.account.paymentsHeader')}
            </SectionHeader>
            {payments.isLoading ? (
              <ActivityIndicator style={styles.loading} color={colors.primary} />
            ) : paymentRows.length === 0 ? (
              payments.error ? null : (
                <EmptyState
                  icon={<HandCoins size={44} strokeWidth={1.5} color={colors.input} />}
                  title={t('mobile.customer.account.noPayments')}
                />
              )
            ) : (
              <Group>
                {paymentRows.map((payment) => (
                  <PaymentRow key={payment.id} payment={payment} />
                ))}
                {payments.hasNextPage ? (
                  <Pressable
                    key="more"
                    accessibilityRole="button"
                    disabled={payments.isFetchingNextPage}
                    onPress={() => void payments.fetchNextPage()}
                    style={({ pressed }) => [styles.more, pressed && styles.pressed]}
                  >
                    {payments.isFetchingNextPage ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Text style={[type.rowStrong, styles.link]}>{t('common.loadMore')}</Text>
                    )}
                  </Pressable>
                ) : null}
              </Group>
            )}
          </>
        )}

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
                strong={example ?? ''}
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

/** An open invoice: its number, date and due date, what is still open and its due pill. */
function InvoiceRow({ invoice, onPress }: { invoice: StoreInvoice; onPress: () => void }) {
  const { t } = useTranslation();
  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const due = invoiceDueOf(invoice);
  const tone = DUE_TONES[due.kind];
  const meta = [
    t('mobile.customer.account.invoiceMeta', {
      date: monthDay(invoice.invoiceDate),
      due: monthDay(invoice.dueDate),
    }),
    ...(partlyOpen(invoice)
      ? [t('mobile.customer.account.ofTotal', { amount: money(invoice.total) })]
      : []),
  ].join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <Text style={[type.heading, tabular]} numberOfLines={1}>
          {invoice.number}
        </Text>
        <Text style={type.secondary} numberOfLines={2}>
          {meta}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[type.heading, tabular]} numberOfLines={1}>
          {money(invoice.openAmount)}
        </Text>
        <View style={[styles.pill, { backgroundColor: tone.background }]}>
          <Text style={[styles.pillText, { color: tone.text }]}>
            {due.kind === 'overdue'
              ? t('mobile.customer.account.dueOverdue', { n: due.days })
              : due.kind === 'left'
                ? t('mobile.customer.account.dueLeft', { n: due.days })
                : t('mobile.customer.account.dueToday')}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** A recorded payment: its number, day and method, the invoices it settled, the amount. */
function PaymentRow({ payment }: { payment: StorePayment }) {
  const { t } = useTranslation();
  const method = paymentMethodOf(payment.method);
  const sign = paymentSignOf(payment.kind);
  const meta = [
    monthDay(payment.paidOn),
    t(`sales.paymentMethods.${method}`),
    ...(payment.kind === 'CUSTOMER_REFUND' ? [t('mobile.customer.account.refund')] : []),
  ].join(' · ');
  return (
    <View style={styles.listRow}>
      <View style={styles.rowText}>
        <Text style={[type.heading, tabular]} numberOfLines={1}>
          {payment.number}
        </Text>
        <View style={styles.meta}>
          <PaymentDot method={method} />
          <Text style={type.secondary} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {payment.invoices.length > 0 ? (
          <Text style={type.caption} numberOfLines={3}>
            {t('mobile.customer.account.settled', {
              numbers: payment.invoices.map((invoice) => invoice.number).join(', '),
            })}
          </Text>
        ) : null}
      </View>
      <Text style={[type.heading, tabular, sign === 'minus' && styles.paid]} numberOfLines={1}>
        {sign === 'minus'
          ? t('mobile.cart.minus', { amount: formatMnt(payment.amount) })
          : t('mobile.customer.account.plus', { amount: formatMnt(payment.amount) })}
      </Text>
    </View>
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
  pressed: { backgroundColor: colors.accent },
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
  tabs: { marginTop: 20 },
  listHeader: { marginTop: spacing.lg },
  section: { marginTop: 22 },
  loading: { marginTop: spacing.xl },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: 14,
  },
  rowText: { flex: 1, gap: 2 },
  rowRight: { flexShrink: 0, alignItems: 'flex-end', gap: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pill: { height: 22, paddingHorizontal: spacing.sm, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
  paid: { color: colors.success },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
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
