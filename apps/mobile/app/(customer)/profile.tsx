import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Bell, LockKeyhole, Phone } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useStoreMe } from '../../src/api/customer';
import { useStoreNotificationSummary } from '../../src/api/customer-notifications';
import { phoneShown } from '../../src/customer/home';
import { initialsOf } from '../../src/format/format';
import { useCustomer } from '../../src/state/session';
import { colors, fonts, radii, spacing, type } from '../../src/theme/tokens';
import { CountBadge } from '../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../src/ui/grouped';
import { FootNote, LargeTitle, NavBar, Page, SectionHeader } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';
import { Text } from '../../src/ui/text';

/**
 * «Профайл» of «Bto300» (the Profile board, ADR-0079 #13): the store, its code and centre, the
 * sign-in phone, the default address and the payment term (the office changes them), the password,
 * the notifications, where the contacts are, and «Гарах» with its question (the cart stays).
 */
export default function CustomerProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me } = useCustomer();
  const store = useStoreMe().data ?? me.store;
  const unread = useStoreNotificationSummary().data?.unread ?? 0;
  const [leaving, setLeaving] = useState(false);
  const address = store.defaultAddress?.address ?? store.defaultAddress?.label ?? null;
  const codeLine = [
    t('mobile.customer.profile.codeLine', { code: store.code }),
    store.centre?.branchName ?? null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <Page>
      <NavBar back={t('mobile.tabs.home')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <LargeTitle style={styles.title}>{t('mobile.tabs.profile')}</LargeTitle>

        <View style={styles.store}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(store.name)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={2}>
              {store.name}
            </Text>
            <Text style={[type.body, styles.muted]} numberOfLines={2}>
              {codeLine}
            </Text>
          </View>
        </View>

        <SectionHeader>{t('mobile.customer.profile.store')}</SectionHeader>
        <Group>
          <Row title={t('mobile.customer.profile.phone')} value={phoneShown(store.phone)} />
          <Row title={t('mobile.customer.profile.address')} value={address ?? t('common.none')} />
          <Row
            title={t('mobile.customer.profile.term')}
            value={
              store.paymentTermDays !== null
                ? t('mobile.customer.profile.termDays', { n: store.paymentTermDays })
                : t('common.none')
            }
          />
        </Group>
        <FootNote>{t('mobile.customer.profile.changeNote')}</FootNote>

        <SectionHeader>{t('mobile.customer.profile.settings')}</SectionHeader>
        <Group inset={ICON_INSET}>
          <Row
            minHeight={52}
            icon={
              <IconTile color={colors.tint.gray}>
                <LockKeyhole size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.password.title')}
            onPress={() => router.push('/password')}
          />
          <Row
            minHeight={52}
            icon={
              <IconTile color={colors.tint.red}>
                <Bell size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.notifications.title')}
            accessibilityLabel={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            right={<CountBadge count={unread} ring={colors.card} />}
            onPress={() => router.push('/notifications')}
          />
          <Row
            minHeight={52}
            icon={
              <IconTile color={colors.tint.green}>
                <Phone size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.customer.contacts.title')}
            value={t('mobile.customer.profile.contactsOnHome')}
            onPress={() => router.navigate('/')}
          />
        </Group>

        <Pressable
          accessibilityRole="button"
          onPress={() => setLeaving(true)}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
        >
          <Text style={[type.button, styles.logoutText]}>{t('mobile.profile.logout')}</Text>
        </Pressable>

        <Text style={[type.secondary, styles.version]}>
          {t('mobile.customer.versionLine', {
            version: Constants.expoConfig?.version ?? '',
            build: Constants.expoConfig?.android?.versionCode ?? '',
          })}
        </Text>
      </ScrollView>
      <ActionSheet
        visible={leaving}
        title={t('mobile.customer.profile.logoutTitle')}
        message={t('mobile.customer.profile.logoutMessage')}
        actions={[
          {
            label: t('mobile.profile.logout'),
            destructive: true,
            onPress: () => {
              setLeaving(false);
              void session.logout();
            },
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setLeaving(false)}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  grow: { flex: 1, gap: 2 },
  muted: { color: colors.muted },
  pressed: { backgroundColor: colors.accent },
  store: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.tint.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.title2, fontFamily: fonts.bold, color: colors.primaryForeground },
  name: type.title3,
  logout: {
    marginTop: 22,
    minHeight: 52,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: { color: colors.destructive },
  version: { marginTop: spacing.lg, textAlign: 'center' },
});
