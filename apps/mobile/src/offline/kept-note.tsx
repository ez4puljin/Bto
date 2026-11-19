import { CloudOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, type TextStyle, View, type ViewStyle } from 'react-native';
import { monthDay } from '../dates/calendar';
import { ubDate, ubTime } from '../dates/dates';
import { useKept } from '../state/kept';
import { useSignedIn } from '../state/session';
import { colors, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';

/** «11/19 14:05»: when the kept copy was taken, in Ulaanbaatar. */
export const keptAt = (iso: string) => `${monthDay(ubDate(iso))} ${ubTime(iso)}`;

/**
 * Whether a screen shows kept data now: `kept` while the session has no connection and a copy
 * exists, `missing` while it has none and no copy was downloaded yet (the screens then say so
 * instead of their network problem). Both false online and for a non-rep.
 */
export function useKeptView(): { kept: boolean; missing: boolean; at: string | null } {
  const { offline } = useSignedIn();
  const { store, state } = useKept();
  if (!offline || !store || !state.ready) return { kept: false, missing: false, at: null };
  return state.pointer
    ? { kept: true, missing: false, at: state.pointer.at }
    : { kept: false, missing: true, at: null };
}

/**
 * The one line over a screen that shows kept data (ADR-0225 #2): «Сервергүй горим · өгөгдөл:
 * <өдөр цаг>», or that nothing was downloaded yet. Nothing online.
 */
export function KeptNote({ style }: { style?: StyleProp<ViewStyle> }) {
  const { t } = useTranslation();
  const view = useKeptView();
  if (!view.kept && !view.missing) return null;
  return (
    <View accessibilityRole="text" style={[styles.note, style]}>
      <CloudOff size={16} strokeWidth={2} color={colors.warningText} />
      <Text style={styles.text}>
        {view.kept && view.at
          ? t('mobile.offlineData.note', { at: keptAt(view.at) })
          : t('mobile.offlineData.missing')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.warningSoft,
  },
  text: { ...type.caption, flex: 1, color: colors.warningText },
  estimate: { ...type.caption, color: colors.muted },
  unpriced: { ...type.caption, color: colors.destructive },
});

/** Under an estimated amount (ADR-0225 #4): the server prices the order when it arrives. */
export function EstimateNote({
  unpriced = 0,
  style,
}: {
  /** Lines the estimate could not price: said beside it, so a low total never reads as whole. */
  unpriced?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {unpriced > 0 ? (
        <Text style={[styles.unpriced, style]}>
          {t('mobile.offlineData.unpriced', { n: unpriced })}
        </Text>
      ) : null}
      <Text style={[styles.estimate, style]}>{t('mobile.offlineData.estimateNote')}</Text>
    </>
  );
}
