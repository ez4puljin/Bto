import Constants from 'expo-constants';
import { CircleAlert, CircleCheck, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, spacing, tabular, type } from '../theme/tokens';
import { CompanyMark, useAppName } from '../ui/brand';
import { PillButton } from '../ui/controls';
import { Card } from '../ui/staff-kit';
import { Text } from '../ui/text';
import { UpdateCard } from './update-card';
import { type CheckState, useAppUpdate, useUpdateCheck } from './use-app-update';

/**
 * «Шинэчлэл шалгах» (ADR-0174 #10) as one row of a card (the boards of 2026-11-16): the emblem, the
 * app's version with what the last press found under it, and the small «Шалгах» button. A newer
 * release is not shown here: the update card above it takes over and downloads it.
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
    <Card style={[styles.card, style]}>
      <CompanyMark size={40} />
      <View style={styles.grow}>
        <Text style={[type.rowStrong, tabular]} numberOfLines={1}>
          {build
            ? t('mobile.profile.versionLine', { version, build })
            : t('mobile.update.version', { version })}
        </Text>
        {outcome ? (
          <View style={styles.outcome} accessibilityLiveRegion="polite">
            <outcome.Icon size={14} strokeWidth={2.2} color={outcome.color} style={styles.icon} />
            <Text style={[type.secondary, styles.grow, { color: outcome.color }]}>
              {outcome.text}
            </Text>
          </View>
        ) : (
          <Text style={type.secondary} numberOfLines={1}>
            {appName}
          </Text>
        )}
      </View>
      <PillButton
        variant="soft"
        height={36}
        style={styles.button}
        title={t('mobile.update.checkShort')}
        accessibilityLabel={t('mobile.update.check')}
        loading={state.kind === 'checking'}
        onPress={onCheck}
      />
    </Card>
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
    <View style={[styles.stack, style]}>
      {update ? <UpdateCard release={update} autoStart={found} /> : null}
      <UpdateCheckPanel state={state} onCheck={() => void check()} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, minWidth: 0 },
  outcome: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  icon: { marginTop: 1 },
  button: { paddingHorizontal: spacing.lg, minWidth: 88 },
  stack: { gap: spacing.md },
});
