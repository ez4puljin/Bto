import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { LogOut, Settings2, UserRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession, useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { Button, Card, Screen, Title } from '../../../src/ui/kit';

/** «Профайл»: who is signed in, on which server, the order settings and logging out. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me, server } = useSignedIn();
  const { setServer } = useSession();
  const { cart, pending } = useShop();

  const logout = () => {
    Alert.alert(
      t('mobile.profile.logoutTitle'),
      cart.lines.length > 0 || pending ? t('mobile.profile.logoutKeepsCart') : undefined,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('mobile.profile.logout'),
          style: 'destructive',
          onPress: () => void session.logout(),
        },
      ],
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Title>{t('mobile.tabs.profile')}</Title>
        <Card style={styles.row}>
          <UserRound size={36} color={colors.primary} />
          <View style={styles.grow}>
            <Text style={type.heading}>{me.fullName}</Text>
            <Text style={type.secondary}>{me.username}</Text>
          </View>
        </Card>
        <Card>
          <Text style={type.caption}>{t('mobile.server.label')}</Text>
          <Text style={type.body}>{server}</Text>
          <Text style={type.caption}>{t('mobile.profile.version')}</Text>
          <Text style={type.body}>{Constants.expoConfig?.version ?? ''}</Text>
        </Card>
        <Button
          variant="secondary"
          title={t('mobile.settings.title')}
          icon={<Settings2 size={18} color={colors.secondaryForeground} />}
          onPress={() => router.push('/settings')}
        />
        <Button
          variant="danger"
          title={t('mobile.profile.logout')}
          icon={<LogOut size={18} color={colors.destructive} />}
          onPress={logout}
        />
        <Button
          variant="ghost"
          title={t('mobile.server.change')}
          onPress={() =>
            Alert.alert(t('mobile.server.changeTitle'), t('mobile.server.changeHint'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('mobile.server.change'),
                onPress: () => void session.logout().then(() => setServer(null)),
              },
            ])
          }
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1, gap: 2 },
});
