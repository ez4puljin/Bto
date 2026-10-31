import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { brandSheet } from '../theme/brand';
import { colors, fonts, type } from '../theme/tokens';
import { Text } from '../ui/text';
import type { LineState } from './counts';
import { statusKey, statusTone, type TransferStatus } from './statuses';

/** A transfer's or a request's status on its pill (ADR-0116). */
export function TransferStatusPill({ status }: { status: TransferStatus }) {
  const { t } = useTranslation();
  const tone = statusTone(status);
  return (
    <View style={[styles.pill, { backgroundColor: tone.background }]}>
      <Text style={[styles.pillText, { color: tone.text }]}>{t(statusKey(status))}</Text>
    </View>
  );
}

/** A draft request without a number yet: «Ноорог» on the grey pill. */
export function DraftPill() {
  return <TransferStatusPill status="DRAFT" />;
}

const LINE_TONES: Record<LineState['kind'], { background: string; text: string }> = brandSheet(
  () => ({
    unchecked: { background: colors.canvas, text: colors.muted },
    notArrived: { background: colors.destructiveSoft, text: colors.destructive },
    short: { background: colors.warningSoft, text: colors.warning },
    over: { background: colors.warningSoft, text: colors.warning },
    exact: { background: colors.successSoft, text: colors.success },
    extra: { background: colors.secondary, text: colors.secondaryForeground },
  }),
);

/**
 * A shipped line's state as a small badge (ADR-0116 #4): «Тоолоогүй» grey, «Ирээгүй» red, «Дутуу»
 * / «Илүү» orange with the difference in base units, «Таарсан» green, «Хүсэлтэд байхгүй» blue.
 */
export function LineStateBadge({ state, baseUnit }: { state: LineState; baseUnit: string }) {
  const { t } = useTranslation();
  const tone = LINE_TONES[state.kind];
  const label =
    state.kind === 'short' || state.kind === 'over'
      ? t(`mobile.transfers.receive.states.${state.kind}`, { n: state.diffBase, unit: baseUnit })
      : t(`mobile.transfers.receive.states.${state.kind}`);
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
