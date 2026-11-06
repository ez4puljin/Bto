import { useRouter } from 'expo-router';
import { CalendarDays, ChevronRight } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { type StoreStatement, type StoreStatementEntry, useStoreStatement } from '../api/customer';
import { problemFrom } from '../api/problem';
import { type DateRange, monthDay } from '../dates/calendar';
import { formatMnt } from '../format/format';
import { DateRangeSheet } from '../orders/date-range-sheet';
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
  statementLink,
  statementRange,
} from './statement';

/** «Дебит» and «Кредит»: «2,095,200» whole at 13 px; a larger amount shrinks to fit. */
const AMOUNT = 60;
const BALANCE = 68;

/**
 * «Тооцооны хуулга» on «Тооцоо» (ADR-0086; redrawn by the owner's word 2026-11-06, ADR-0167): the
 * days (three chips, any range from the calendar), three tiles «Дебит · Кредит · Эцсийн үлдэгдэл»,
 * and the table «Огноо, баримт · Дебит · Кредит · Үлдэгдэл»: the opening balance, every entry oldest
 * first with the balance after it, «Нийт» and the closing balance. A purchase opens its order, and
 * the phone's back returns here with the days as they were.
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
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={type.sectionTitle}>
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

/** What moved in these days and where it ended; the opening balance heads the table. */
function StatementSum({ data }: { data: StoreStatement }) {
  const { t } = useTranslation();
  const signed = (key: 'plus' | 'minus', amount: string) =>
    columnAmount(amount)
      ? t(`mobile.customer.statement.${key}`, { amount: formatMnt(amount) })
      : formatMnt(amount);
  return (
    <View style={styles.tiles}>
      <SumTile
        label={t('mobile.customer.statement.debit')}
        value={signed('plus', data.totalDebit)}
      />
      <SumTile
        label={t('mobile.customer.statement.credit')}
        value={signed('minus', data.totalCredit)}
        valueStyle={styles.credit}
      />
      <SumTile
        label={t('mobile.customer.statement.closing')}
        value={formatMnt(data.closing)}
        style={styles.tileClosing}
        valueStyle={styles.tileClosingValue}
      />
    </View>
  );
}

function SumTile({
  label,
  value,
  style,
  valueStyle,
}: {
  label: string;
  value: string;
  style?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.tile, style]}>
      <Text style={[type.heading, tabular, valueStyle]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[type.secondary, styles.label2]} numberOfLines={2}>
        {label}
      </Text>
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
 * One entry: «10/12 Худалдан авалт», its number (blue with › when it opens the order) and, for a
 * purchase, who took its order; its amount under «Дебит» or «Кредит» and the balance after it. A
 * payment's «Гүйлгээний утга» runs under the row across its whole width (the owner 2026-11-06): once
 * the bank's statement makes the vouchers, it is what the store wrote in its own transfer.
 */
function EntryRow({ entry }: { entry: StoreStatementEntry }) {
  const { t } = useTranslation();
  const router = useRouter();
  const takerText = useTakerText();
  const kind = t(`mobile.customer.statement.kinds.${entry.kind}`);
  const taker = entry.orderChannel
    ? takerText(takerOf({ channel: entry.orderChannel, takerName: entry.orderTakerName }))
    : null;
  const link = statementLink(entry);
  const cell = (amount: string) => {
    const shown = columnAmount(amount);
    return shown ? formatMnt(shown) : '';
  };
  const content = (
    <>
      <View style={styles.grow}>
        <Text
          style={storeType.tableCell}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
        >
          <Text style={[storeType.tableCellStrong, tabular]}>{monthDay(entry.date)}</Text> {kind}
        </Text>
        <View style={styles.line}>
          <Text
            style={[type.secondary, tabular, styles.shrink, link !== null && styles.link]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
            {entry.number}
          </Text>
          {link !== null ? <ChevronRight size={12} strokeWidth={2.4} color={colors.link} /> : null}
        </View>
        {taker ? (
          <Text
            style={type.secondary}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
          >
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
  return link !== null ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(
        entry.orderId !== null
          ? 'mobile.customer.statement.entryLabelOrder'
          : 'mobile.customer.statement.entryLabel',
        { kind, number: entry.number, date: monthDay(entry.date) },
      )}
      onPress={() => router.push(link)}
      style={({ pressed }) => [styles.tr, styles.entry, styles.rule, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.rule}>
      <View style={[styles.tr, styles.entry, entry.description ? styles.entryOver : null]}>
        {content}
      </View>
      {entry.description ? (
        <Text selectable style={[type.secondary, styles.description]}>
          {entry.description}
        </Text>
      ) : null}
    </View>
  );
}

/** A column's head, upper case and right-aligned over its amounts. */
function Head({ width, children }: { width: number; children: ReactNode }) {
  return (
    <Text
      style={[storeType.tableHead, styles.upper, styles.right, { width }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
    >
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

const styles = StyleSheet.create({
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
  heading: { marginTop: spacing.xl, flexDirection: 'row', alignItems: 'center', gap: 10 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  loading: { marginVertical: spacing.xl },
  tiles: { marginTop: spacing.md, flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    padding: 10,
    borderRadius: radii.field,
    backgroundColor: colors.card,
  },
  tileClosing: { backgroundColor: colors.secondary },
  tileClosingValue: { color: colors.primary },
  closingRow: { minHeight: 52, backgroundColor: colors.secondary },
  table: {
    marginTop: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  tr: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  thead: {
    minHeight: 34,
    paddingVertical: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.canvas,
  },
  tint: { backgroundColor: colors.accent },
  rule: { borderBottomWidth: 1, borderBottomColor: colors.canvas },
  entry: { minHeight: 52, paddingVertical: 7 },
  entryOver: { paddingBottom: 2 },
  description: { paddingHorizontal: 10, paddingBottom: spacing.sm, color: colors.label2 },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  amount: { width: AMOUNT },
  balance: { width: BALANCE },
  hint: { marginTop: 10, marginHorizontal: spacing.xs, color: colors.muted },
});
