import { WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../src/state/session';
import { colors, spacing } from '../src/theme/tokens';
import { Button, EmptyState, Screen } from '../src/ui/kit';

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
    <Screen bottom style={styles.body}>
      <EmptyState
        icon={<WifiOff size={48} color={colors.muted} />}
        title={t('mobile.offline.title')}
        hint={t('mobile.offline.hint', { server: session?.server ?? '' })}
      />
      <View style={styles.actions}>
        <Button title={t('mobile.offline.retry')} onPress={() => void retry()} loading={busy} />
        <Button
          variant="ghost"
          title={t('mobile.server.change')}
          onPress={() => void setServer(null)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { justifyContent: 'center', padding: spacing.lg },
  actions: { gap: spacing.sm },
});
