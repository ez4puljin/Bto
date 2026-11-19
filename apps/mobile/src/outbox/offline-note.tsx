import { WifiOff } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, type } from '../theme/tokens';
import { Text } from '../ui/text';

/**
 * The slim note over the staff app while the server does not answer (owner 2026-11-19): it sits
 * under the status bar, above every screen, and goes away by itself once the session is online.
 * A rep reads that the orders wait on the phone; anyone else only that there is no connection.
 */
export function OfflineNote({ rep }: { rep: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.note, { paddingTop: insets.top + spacing.xs }]}
    >
      <WifiOff size={16} strokeWidth={2.2} color={colors.primaryForeground} />
      <Text style={styles.text} numberOfLines={3}>
        {rep ? t('mobile.outbox.offlineRep') : t('mobile.outbox.offline')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.warning,
  },
  text: { ...type.caption, flex: 1, color: colors.primaryForeground },
});
