import { useRouter } from 'expo-router';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { type StoreStatementEntry, useStoreStatement } from '../api/customer';
import { problemFrom } from '../api/problem';
import { type DateRange, monthDay } from '../dates/calendar';
import { formatMnt } from '../format/format';
import { DateRangeSheet } from '../orders/date-range-sheet';
import { colors, fonts, spacing, tabular, type } from '../theme/tokens';
import { MenuChip } from '../ui/controls';
import { Group } from '../ui/grouped';
import { ProblemText } from '../ui/kit';
import { FootNote, SectionHeader } from '../ui/layout';
import { Text } from '../ui/text';
import { useTakerText } from './order-row';
import { takerOf } from './orders';
import { columnAmount, lastMonthRange } from './statement';

/** The width of each amount column, enough for «12,345,678». */
const COLUMN = 84;

/**
 * «Тооцооны хуулга» on «Тооцоо» (ADR-0084, the owner 2026-10-20): the days (the last month at
 * first, any range from the calendar), «Эхний үлдэгдэл», every entry oldest first with its
 * purchase in «Дебит» or its payment or return in «Кредит» and the balance after it, «Нийт» and
 * «Эцсийн үлдэгдэл». A purchase opens its invoice.
 */
export function StatementPanel({ today }: { today: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(() => lastMonthRange(today));
  const [picking, setPicking] = useState(false);
  const statement = useStoreStatement(range);
  const data = statement.data;
  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  const cell = (amount: string) => {
    const shown = columnAmount(amount);
    return shown ? formatMnt(shown) : '';
  };
  const takerText = useTakerText();
  const kindOf = (entry: StoreStatementEntry) => t(`mobile.customer.statement.kinds.${entry.kind}`);
  /** «10/19 · Худалдан авалт · Төлөөлөгч Бат»: a purchase says who took its order. */
  const metaOf = (entry: StoreStatementEntry) =>
    [
      monthDay(entry.date),
      kindOf(entry),
      ...(entry.orderChannel
        ? [takerText(takerOf({ channel: entry.orderChannel, takerName: entry.orderTakerName }))]
        : []),
    ].join(' · ');

  return (
    <>
      <SectionHeader
        style={styles.header}
        right={
          <MenuChip
            label={t('mobile.customer.statement.range', {
              from: monthDay(range.from),
              to: monthDay(range.to),
            })}
            icon={<CalendarDays size={15} strokeWidth={2} color={colors.foreground} />}
            onPress={() => setPicking(true)}
          />
        }
      >
        {t('mobile.customer.statement.title')}
      </SectionHeader>

      {statement.isLoading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : statement.error ? (
        <ProblemText problem={problemFrom(statement.error)} />
      ) : data ? (
        <Group>
          <View style={[styles.row, styles.columnsHead]}>
            <Text style={[type.caption, styles.grow]}>
              {t('mobile.customer.statement.document')}
            </Text>
            <Text style={[type.caption, styles.column]}>
              {t('mobile.customer.statement.debit')}
            </Text>
            <Text style={[type.caption, styles.column]}>
              {t('mobile.customer.statement.credit')}
            </Text>
            <View style={styles.chevronSpace} />
          </View>

          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={type.rowStrong}>{t('mobile.customer.statement.opening')}</Text>
              <Text style={type.caption}>
                {t('mobile.customer.statement.asOf', { date: monthDay(data.from) })}
              </Text>
            </View>
            <Text style={[type.rowStrong, styles.balance]}>{money(data.opening)}</Text>
          </View>

          {data.entries.length === 0 ? (
            <View style={styles.row}>
              <Text style={[type.secondary, styles.grow]}>
                {t('mobile.customer.statement.empty')}
              </Text>
            </View>
          ) : null}

          {data.entries.map((entry) => {
            const invoiceId = entry.invoiceId;
            const content = (
              <>
                <View style={styles.grow}>
                  <Text style={styles.number} numberOfLines={1}>
                    {entry.number}
                  </Text>
                  <Text style={type.caption} numberOfLines={2}>
                    {metaOf(entry)}
                  </Text>
                  <Text style={[type.caption, styles.muted]} numberOfLines={1}>
                    {t('mobile.customer.statement.after', { amount: money(entry.balance) })}
                  </Text>
                </View>
                <Text style={[styles.amount, styles.column]}>{cell(entry.debit)}</Text>
                <Text style={[styles.amount, styles.column, styles.credit]}>
                  {cell(entry.credit)}
                </Text>
                {invoiceId !== null ? (
                  <ChevronRight size={16} strokeWidth={2} color={colors.input} />
                ) : (
                  <View style={styles.chevronSpace} />
                )}
              </>
            );
            return invoiceId !== null ? (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={t('mobile.customer.statement.entryLabel', {
                  kind: kindOf(entry),
                  number: entry.number,
                  date: monthDay(entry.date),
                })}
                onPress={() => router.push(`/invoice/${invoiceId}`)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                {content}
              </Pressable>
            ) : (
              <View key={entry.id} style={styles.row}>
                {content}
              </View>
            );
          })}

          <View style={styles.row}>
            <Text style={[type.rowStrong, styles.grow]}>
              {t('mobile.customer.statement.total')}
            </Text>
            <Text style={[styles.amount, styles.strong, styles.column]}>
              {formatMnt(data.totalDebit)}
            </Text>
            <Text style={[styles.amount, styles.strong, styles.column, styles.credit]}>
              {formatMnt(data.totalCredit)}
            </Text>
            <View style={styles.chevronSpace} />
          </View>

          <View style={styles.row}>
            <View style={styles.grow}>
              <Text style={type.rowStrong}>{t('mobile.customer.statement.closing')}</Text>
              <Text style={type.caption}>
                {t('mobile.customer.statement.asOf', { date: monthDay(data.to) })}
              </Text>
            </View>
            <Text style={[type.sectionTitle, styles.balance]}>{money(data.closing)}</Text>
          </View>
        </Group>
      ) : null}
      <FootNote>{t('mobile.customer.statement.hint')}</FootNote>

      <DateRangeSheet
        visible={picking}
        today={today}
        range={range}
        applyLabel={(next, days) =>
          t('mobile.customer.statement.apply', {
            from: monthDay(next.from),
            to: monthDay(next.to),
            n: days,
          })
        }
        onApply={(next) => {
          setRange(next);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.lg },
  loading: { marginVertical: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
  },
  columnsHead: { minHeight: 36 },
  pressed: { backgroundColor: colors.accent },
  grow: { flex: 1, minWidth: 0 },
  number: { ...type.body, fontFamily: fonts.semibold, ...tabular },
  muted: { color: colors.muted },
  column: { width: COLUMN, textAlign: 'right' },
  amount: { ...type.body, ...tabular },
  credit: { color: colors.success },
  strong: { fontFamily: fonts.semibold },
  balance: { ...tabular, textAlign: 'right' },
  chevronSpace: { width: 16 },
});
