import { ShieldAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../src/state/session';
import { colors, spacing } from '../src/theme/tokens';
import { PillButton } from '../src/ui/controls';
import { EmptyState } from '../src/ui/kit';
import { Page } from '../src/ui/layout';

/** Signed in without `sales.orders.rep`: the app is for sales reps (ADR-0061 #5). */
export default function NotRepScreen() {
  const { t } = useTranslation();
  const { session, state } = useSession();
  const name = state.status === 'signedIn' ? state.me.fullName : '';
  return (
    <Page edges={['top', 'bottom']}>
      <View style={styles.body}>
        <EmptyState
          icon={<ShieldAlert size={48} strokeWidth={1.5} color={colors.warning} />}
          title={t('mobile.notRep.title')}
          hint={t('mobile.notRep.hint', { name })}
        />
        <PillButton
          title={t('mobile.profile.logout')}
          variant="destructive"
          onPress={() => void session?.logout()}
        />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
});
