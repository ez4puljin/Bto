import {
  EXPIRY_MAX_FUTURE_YEARS,
  EXPIRY_MAX_PAST_YEARS,
  EXPIRY_NOTE_MAX,
  expiryUrgency,
  type ExpiryStatus,
} from '@tugeel/shared/expiry';
import { isIsoDate } from '@tugeel/shared/time';
import { ChevronRight } from 'lucide-react-native';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, type TextInputProps, View } from 'react-native';
import type { ExpiryItem } from '../api/expiry';
import { StatusPill } from '../community/parts';
import { maskDate } from '../dates/mask';
import { formatQty } from '../format/format';
import { colors, fonts, radii, spacing, tabular, TOUCH, type } from '../theme/tokens';
import { SearchField } from '../ui/controls';
import { TextField } from '../ui/field';
import { ActionSheet } from '../ui/sheet';
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
  STATUS_TONES,
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

/** A record's status on its soft colour. */
export function ExpiryStatusPill({ status }: { status: ExpiryStatus }) {
  const { t } = useTranslation();
  const tone = STATUS_TONES[status];
  return (
    <StatusPill
      label={t(`expiry.status.${status}`)}
      background={tone.background}
      color={tone.text}
    />
  );
}

/** «12 хоног үлдсэн» in the colour of how close the date is. */
export function DaysText({ daysLeft }: { daysLeft: number }) {
  const { t } = useTranslation();
  const words = daysWords(daysLeft);
  return (
    <Text style={[type.bodyStrong, { color: URGENCY_TONES[expiryUrgency(daysLeft)].text }]}>
      {t(words.key, { n: words.n })}
    </Text>
  );
}

/** «Заал · Агуулах · Нийт», each with the base unit. */
export function QtyCells({
  floor,
  warehouse,
  total,
  unit,
}: {
  floor: string;
  warehouse: string;
  total: string;
  unit: string;
}) {
  const { t } = useTranslation();
  const cell = (label: string, qty: string, strong = false) => (
    <View style={styles.cell}>
      <Text style={type.caption} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[strong ? type.bodyStrong : type.body, tabular]} numberOfLines={1}>
        {t('mobile.expiry.row.qty', { qty: formatQty(qty), unit })}
      </Text>
    </View>
  );
  return (
    <View style={styles.cells}>
      {cell(t('mobile.expiry.row.floor'), floor)}
      {cell(t('mobile.expiry.row.warehouse'), warehouse)}
      {cell(t('mobile.expiry.row.total'), total, true)}
    </View>
  );
}

/** One record in a list; a product's own open records leave out its name and code. */
export function ExpiryRecordRow({
  item,
  onPress,
  showProduct = true,
}: {
  item: ExpiryItem;
  onPress: () => void;
  showProduct?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowBody}>
        {showProduct ? (
          <View>
            <Text style={type.rowStrong} numberOfLines={2}>
              {item.product.name}
            </Text>
            <Text style={type.secondary} numberOfLines={1}>
              {item.product.sku}
            </Text>
          </View>
        ) : null}
        <View style={styles.rowLine}>
          <Text style={[type.bodyStrong, tabular]}>{displayDate(item.expiryDate)}</Text>
          <DaysText daysLeft={item.daysLeft} />
          <ExpiryStatusPill status={item.status} />
        </View>
        <QtyCells
          floor={item.qtyFloor}
          warehouse={item.qtyWarehouse}
          total={item.qtyTotal}
          unit={item.product.baseUomName}
        />
      </View>
      <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
    </Pressable>
  );
}

/**
 * The white search of a blue header, 44 px and all of it pressable (the field's own text is less
 * than that tall), with an optional button beside it.
 */
export function HeaderSearch({
  value,
  onChangeText,
  placeholder,
  label,
  autoFocus = false,
  trailing,
}: Pick<TextInputProps, 'placeholder'> & {
  value: string;
  onChangeText: (text: string) => void;
  label: string;
  autoFocus?: boolean;
  trailing?: ReactNode;
}) {
  const input = useRef<TextInput>(null);
  return (
    <View style={styles.searchRow}>
      <Pressable
        accessible={false}
        onPress={() => input.current?.focus()}
        style={styles.searchPress}
      >
        <SearchField
          inputRef={input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          accessibilityLabel={label}
          autoFocus={autoFocus}
          style={styles.search}
        />
      </Pressable>
      {trailing}
    </View>
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
            <DaysText daysLeft={daysLeft} />
            {daysLeft < 0 ? (
              <View style={styles.past}>
                <Text style={styles.pastText}>{t('mobile.expiry.fields.past')}</Text>
              </View>
            ) : null}
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
  cells: { flexDirection: 'row', gap: spacing.sm },
  cell: { flex: 1, minWidth: 0, gap: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  rowBody: { flex: 1, minWidth: 0, gap: spacing.sm },
  rowLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  pressed: { backgroundColor: colors.accent },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingBottom: spacing.md,
  },
  searchPress: { flex: 1 },
  search: { height: TOUCH, backgroundColor: colors.card },
  fields: { gap: spacing.md },
  days: { marginTop: spacing.sm, gap: spacing.sm },
  past: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.destructiveSoft,
  },
  pastText: { ...type.body, fontFamily: fonts.medium, color: colors.destructiveText },
  counts: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  count: { flex: 1, minWidth: 0 },
  countsError: { ...type.secondary, color: colors.destructive },
});
