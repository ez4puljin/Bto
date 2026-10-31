import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useBankAccounts, useStoreInvoice } from '../../../src/api/customer';
import { problemFrom } from '../../../src/api/problem';
import {
  type InvoiceStanding,
  invoiceStandingOf,
  positive,
  termDaysOf,
} from '../../../src/customer/money';
import { useTakerText } from '../../../src/customer/order-row';
import { takerOf } from '../../../src/customer/orders';
import { monthDay } from '../../../src/dates/calendar';
import { formatMnt } from '../../../src/format/format';
import { brandSheet } from '../../../src/theme/brand';
import { colors, fonts, radii, spacing, tabular, type } from '../../../src/theme/tokens';
import { PillButton } from '../../../src/ui/controls';
import { Group, Row, Separator } from '../../../src/ui/grouped';
import { StoreHeader } from '../../../src/ui/store-header';
import { FootNote, Page, SectionHeader } from '../../../src/ui/layout';
import { ProblemText } from '../../../src/ui/kit';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

/** The hero's pill: overdue red, due today orange, settled green, void red, days left grey. */
const STANDING_TONES: Record<InvoiceStanding['kind'], { background: string; text: string }> = {
  overdue: { background: colors.destructiveSoft, text: colors.cancelled },
  today: { background: colors.warningSoft, text: colors.warningText },
  left: { background: colors.canvas, text: colors.label2 },
  settled: { background: colors.successSoft, text: colors.success },
  void: { background: colors.destructiveSoft, text: colors.cancelled },
};

/**
 * An invoice of the store (the Invoice board, ADR-0079 #7): what is still to pay and how its due
 * date stands, its date, term and order with who took it; the discount, the total with its VAT,
 * what was paid or credited — no goods list (the owner 2026-10-20: the order holds the lines); the
 * account to pay into and the number to write in the transfer, copied with one press. A void
 * invoice says so.
 */
export default function StoreInvoiceScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const invoiceId = Number.parseInt(id ?? '', 10);
  const invoice = useStoreInvoice(Number.isFinite(invoiceId) ? invoiceId : null);
  const banks = useBankAccounts();
  const [copied, setCopied] = useState(false);
  const data = invoice.data;

  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const standing = data ? invoiceStandingOf(data) : null;
  const standingText = (value: InvoiceStanding, due: string): string => {
    switch (value.kind) {
      case 'void':
        return t('finance.invoiceStatuses.VOID');
      case 'settled':
        return t('mobile.customer.invoice.settled');
      case 'overdue':
        return t('mobile.customer.invoice.overdue', { date: monthDay(due), n: value.days });
      case 'left':
        return t('mobile.customer.invoice.left', { date: monthDay(due), n: value.days });
      case 'today':
        return t('mobile.customer.invoice.today');
    }
  };
  const orderId = data?.orderId ?? null;
  const takerText = useTakerText();
  const orderText =
    data?.orderNumber && data.orderChannel
      ? `${data.orderNumber} · ${takerText(takerOf({ channel: data.orderChannel, takerName: data.orderTakerName }))}`
      : (data?.orderNumber ?? null);
  const bank = banks.data?.[0] ?? null;
  const payable = standing !== null && standing.kind !== 'void' && standing.kind !== 'settled';

  const copy = async (number: string) => {
    try {
      await Clipboard.setStringAsync(number);
      setCopied(true);
      toast.show({ message: t('mobile.customer.invoice.numberCopied') });
    } catch {
      // The phone refused the clipboard: nothing was copied.
    }
  };

  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.customer.invoice.title')}
        onBack={() => router.back()}
        right={null}
      />
      {invoice.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      <View style={styles.pad}>
        {invoice.error ? <ProblemText problem={problemFrom(invoice.error)} /> : null}
      </View>
      {data && standing ? (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[type.secondary, styles.eyebrow]}>{t('mobile.customer.invoice.title')}</Text>
          <Text accessibilityRole="header" style={[type.title, styles.number]}>
            {data.number}
          </Text>

          <View style={styles.hero}>
            <View style={styles.heroLine}>
              <Text style={[type.row, styles.label2]}>{t('mobile.customer.invoice.open')}</Text>
              <Text style={styles.heroAmount} numberOfLines={1} adjustsFontSizeToFit>
                {money(data.openAmount)}
              </Text>
            </View>
            <View
              style={[styles.pill, { backgroundColor: STANDING_TONES[standing.kind].background }]}
            >
              <Text style={[styles.pillText, { color: STANDING_TONES[standing.kind].text }]}>
                {standingText(standing, data.dueDate)}
              </Text>
            </View>
          </View>
          {standing.kind === 'void' ? (
            <FootNote>{t('mobile.customer.invoice.voidNote')}</FootNote>
          ) : null}

          <SectionHeader style={styles.section}>{t('mobile.customer.order.info')}</SectionHeader>
          <Group>
            <Row title={t('mobile.customer.invoice.date')} value={data.invoiceDate} />
            <Row
              title={t('mobile.customer.invoice.due')}
              value={t('mobile.customer.invoice.dueValue', {
                date: data.dueDate,
                n: termDaysOf(data.invoiceDate, data.dueDate),
              })}
            />
            {orderText ? (
              orderId !== null ? (
                <Row
                  title={t('mobile.checkout.order')}
                  right={
                    <Text style={[type.body, styles.link, styles.orderText]} numberOfLines={2}>
                      {orderText}
                    </Text>
                  }
                  onPress={() => router.push(`/order/${orderId}`)}
                />
              ) : (
                <Row title={t('mobile.checkout.order')} value={orderText} />
              )
            ) : null}
          </Group>

          <SectionHeader style={styles.section}>
            {t('mobile.customer.invoice.amounts')}
          </SectionHeader>
          <View style={styles.card}>
            {positive(data.discountTotal) ? (
              <>
                <View style={styles.paidRow}>
                  <Text style={type.row}>{t('mobile.customer.invoice.subtotal')}</Text>
                  <Text style={[type.row, styles.label2, tabular]}>{money(data.subtotal)}</Text>
                </View>
                <Separator />
              </>
            ) : null}
            {positive(data.discountTotal) ? (
              <>
                <View style={styles.discount}>
                  <Text style={[type.body, styles.saved]}>{t('mobile.cart.discount')}</Text>
                  <Text style={[type.body, styles.saved, tabular]}>
                    {t('mobile.cart.minus', { amount: formatMnt(data.discountTotal) })}
                  </Text>
                </View>
              </>
            ) : null}
            {positive(data.discountTotal) ? <Separator /> : null}
            <View style={styles.totalRow}>
              <Text style={type.heading}>{t('mobile.cart.total')}</Text>
              <Text style={styles.total} numberOfLines={1}>
                {money(data.total)}
              </Text>
            </View>
            {positive(data.vatTotal) ? (
              <View style={styles.taxRow}>
                <Text style={type.secondary}>{t('mobile.customer.invoice.vat')}</Text>
                <Text style={[type.secondary, tabular]}>{money(data.vatTotal)}</Text>
              </View>
            ) : null}
            {positive(data.cityTaxTotal) ? (
              <View style={styles.taxRow}>
                <Text style={type.secondary}>{t('mobile.customer.invoice.cityTax')}</Text>
                <Text style={[type.secondary, tabular]}>{money(data.cityTaxTotal)}</Text>
              </View>
            ) : null}
            <Separator />
            <View style={styles.paidRow}>
              <Text style={type.row}>{t('mobile.customer.invoice.paid')}</Text>
              <Text style={[type.row, styles.label2, tabular]}>{money(data.paidAmount)}</Text>
            </View>
            {positive(data.creditedAmount) ? (
              <>
                <Separator />
                <View style={styles.paidRow}>
                  <Text style={type.row}>{t('mobile.customer.invoice.credited')}</Text>
                  <Text style={[type.row, styles.label2, tabular]}>
                    {money(data.creditedAmount)}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {payable ? (
            <View style={styles.advice}>
              <Text style={[type.body, styles.adviceText]}>
                {bank
                  ? t('mobile.customer.invoice.bankAdvice', {
                      account: [bank.bankName, bank.name, bank.bankAccountNo]
                        .filter(Boolean)
                        .join(' · '),
                    })
                  : t('mobile.customer.invoice.bankAdviceNoAccount')}
              </Text>
              <PillButton
                title={
                  copied
                    ? t('mobile.customer.invoice.numberCopied')
                    : t('mobile.customer.invoice.copyNumber')
                }
                height={44}
                style={styles.copy}
                onPress={() => void copy(data.number)}
              />
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </Page>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    pad: { paddingHorizontal: spacing.lg },
    orderText: { textAlign: 'right', flexShrink: 1 },
    body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
    eyebrow: { marginTop: 2, marginHorizontal: spacing.xs },
    number: { marginHorizontal: spacing.xs, ...tabular },
    label2: { color: colors.label2 },
    link: { color: colors.primary, ...tabular },
    grow: { flex: 1 },
    hero: {
      marginTop: 14,
      gap: 10,
      padding: spacing.lg,
      backgroundColor: colors.card,
      borderRadius: radii.tile,
    },
    heroLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    heroAmount: { ...type.title, ...tabular, flexShrink: 1, textAlign: 'right' },
    pill: {
      alignSelf: 'flex-start',
      minHeight: 24,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 12,
      justifyContent: 'center',
    },
    pillText: { ...type.secondary, fontFamily: fonts.semibold },
    section: { marginTop: 22 },
    card: { backgroundColor: colors.card, borderRadius: radii.card, overflow: 'hidden' },
    line: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: 6,
      paddingHorizontal: spacing.lg,
    },
    lineAmount: { ...type.rowStrong, ...tabular, textAlign: 'right' },
    discount: {
      minHeight: 40,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    saved: { color: colors.success },
    totalRow: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    total: { ...type.title3, ...tabular, flexShrink: 1, textAlign: 'right' },
    taxRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: 10,
    },
    paidRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    advice: {
      marginTop: spacing.lg,
      gap: 10,
      paddingVertical: 14,
      paddingHorizontal: spacing.lg,
      borderRadius: radii.card,
      backgroundColor: colors.secondary,
    },
    adviceText: { color: colors.label2 },
    copy: { alignSelf: 'flex-start', paddingHorizontal: spacing.lg },
  }),
);
