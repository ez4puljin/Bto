import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Bell, ChevronRight, Send, Server, User } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNotificationSummary } from '../../src/api/notifications';
import { useRepContext } from '../../src/api/rep';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { useSignedIn } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { colors, fonts, radii, spacing, type } from '../../src/theme/tokens';
import { CountBadge } from '../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../src/ui/grouped';
import { Page } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';
import { StoreHeader } from '../../src/ui/store-header';
import { Text } from '../../src/ui/text';

/**
 * «Профайл» (the Profile board, ADR-0068; ADR-0062 #3; a page opened from the home's header since
 * ADR-0100, in «Bto300»'s profile layout): who is signed in (a tap opens their details), the
 * notifications with the unread count, the user's details and the order settings, the server,
 * «Гарах» with its question, and the app's version.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me, server } = useSignedIn();
  const { cart, pending, stageId } = useShop();
  const context = useRepContext();
  const unread = useNotificationSummary().data?.unread ?? 0;
  const roleName = useRoleName();
  const [leaving, setLeaving] = useState(false);
  const stageName =
    context.data?.boards
      .flatMap((board) => board.pipelines)
      .flatMap((pipeline) => pipeline.stages)
      .find((stage) => stage.id === stageId)?.name ?? t('mobile.profile.noStage');
  const build = Constants.expoConfig?.android?.versionCode;

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.profile')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/profile-info')}
          style={({ pressed }) => [styles.user, pressed && styles.pressed]}
        >
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
          <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
        </Pressable>

        <Group inset={ICON_INSET} style={styles.group}>
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
              <IconTile color={colors.tint.blue}>
                <User size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.profileInfo.title')}
            onPress={() => router.push('/profile-info')}
          />
          <Row
            minHeight={52}
            icon={
              <IconTile color={colors.tint.orange}>
                <Send size={16} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.settings.title')}
            value={stageName}
            onPress={() => router.push('/settings')}
          />
        </Group>

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
        {...(cart.lines.length > 0 || pending
          ? { message: t('mobile.profile.logoutKeepsCart') }
          : {})}
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
