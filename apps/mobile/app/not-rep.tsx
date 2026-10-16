import { ShieldAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { useSession } from '../src/state/session';
import { colors, spacing } from '../src/theme/tokens';
import { Button, EmptyState, Screen } from '../src/ui/kit';

/** Signed in without `sales.orders.rep`: the app is for sales reps (ADR-0061 #5). */
export default function NotRepScreen() {
  const { t } = useTranslation();
  const { session, state } = useSession();
  const name = state.status === 'signedIn' ? state.me.fullName : '';
  return (
    <Screen bottom style={styles.body}>
      <EmptyState
        icon={<ShieldAlert size={48} color={colors.warning} />}
        title={t('mobile.notRep.title')}
        hint={t('mobile.notRep.hint', { name })}
      />
      <Button
        variant="secondary"
        title={t('mobile.profile.logout')}
        onPress={() => void session?.logout()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ body: { justifyContent: 'center', padding: spacing.lg } });
