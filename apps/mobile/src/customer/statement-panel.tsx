import { useRouter } from 'expo-router';
import { CalendarDays, ChevronRight, FileText, Minus, Plus } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
} from 'react-native';
import { type StoreStatement, type StoreStatementEntry, useStoreStatement } from '../api/customer';
import { problemFrom } from '../api/problem';
import { type DateRange, monthDay } from '../dates/calendar';
import { formatMnt } from '../format/format';
import { DateRangeSheet } from '../orders/date-range-sheet';
import { brandSheet } from '../theme/brand';
import { colors, radii, spacing, storeType, tabular, type } from '../theme/tokens';
import { ChoiceChip } from '../ui/controls';
import { ProblemText } from '../ui/kit';
import { Text } from '../ui/text';
import { useTakerText } from './order-row';
import { takerOf } from './orders';
import {
  columnAmount,
  lastMonthRange,
  STATEMENT_PRESETS,
  statementPresetOf,
  statementRange,
} from './statement';

/** «Дебит» and «Кредит»: «2,095,200» whole at 13 px; a larger amount shrinks to fit. */
const AMOUNT = 66;
const BALANCE = 72;

/**
 * «Тооцооны хуулга» on «Тооцоо» (ADR-0086; redrawn on the Account board, the owner 2026-10-21):
 * the days (three chips, any range from the calendar), the sum «Эхний үлдэгдэл + Дебит − Кредит =
 * Эцсийн үлдэгдэл», and the table «Огноо, баримт · Дебит · Кредит · Үлдэгдэл»: the opening
 * balance, every entry oldest first with the balance after it, «Нийт» and the closing balance.
 * A purchase opens its invoice.
 */
export function StatementPanel({ today }: { today: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<DateRange>(() => lastMonthRange(today));
  const [picking, setPicking] = useState(false);
  const statement = useStoreStatement(range);
  const data = statement.data;
  const chosen = statementPresetOf(range, today);
  const calendar = chosen === null;

  return (
    <>
      <View style={styles.heading}>
        <View style={styles.headingTile}>
          <FileText size={18} strokeWidth={2} color={colors.primary} />
        </View>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={[storeType.sectionTitle, styles.upper]}>
            {t('mobile.customer.statement.title')}
          </Text>
          {data ? (
            <Text style={storeType.sectionSub}>
              {t('mobile.customer.statement.count', { n: data.entries.length })}
            </Text>
          ) : null}
        </View>
        <ChoiceChip
          compact
          onWhite
          selected={calendar}
          label={t('mobile.customer.statement.range', {
            from: monthDay(range.from),
            to: monthDay(range.to),
          })}
          icon={
            <CalendarDays
              size={15}
              strokeWidth={2}
              color={calendar ? colors.primaryForeground : colors.foreground}
            />
          }
          onPress={() => setPicking(true)}
        />
      </View>
      <View style={styles.presets}>
        {STATEMENT_PRESETS.map((preset) => (
          <ChoiceChip
            key={preset}
            compact
            onWhite
            selected={chosen === preset}
            label={t(`mobile.customer.statement.presets.${preset}`)}
            onPress={() => setRange(statementRange(preset, today))}
          />
        ))}
      </View>

      {statement.isLoading ? (
        <ActivityIndicator style={styles.loading} color={colors.primary} />
      ) : statement.error ? (
        <ProblemText problem={problemFrom(statement.error)} />
      ) : data ? (
        <View style={statement.isPlaceholderData && styles.stale}>
          <StatementSum data={data} />
          <StatementTable data={data} />
        </View>
      ) : null}
      <Text style={[type.secondary, styles.hint]}>{t('mobile.customer.statement.hint')}</Text>

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

/** «Эхний үлдэгдэл + Дебит − Кредит = Эцсийн үлдэгдэл» in four rows, the last one tinted. */
function StatementSum({ data }: { data: StoreStatement }) {
  const { t } = useTranslation();
  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  return (
    <View style={styles.card}>
      <View style={styles.sumRow}>
        <View style={styles.grow}>
          <Text style={type.row}>{t('mobile.customer.statement.opening')}</Text>
          <Text style={type.secondary}>
            {t('mobile.customer.statement.openingAt', { date: monthDay(data.from) })}
          </Text>
        </View>
        <Text style={[type.heading, tabular]}>{money(data.opening)}</Text>
      </View>
      <View style={styles.sumRule} />
      <View style={styles.sumRow}>
        <View style={[styles.sign, styles.signDebit]}>
          <Plus size={14} strokeWidth={2.6} color={colors.foreground} />
        </View>
        <View style={styles.grow}>
          <Text style={type.row}>{t('mobile.customer.statement.debit')}</Text>
          <Text style={type.secondary}>{t('mobile.customer.statement.debitNote')}</Text>
        </View>
        <Text style={[type.heading, tabular]}>
          {t('mobile.customer.statement.plus', { amount: money(data.totalDebit) })}
        </Text>
      </View>
      <View style={[styles.sumRule, styles.sumRuleSign]} />
      <View style={styles.sumRow}>
        <View style={[styles.sign, styles.signCredit]}>
          <Minus size={14} strokeWidth={2.6} color={colors.success} />
        </View>
        <View style={styles.grow}>
          <Text style={type.row}>{t('mobile.customer.statement.credit')}</Text>
          <Text style={type.secondary}>{t('mobile.customer.statement.creditNote')}</Text>
        </View>
        <Text style={[type.heading, tabular, styles.credit]}>
          {t('mobile.customer.statement.minus', { amount: money(data.totalCredit) })}
        </Text>
      </View>
      <View style={[styles.sumRow, styles.closingRow]}>
        <View style={styles.grow}>
          <Text style={type.rowStrong}>{t('mobile.customer.statement.closing')}</Text>
          <Text style={[type.secondary, styles.label2]}>
            {t('mobile.customer.statement.closingAt', { date: monthDay(data.to) })}
          </Text>
        </View>
        <Text style={styles.closingAmount}>{money(data.closing)}</Text>
      </View>
    </View>
  );
}

/** The statement as a table across the page, its four columns lined up. */
function StatementTable({ data }: { data: StoreStatement }) {
  const { t } = useTranslation();
  return (
    <View style={styles.table}>
      <View style={[styles.tr, styles.thead]}>
        <Text style={[storeType.tableHead, styles.upper, styles.grow]} numberOfLines={1}>
          {t('mobile.customer.statement.document')}
        </Text>
        <Head width={AMOUNT}>{t('mobile.customer.statement.debit')}</Head>
        <Head width={AMOUNT}>{t('mobile.customer.statement.credit')}</Head>
        <Head width={BALANCE}>{t('mobile.customer.statement.balance')}</Head>
      </View>

      <View style={[styles.tr, styles.tint, styles.rule]}>
        <View style={styles.grow}>
          <Text style={storeType.tableCellStrong}>{t('mobile.customer.statement.opening')}</Text>
          <Text style={[type.secondary, tabular]}>{monthDay(data.from)}</Text>
        </View>
        <View style={styles.amount} />
        <View style={styles.amount} />
        <Cell style={[storeType.tableCellStrong, styles.balance]}>{formatMnt(data.opening)}</Cell>
      </View>

      {data.entries.length === 0 ? (
        <View style={[styles.tr, styles.rule]}>
          <Text style={[type.secondary, styles.grow]}>{t('mobile.customer.statement.empty')}</Text>
        </View>
      ) : null}
      {data.entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}

      <View style={[styles.tr, styles.tint]}>
        <Text style={[storeType.tableCellStrong, styles.upper, styles.grow]}>
          {t('mobile.customer.statement.total')}
        </Text>
        <Cell style={[storeType.tableCellStrong, styles.amount]}>{formatMnt(data.totalDebit)}</Cell>
        <Cell style={[storeType.tableCellStrong, styles.amount, styles.credit]}>
          {formatMnt(data.totalCredit)}
        </Cell>
        <View style={styles.balance} />
      </View>
      <View style={[styles.tr, styles.closingRow]}>
        <View style={styles.grow}>
          <Text style={[storeType.tableCellStrong, styles.bold]}>
            {t('mobile.customer.statement.closing')}
          </Text>
          <Text style={[type.secondary, styles.label2, tabular]}>{monthDay(data.to)}</Text>
        </View>
        <Cell style={[storeType.tableTotal, styles.balance]}>{formatMnt(data.closing)}</Cell>
      </View>
    </View>
  );
}

/**
 * One entry: «10/12 Худалдан авалт», its number (blue with › when it opens the invoice) and, for a
 * purchase, who took its order; its amount under «Дебит» or «Кредит» and the balance after it.
 */
function EntryRow({ entry }: { entry: StoreStatementEntry }) {
  const { t } = useTranslation();
  const router = useRouter();
  const takerText = useTakerText();
  const kind = t(`mobile.customer.statement.kinds.${entry.kind}`);
  const taker = entry.orderChannel
    ? takerText(takerOf({ channel: entry.orderChannel, takerName: entry.orderTakerName }))
    : null;
  const invoiceId = entry.invoiceId;
  const cell = (amount: string) => {
    const shown = columnAmount(amount);
    return shown ? formatMnt(shown) : '';
  };
  const content = (
    <>
      <View style={styles.grow}>
        <View style={styles.line}>
          <Text style={[storeType.tableCellStrong, tabular]}>{monthDay(entry.date)}</Text>
          <Text style={[storeType.tableCell, styles.shrink]} numberOfLines={1}>
            {kind}
          </Text>
        </View>
        <View style={styles.line}>
          <Text
            style={[type.secondary, tabular, styles.shrink, invoiceId !== null && styles.link]}
            numberOfLines={1}
          >
            {entry.number}
          </Text>
          {invoiceId !== null ? (
            <ChevronRight size={12} strokeWidth={2.4} color={colors.link} />
          ) : null}
        </View>
        {taker ? (
          <Text style={type.secondary} numberOfLines={1}>
            {taker}
          </Text>
        ) : null}
      </View>
      <Cell style={[storeType.tableCell, styles.amount]}>{cell(entry.debit)}</Cell>
      <Cell style={[storeType.tableCell, styles.amount, styles.credit]}>{cell(entry.credit)}</Cell>
      <Cell style={[storeType.tableCell, styles.balance, styles.label2]}>
        {formatMnt(entry.balance)}
      </Cell>
    </>
  );
  return invoiceId !== null ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.customer.statement.entryLabel', {
        kind,
        number: entry.number,
        date: monthDay(entry.date),
      })}
      onPress={() => router.push(`/invoice/${invoiceId}`)}
      style={({ pressed }) => [styles.tr, styles.entry, styles.rule, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.tr, styles.entry, styles.rule]}>{content}</View>
  );
}

/** A column's head, upper case and right-aligned over its amounts. */
function Head({ width, children }: { width: number; children: ReactNode }) {
  return (
    <Text style={[storeType.tableHead, styles.upper, styles.right, { width }]} numberOfLines={1}>
      {children}
    </Text>
  );
}

/** An amount in its column: one line, right-aligned, shrunk to fit a rare eight-digit amount. */
function Cell({ style, children }: { style: StyleProp<TextStyle>; children: ReactNode }) {
  return (
    <Text
      style={[style, styles.right, tabular]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.75}
    >
      {children}
    </Text>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
    grow: { flex: 1, minWidth: 0 },
    shrink: { flexShrink: 1 },
    upper: { textTransform: 'uppercase' },
    right: { textAlign: 'right' },
    bold: { fontFamily: storeType.tableTotal.fontFamily },
    label2: { color: colors.label2 },
    link: { color: colors.link },
    credit: { color: colors.success },
    pressed: { backgroundColor: colors.accent },
    stale: { opacity: 0.5 },
    heading: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 10 },
    headingTile: {
      width: 30,
      height: 30,
      borderRadius: radii.iconTile,
      backgroundColor: colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
    loading: { marginVertical: spacing.xl },
    card: {
      marginTop: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.card,
      overflow: 'hidden',
    },
    sumRow: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
      paddingHorizontal: 14,
    },
    sumRule: { height: 1, marginLeft: 14, backgroundColor: colors.canvas },
    sumRuleSign: { marginLeft: 46 },
    sign: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signDebit: { backgroundColor: colors.canvas },
    signCredit: { backgroundColor: colors.successSoft },
    closingRow: { minHeight: 60, backgroundColor: colors.secondary },
    closingAmount: { ...type.title3, ...tabular, color: colors.primary },
    table: {
      marginTop: spacing.lg,
      marginHorizontal: -spacing.lg,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    tr: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    thead: { minHeight: 34, paddingVertical: 0, backgroundColor: colors.canvas },
    tint: { backgroundColor: colors.canvas },
    rule: { borderBottomWidth: 1, borderBottomColor: colors.canvas },
    entry: { minHeight: 52, paddingVertical: 7 },
    line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    amount: { width: AMOUNT },
    balance: { width: BALANCE },
    hint: { marginTop: 10 },
  }),
);
