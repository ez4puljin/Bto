import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import {
  type DateRange,
  daysBetween,
  monthDay,
  pickDay,
  presetOf,
  presetRange,
  RANGE_PRESETS,
  type RangeEnd,
} from '../dates/calendar';
import { monthOf } from '../dates/dates';
import { colors, fonts, spacing, tabular, type } from '../theme/tokens';
import { MonthCalendar } from '../ui/calendar';
import { ChoiceChip, PillButton } from '../ui/controls';
import { Group } from '../ui/grouped';
import { BarButton } from '../ui/layout';
import { Sheet, SheetHeader } from '../ui/sheet';

/**
 * «Огноо сонгох» (the DateRange board, ADR-0068): the presets, the start and the end (the one being
 * set is tinted), a month to tap days on, and «10/01 – 10/16 · 16 хоногийн захиалга». Future days
 * cannot be chosen; a range spans at most 366 days.
 */
export function DateRangeSheet({
  visible,
  today,
  range,
  onApply,
  onClose,
}: {
  visible: boolean;
  today: string;
  range: DateRange;
  onApply: (range: DateRange) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(range);
  const [picking, setPicking] = useState<RangeEnd>('end');
  const [month, setMonth] = useState(monthOf(range.to));
  useEffect(() => {
    if (!visible) return;
    setDraft(range);
    setPicking('end');
    setMonth(monthOf(range.to));
  }, [visible, range]);
  const chosen = presetOf(draft, today);
  const field = (end: RangeEnd, date: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: picking === end }}
      onPress={() => {
        setPicking(end);
        setMonth(monthOf(date));
      }}
      style={styles.field}
    >
      <Text style={type.row}>
        {end === 'start' ? t('mobile.dateRange.start') : t('mobile.dateRange.end')}
      </Text>
      <View style={[styles.value, picking === end && styles.valueOn]}>
        <Text style={[styles.valueText, picking === end && styles.valueTextOn]}>
          {date.replace(/-/g, '.')}
        </Text>
      </View>
    </Pressable>
  );
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      closeLabel={t('common.cancel')}
      top={42}
      header={
        <SheetHeader
          left={<BarButton title={t('common.cancel')} onPress={onClose} />}
          title={t('mobile.dateRange.title')}
          right={
            <BarButton title={t('mobile.keypad.done')} onPress={() => onApply(draft)} strong />
          }
        />
      }
      footer={
        <PillButton
          title={t('mobile.dateRange.apply', {
            from: monthDay(draft.from),
            to: monthDay(draft.to),
            n: daysBetween(draft.from, draft.to),
          })}
          onPress={() => onApply(draft)}
        />
      }
    >
      <ScrollView contentContainerStyle={styles.body}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presets}
        >
          {RANGE_PRESETS.map((preset) => (
            <ChoiceChip
              key={preset}
              compact
              label={t(`mobile.dateRange.presets.${preset}`)}
              selected={chosen === preset}
              onPress={() => {
                const next = presetRange(preset, today);
                setDraft(next);
                setPicking('end');
                setMonth(monthOf(next.to));
              }}
            />
          ))}
        </ScrollView>
        <Group style={styles.group}>
          {field('start', draft.from)}
          {field('end', draft.to)}
        </Group>
        <View style={styles.group}>
          <MonthCalendar
            month={month}
            onMonth={setMonth}
            today={today}
            value={draft}
            max={today}
            onPick={(date) => {
              const next = pickDay(draft, picking, date);
              setDraft(next.range);
              setPicking(next.picking);
            }}
          />
        </View>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: spacing.xl },
  presets: { gap: spacing.sm, paddingTop: 2, paddingHorizontal: spacing.lg },
  group: { marginTop: 14, marginHorizontal: spacing.lg },
  field: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  value: {
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.fieldFill,
    justifyContent: 'center',
  },
  valueOn: { backgroundColor: colors.rangeFill },
  valueText: { ...type.row, ...tabular },
  valueTextOn: { fontFamily: fonts.semibold, color: colors.primary },
});
