import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { colors, fonts, type } from '../theme/tokens';
import { Text } from '../ui/text';
import type { LineCountState } from './sections';
import type { PickStatus } from './types';

/** A part's tone as the web draws it (ADR-0126 #2): grey, orange, green. */
const PART_TONES: Record<PickStatus, { background: string; text: string }> = {
  OPEN: { background: colors.canvas, text: colors.muted },
  PICKING: { background: colors.warningSoft, text: colors.warning },
  DONE: { background: colors.successSoft, text: colors.success },
};

export function PickStatusPill({ status }: { status: PickStatus }) {
  const { t } = useTranslation();
  const tone = PART_TONES[status];
  return (
    <View style={[styles.pill, { backgroundColor: tone.background }]}>
      <Text style={[styles.pillText, { color: tone.text }]}>
        {t(`mobile.picking.status.${status}`)}
      </Text>
    </View>
  );
}

const LINE_TONES: Record<LineCountState['kind'], { background: string; text: string }> = {
  uncounted: { background: colors.canvas, text: colors.muted },
  out: { background: colors.destructiveSoft, text: colors.destructive },
  short: { background: colors.warningSoft, text: colors.warning },
  full: { background: colors.successSoft, text: colors.success },
};

/** A line's count as a badge: «Тоолоогүй» grey, «Дууссан» red, «Дутуу n» orange, «Бүтэн» green. */
export function LineCountBadge({ state, baseUnit }: { state: LineCountState; baseUnit: string }) {
  const { t } = useTranslation();
  const tone = LINE_TONES[state.kind];
  const label =
    state.kind === 'short'
      ? t('mobile.picking.part.states.short', { n: state.diffBase, unit: baseUnit })
      : t(`mobile.picking.part.states.${state.kind}`);
  return (
    <View style={[styles.badge, { backgroundColor: tone.background }]}>
      <Text style={[styles.badgeText, { color: tone.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { height: 22, paddingHorizontal: 8, borderRadius: 11, justifyContent: 'center' },
  pillText: { ...type.secondary, fontFamily: fonts.semibold },
  badge: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 10,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  badgeText: { ...type.caption, fontFamily: fonts.semibold },
});
