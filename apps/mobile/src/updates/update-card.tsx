import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { CompanyMark, useAppName } from '../ui/brand';
import { colors, spacing, storeType, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { Text } from '../ui/text';
import { type AppRelease, megabytesOf } from './update';
import { useUpdateInstaller } from './use-app-update';

/**
 * «Шинэ хувилбар» on top of «Мэдэгдэл» (ADR-0166): the version and the size, a press downloads it
 * from the server with its progress and opens Android's installer.
 */
export function UpdateCard({
  release,
  autoStart = 0,
  style,
}: {
  release: AppRelease;
  /** Counts the presses of «Шинэчлэл шалгах» that found this release: each one starts it (ADR-0174 #10). */
  autoStart?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const appName = useAppName();
  const { step, start } = useUpdateInstaller(release);
  const started = useRef(0);
  useEffect(() => {
    if (autoStart <= started.current) return;
    started.current = autoStart;
    void start();
  }, [autoStart, start]);
  const line = t('mobile.customer.update.line', {
    app: appName,
    version: release.version,
    size: megabytesOf(release.sizeBytes),
  });
  return (
    <View style={[styles.card, style]}>
      <View style={styles.head}>
        <CompanyMark size={40} />
        <View style={styles.text}>
          <Text style={type.rowStrong}>{t('mobile.customer.update.title')}</Text>
          <Text style={[storeType.sectionSub, styles.line]}>{line}</Text>
        </View>
      </View>
      {step.kind === 'downloading' ? (
        <View style={styles.progress}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${step.percent}%` }]} />
          </View>
          <Text style={type.secondary}>
            {t('mobile.customer.update.downloading', { percent: step.percent })}
          </Text>
        </View>
      ) : (
        <>
          {step.kind === 'failed' ? (
            <Text style={[type.secondary, styles.problem]}>
              {t(`mobile.customer.update.failed.${step.reason}`)}
            </Text>
          ) : null}
          <PillButton
            height={44}
            style={styles.button}
            title={
              step.kind === 'ready'
                ? t('mobile.customer.update.install')
                : step.kind === 'failed'
                  ? t('mobile.customer.update.retry')
                  : t('mobile.customer.update.download')
            }
            onPress={() => void start()}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    padding: 14,
    gap: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 2 },
  line: { color: colors.label2 },
  progress: { gap: 6 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  problem: { color: colors.destructiveText },
  button: { alignSelf: 'stretch' },
});
