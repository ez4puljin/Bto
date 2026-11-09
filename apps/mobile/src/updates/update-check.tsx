import Constants from 'expo-constants';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radii, spacing, tabular, type } from '../theme/tokens';
import { CompanyMark, useAppName } from '../ui/brand';
import { PillButton } from '../ui/controls';
import { Text } from '../ui/text';
import { UpdateCard } from './update-card';
import { type CheckState, useAppUpdate, useUpdateCheck } from './use-app-update';

/**
 * «Шинэчлэл шалгах» (ADR-0174 #10): the app's name and version, the button, and what the last press
 * found. A newer release is not shown here: the update card above it takes over and downloads it.
 */
export function UpdateCheckPanel({
  state,
  onCheck,
  style,
}: {
  state: CheckState;
  onCheck: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const appName = useAppName();
  const version = Constants.expoConfig?.version ?? '';
  const build = Constants.expoConfig?.android?.versionCode;
  const outcome =
    state.kind === 'latest'
      ? { Icon: CircleCheck, color: colors.success, text: t('mobile.update.latest') }
      : state.kind === 'offline'
        ? { Icon: CircleAlert, color: colors.warning, text: t('mobile.update.offline') }
        : state.kind === 'found'
          ? { Icon: RefreshCw, color: colors.primary, text: t('mobile.update.found') }
          : null;
  return (
    <View style={[styles.card, style]}>
      <View style={styles.head}>
        <CompanyMark size={36} />
        <View style={styles.grow}>
          <Text style={type.rowStrong} numberOfLines={1}>
            {appName}
          </Text>
          <Text style={[type.secondary, tabular]} numberOfLines={1}>
            {build
              ? t('mobile.update.versionBuild', { version, build })
              : t('mobile.update.version', { version })}
          </Text>
        </View>
      </View>
      {outcome ? (
        <View style={styles.outcome} accessibilityLiveRegion="polite">
          <outcome.Icon size={16} strokeWidth={2.2} color={outcome.color} />
          <Text style={[type.body, styles.grow, { color: outcome.color }]}>{outcome.text}</Text>
        </View>
      ) : null}
      <PillButton
        variant="soft"
        height={44}
        icon={<RefreshCw size={17} strokeWidth={2.2} color={colors.secondaryForeground} />}
        title={t('mobile.update.check')}
        loading={state.kind === 'checking'}
        loadingTitle={t('mobile.update.checking')}
        onPress={onCheck}
      />
    </View>
  );
}

/**
 * The check with its own update card, for a page that has no other (the profile): a press that
 * finds a newer release shows the card and starts the download at once.
 */
export function UpdateCheck({ style }: { style?: StyleProp<ViewStyle> }) {
  const update = useAppUpdate();
  const { state, found, check } = useUpdateCheck();
  return (
    <View style={style}>
      {update ? <UpdateCard release={update} autoStart={found} style={styles.cardGap} /> : null}
      <UpdateCheckPanel state={state} onCheck={() => void check()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardGap: { marginTop: 0, marginBottom: spacing.md },
});
