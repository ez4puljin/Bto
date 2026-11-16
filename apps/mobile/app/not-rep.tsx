import { StatusBar } from 'expo-status-bar';
import { LogOut, ShieldAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { StaffWordmarkBand } from '../src/staff/brand';
import { useSession } from '../src/state/session';
import { colors, spacing, type } from '../src/theme/tokens';
import { PillButton } from '../src/ui/controls';
import { Page } from '../src/ui/layout';
import { Text } from '../src/ui/text';

/**
 * Signed in without `sales.orders.rep`: the app is for sales reps (ADR-0061 #5). Under the blue
 * header with the wordmark and white status bar icons (the NotRep board of 2026-11-16): the sign in
 * the middle, what it means, and «Гарах». There is no «Нүүр рүү буцах»: while this page shows, the
 * root layout keeps the staff screens out, so the button would have nowhere to go.
 */
export default function NotRepScreen() {
  const { t } = useTranslation();
  const { session, state } = useSession();
  const name = state.status === 'signedIn' && 'fullName' in state.me ? state.me.fullName : '';
  return (
    <Page edges={['bottom']}>
      <StatusBar style="light" />
      <StaffWordmarkBand />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.disc}>
          <ShieldAlert size={32} strokeWidth={2} color={colors.warning} />
        </View>
        <Text accessibilityRole="header" style={[type.title3, styles.center]}>
          {t('mobile.notRep.title')}
        </Text>
        <Text style={[type.body, styles.hint]}>{t('mobile.notRep.hint', { name })}</Text>
        <PillButton
          style={styles.button}
          variant="destructive"
          icon={<LogOut size={18} strokeWidth={2.2} color={colors.destructive} />}
          title={t('mobile.profile.logout')}
          onPress={() => void session?.logout()}
        />
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: spacing.xl,
  },
  disc: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.warningSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
  hint: { maxWidth: 280, color: colors.muted, textAlign: 'center' },
  button: { alignSelf: 'stretch', marginTop: spacing.sm },
});
