import { WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../src/state/session';
import { colors, spacing } from '../src/theme/tokens';
import { PillButton } from '../src/ui/controls';
import { EmptyState } from '../src/ui/kit';
import { BarButton, Page } from '../src/ui/layout';

/** A stored session the server could not be asked about: try again when the Wi-Fi is back. */
export default function OfflineScreen() {
  const { t } = useTranslation();
  const { session, setServer } = useSession();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    if (!session) return;
    setBusy(true);
    await session.restore();
    setBusy(false);
  };

  return (
    <Page edges={['top', 'bottom']}>
      <View style={styles.body}>
        <EmptyState
          icon={<WifiOff size={48} strokeWidth={1.5} color={colors.input} />}
          title={t('mobile.offline.title')}
          hint={t('mobile.offline.hint', { server: session?.server ?? '' })}
        />
        <PillButton title={t('mobile.offline.retry')} onPress={() => void retry()} loading={busy} />
        <BarButton title={t('mobile.server.change')} onPress={() => void setServer(null)} />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    padding: spacing.lg,
    gap: spacing.md,
  },
});
