import { RotateCw, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { serverHost } from '../src/server/server-url';
import { useSession } from '../src/state/session';
import { colors, type } from '../src/theme/tokens';
import { BrandLockup, ServerChip } from '../src/ui/brand';
import { PillButton } from '../src/ui/controls';
import { Page } from '../src/ui/layout';
import { Text } from '../src/ui/text';

/**
 * A stored session the server could not be asked about (ADR-0061, ADR-0066): try again when the
 * Wi-Fi is back, or go to the server screen, which keeps this address on its recent list.
 */
export default function OfflineScreen() {
  const { t } = useTranslation();
  const { session, server, setServer } = useSession();
  const [busy, setBusy] = useState(false);
  const address = session?.server ?? server ?? '';

  const retry = async () => {
    if (!session || busy) return;
    setBusy(true);
    await session.restore();
    setBusy(false);
  };

  return (
    <Page white edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <BrandLockup />
        <View style={styles.badge}>
          <WifiOff size={24} strokeWidth={2} color={colors.warning} />
        </View>
        <Text accessibilityRole="header" style={[type.title, styles.title]}>
          {t('mobile.offline.title')}
        </Text>
        <Text style={[type.body, styles.lead]}>
          {t('mobile.offline.hint', { server: serverHost(address) })}
        </Text>
        <PillButton
          style={styles.button}
          height={50}
          icon={<RotateCw size={18} strokeWidth={2.2} color={colors.primaryForeground} />}
          title={t('mobile.offline.retry')}
          loading={busy}
          loadingTitle={t('mobile.offline.retrying')}
          onPress={() => void retry()}
        />
        <View style={styles.spacer} />
        <ServerChip server={address} onPress={() => void setServer(null)} />
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  badge: {
    marginTop: 40,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { marginTop: 16 },
  lead: { marginTop: 6, color: colors.muted },
  button: { marginTop: 28 },
  spacer: { flex: 1, minHeight: 24 },
});
