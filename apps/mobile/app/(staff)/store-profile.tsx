import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Server } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { useSignedIn } from '../../src/state/session';
import { colors, fonts, radii, spacing, type } from '../../src/theme/tokens';
import { Group, ICON_INSET, IconTile, Row } from '../../src/ui/grouped';
import { Page } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';
import { StoreHeader } from '../../src/ui/store-header';
import { Text } from '../../src/ui/text';

/**
 * «Профайл» of a store's seller (ADR-0116 #1): who is signed in and their role, the server,
 * «Гарах» with its question, and the app's version — none of the rep's context (stages, notices).
 */
export default function StoreProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me, server } = useSignedIn();
  const roleName = useRoleName();
  const [leaving, setLeaving] = useState(false);
  const build = Constants.expoConfig?.android?.versionCode;

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.profile')} onBack={() => router.back()} right={null} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.user}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={2}>
              {me.fullName}
            </Text>
            <Text style={[type.body, styles.muted]} numberOfLines={2}>
              {roleName ? `${me.username} · ${roleName}` : me.username}
            </Text>
          </View>
        </View>

        <Group inset={ICON_INSET} style={styles.group}>
          <Row
            minHeight={52}
            icon={
              <IconTile color={colors.tint.gray}>
                <Server size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.profile.server')}
            value={server.replace(/^https?:\/\//, '')}
          />
        </Group>

        <Pressable
          accessibilityRole="button"
          onPress={() => setLeaving(true)}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
        >
          <Text style={[type.button, styles.logoutText]}>{t('mobile.profile.logout')}</Text>
        </Pressable>

        <View style={styles.footer}>
          <Text style={type.secondary}>
            {t('mobile.profile.versionLine', {
              version: Constants.expoConfig?.version ?? '',
              build: build ?? '',
            })}
          </Text>
          <Text style={type.caption}>{t('mobile.profile.company')}</Text>
        </View>
      </ScrollView>
      <ActionSheet
        visible={leaving}
        title={t('mobile.profile.logoutTitle')}
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
  grow: { flex: 1, gap: 2 },
  muted: { color: colors.muted },
  pressed: { backgroundColor: colors.accent },
  user: {
    marginTop: spacing.md,
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.title2, fontFamily: fonts.bold, color: colors.primaryForeground },
  name: type.title3,
  group: { marginTop: 22 },
  logout: {
    marginTop: 22,
    minHeight: 52,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: { color: colors.destructive },
  footer: { marginTop: spacing.lg, alignItems: 'center', gap: 3 },
});
