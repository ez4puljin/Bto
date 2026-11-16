import {
  EXPIRY_MAX_FUTURE_YEARS,
  EXPIRY_MAX_PAST_YEARS,
  EXPIRY_NOTE_MAX,
  expiryUrgency,
  type ExpiryStatus,
} from '@tugeel/shared/expiry';
import { isIsoDate } from '@tugeel/shared/time';
import { ChevronRight } from 'lucide-react-native';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type TextInputProps, View } from 'react-native';
import type { ExpiryItem } from '../api/expiry';
import { maskDate } from '../dates/mask';
import { formatQty } from '../format/format';
import { colors, spacing, tabular, TOUCH, type } from '../theme/tokens';
import { TextField } from '../ui/field';
import { ActionSheet } from '../ui/sheet';
import { Notice, Pill, type Tone } from '../ui/staff-kit';
import { HeaderSearch as HeaderSearchField } from '../transfers/header-search';
import { Text, type TextInput } from '../ui/text';
import type { LeaveGuard } from './leave-guard';
import {
  cleanQty,
  daysLeftOf,
  daysWords,
  displayDate,
  type ExpiryEdits,
  type ExpiryForm,
  type FormProblems,
  URGENCY_TONES,
} from './rules';

// The pieces the three «Хугацаа илрүүлэлт» screens share (ADR-0172 #9).

/** What back asks while something typed is unsaved: stay, or drop it and leave (`useLeaveGuard`). */
export function LeaveSheet({ guard }: { guard: LeaveGuard }) {
  const { t } = useTranslation();
  return (
    <ActionSheet
      visible={guard.asking}
      title={t('mobile.expiry.leave.title')}
      message={t('mobile.expiry.leave.message')}
      actions={[
        { label: t('mobile.expiry.leave.confirm'), destructive: true, onPress: guard.leave },
      ]}
      cancelLabel={t('common.discard.keep')}
      onCancel={guard.stay}
    />
  );
}

const STATUS_PILLS: Record<ExpiryStatus, Tone> = {
  REVIEW: 'info',
  CITY_RETURN: 'violet',
  INTERNAL_SALE: 'warn',
  ARCHIVED: 'neutral',
};

/** A record's status on its soft colour. */
export function ExpiryStatusPill({ status }: { status: ExpiryStatus }) {
  const { t } = useTranslation();
  return <Pill label={t(`expiry.status.${status}`)} tone={STATUS_PILLS[status]} />;
}

/** «12 хоног үлдсэн» on a pill in the colour of how close the date is, beside a typed date. */
export function DaysPill({ daysLeft }: { daysLeft: number }) {
  const { t } = useTranslation();
  const words = daysWords(daysLeft);
  return (
    <Pill label={t(words.key, { n: words.n })} tone={URGENCY_PILLS[expiryUrgency(daysLeft)]} />
  );
}

const URGENCY_PILLS = { EXPIRED: 'bad', URGENT: 'warn', SOON: 'info', OK: 'ok' } as const;

/**
 * The days left on a tile in the urgency's tone (red past, orange within a week, blue within a
 * month, green beyond): the number over «хоног», a past date with its minus. 52 px in a list,
 * 44 px in a product's own records, 60 px on the record's page.
 */
export function DaysTile({ daysLeft, size = 52 }: { daysLeft: number; size?: 44 | 52 | 60 }) {
  const { t } = useTranslation();
  const tone = URGENCY_TONES[expiryUrgency(daysLeft)];
  const words = daysWords(daysLeft);
  return (
    <View
      accessible
      accessibilityLabel={t(words.key, { n: words.n })}
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size >= 60 ? 16 : size >= 52 ? 14 : 12 },
        { backgroundColor: tone.background },
      ]}
    >
      <Text
        style={[
          size >= 60 ? type.title3 : type.heading,
          tabular,
          styles.tileNumber,
          { color: tone.text },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {String(daysLeft)}
      </Text>
      <Text style={[type.caption, { color: tone.text }]} numberOfLines={1}>
        {t('mobile.expiry.daysUnit')}
      </Text>
    </View>
  );
}

/**
 * One record as a row of a grouped list: the days tile, the product with the status pill, the code
 * and the date, the two counts and the total. A product's own open records leave out its name and
 * code: the date, the two counts and a chevron.
 */
export function ExpiryRecordRow({
  item,
  onPress,
  showProduct = true,
}: {
  item: ExpiryItem;
  onPress: () => void;
  showProduct?: boolean;
}) {
  const { t } = useTranslation();
  const unit = item.product.baseUomName;
  const counts = [
    `${t('mobile.expiry.row.floor')} ${formatQty(item.qtyFloor)}`,
    `${t('mobile.expiry.row.warehouse')} ${formatQty(item.qtyWarehouse)}`,
    `${t('mobile.expiry.row.total')} ${t('mobile.expiry.row.qty', { qty: formatQty(item.qtyTotal), unit })}`,
  ].join(' · ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !showProduct && styles.rowSmall,
        pressed && styles.pressed,
      ]}
    >
      <DaysTile daysLeft={item.daysLeft} size={showProduct ? 52 : 44} />
      {showProduct ? (
        <View style={styles.rowBody}>
          <View style={styles.rowLine}>
            <Text style={[type.rowStrong, styles.rowTitle]} numberOfLines={2}>
              {item.product.name}
            </Text>
            <ExpiryStatusPill status={item.status} />
          </View>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {`${item.product.sku} · ${displayDate(item.expiryDate)}`}
          </Text>
          <Text style={[type.secondary, tabular, styles.counts2]} numberOfLines={1}>
            {counts}
          </Text>
        </View>
      ) : (
        <View style={styles.rowBodySmall}>
          <View style={styles.rowLine}>
            <Text style={[type.row, tabular]}>{displayDate(item.expiryDate)}</Text>
            <ExpiryStatusPill status={item.status} />
          </View>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {counts}
          </Text>
        </View>
      )}
      {showProduct ? null : <ChevronRight size={18} strokeWidth={2.4} color={colors.input} />}
    </Pressable>
  );
}

/**
 * The white search of a blue header, with the scan icon inside it when the page scans (the
 * warehouse boards' `hdr-search`).
 */
export function HeaderSearch({
  value,
  onChangeText,
  placeholder,
  label,
  autoFocus = false,
  onScan,
  scanLabel,
}: Pick<TextInputProps, 'placeholder'> & {
  value: string;
  onChangeText: (text: string) => void;
  label: string;
  autoFocus?: boolean;
  onScan?: () => void;
  scanLabel?: string;
}) {
  return (
    <HeaderSearchField
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      accessibilityLabel={label}
      autoFocus={autoFocus}
      {...(onScan ? { onScan } : {})}
      {...(scanLabel ? { scanLabel } : {})}
    />
  );
}

/**
 * The date, the two counts and the note of a new record and a correction. The date shows its days
 * as it is typed, a past one clearly, since finding expired goods is the point; a problem shows
 * once a save was tried, a date's as soon as all of it is there. `beside` is what stands now under
 * a typed field, after someone else's save refused this one (`standingBeside`).
 */
export function ExpiryFields({
  form,
  onChange,
  problems,
  checked,
  today,
  fractional,
  unit,
  beside = null,
}: {
  form: ExpiryForm;
  onChange: (patch: Partial<ExpiryForm>) => void;
  problems: FormProblems;
  checked: boolean;
  today: string | null;
  fractional: boolean | null;
  unit: string;
  beside?: ExpiryEdits | null;
}) {
  const { t } = useTranslation();
  const floorRef = useRef<TextInput>(null);
  const warehouseRef = useRef<TextInput>(null);
  const qtyKeyboard = fractional === true ? 'decimal-pad' : 'number-pad';
  const complete = isIsoDate(form.date);
  const daysLeft = complete && today !== null ? daysLeftOf(form.date, today) : null;
  const dateError =
    !checked && form.date.length < 10
      ? null
      : problems.date === 'date'
        ? t('mobile.expiry.errors.date')
        : problems.date === 'range'
          ? t('mobile.expiry.errors.dateRange', {
              past: EXPIRY_MAX_PAST_YEARS,
              future: EXPIRY_MAX_FUTURE_YEARS,
            })
          : null;
  const qtyError = (problem: FormProblems['floor']) =>
    !checked || problem === null
      ? null
      : problem === 'whole'
        ? t('mobile.expiry.errors.whole')
        : t('mobile.expiry.errors.qty');
  const standingHint = (value: string | undefined) =>
    value === undefined
      ? null
      : t('expiry.panel.currentValue', { value: value === '' ? t('common.none') : value });

  return (
    <View style={styles.fields}>
      <View>
        <TextField
          label={t('mobile.expiry.fields.date')}
          placeholder={t('common.calendar.datePlaceholder')}
          value={form.date}
          onChangeText={(text) => {
            const date = maskDate(text);
            onChange({ date });
            // The date is whole: the shelf's count comes next.
            if (date !== form.date && isIsoDate(date)) floorRef.current?.focus();
          }}
          keyboardType="number-pad"
          maxLength={10}
          error={dateError}
          hint={standingHint(beside?.date)}
        />
        {daysLeft !== null && dateError === null ? (
          <View style={styles.days}>
            <DaysPill daysLeft={daysLeft} />
            {daysLeft < 0 ? <Notice tone="bad">{t('mobile.expiry.fields.past')}</Notice> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.counts}>
        <TextField
          inputRef={floorRef}
          style={styles.count}
          label={t('mobile.expiry.fields.floor', { unit })}
          value={form.floor}
          onChangeText={(text) => onChange({ floor: cleanQty(text, fractional === true) })}
          keyboardType={qtyKeyboard}
          selectTextOnFocus
          returnKeyType="next"
          onSubmitEditing={() => warehouseRef.current?.focus()}
          error={qtyError(problems.floor)}
          hint={standingHint(beside?.floor)}
        />
        <TextField
          inputRef={warehouseRef}
          style={styles.count}
          label={t('mobile.expiry.fields.warehouse', { unit })}
          value={form.warehouse}
          onChangeText={(text) => onChange({ warehouse: cleanQty(text, fractional === true) })}
          keyboardType={qtyKeyboard}
          selectTextOnFocus
          error={qtyError(problems.warehouse)}
          hint={standingHint(beside?.warehouse)}
        />
      </View>
      {checked && problems.counts ? (
        <Text accessibilityRole="alert" style={styles.countsError}>
          {t('mobile.expiry.errors.counts')}
        </Text>
      ) : null}
      <TextField
        label={t('mobile.expiry.fields.note')}
        value={form.note}
        onChangeText={(note) => onChange({ note })}
        maxLength={EXPIRY_NOTE_MAX}
        hint={standingHint(beside?.note)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  tileNumber: { lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: TOUCH,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowSmall: { alignItems: 'center', paddingVertical: 10 },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowBodySmall: { flex: 1, minWidth: 0, gap: 2 },
  rowLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { flex: 1, minWidth: 0 },
  counts2: { color: colors.label2 },
  pressed: { backgroundColor: colors.accent },
  fields: { gap: spacing.lg },
  days: { marginTop: spacing.sm, gap: spacing.sm },
  counts: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  count: { flex: 1, minWidth: 0 },
  countsError: { ...type.secondary, color: colors.destructive },
});
