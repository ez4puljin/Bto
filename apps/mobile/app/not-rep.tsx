import { StatusBar } from 'expo-status-bar';
import { ShieldAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../src/state/session';
import { colors, spacing } from '../src/theme/tokens';
import { useAppName } from '../src/ui/brand';
import { PillButton } from '../src/ui/controls';
import { EmptyState } from '../src/ui/kit';
import { Page } from '../src/ui/layout';
import { StoreHeader } from '../src/ui/store-header';

/**
 * Signed in without `sales.orders.rep`: the app is for sales reps (ADR-0061 #5). Under the blue
 * header with the app's name and white status bar icons, as the signed-in pages (ADR-0100).
 */
export default function NotRepScreen() {
  const { t } = useTranslation();
  const appName = useAppName();
  const { session, state } = useSession();
  const name = state.status === 'signedIn' && 'fullName' in state.me ? state.me.fullName : '';
  return (
    <Page white edges={['bottom']}>
      <StatusBar style="light" />
      <StoreHeader title={appName} right={null} />
      <View style={styles.body}>
        <EmptyState
          icon={<ShieldAlert size={48} strokeWidth={1.5} color={colors.warning} />}
          title={t('mobile.notRep.title')}
          hint={t('mobile.notRep.hint', { name })}
        />
        <PillButton
          title={t('mobile.profile.logout')}
          variant="destructive"
          height={50}
          onPress={() => void session?.logout()}
        />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
});
