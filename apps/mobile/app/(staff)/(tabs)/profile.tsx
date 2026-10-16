import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Bell, ChevronRight, LogOut, Send, Server, User } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNotificationSummary } from '../../../src/api/notifications';
import { useRepContext } from '../../../src/api/rep';
import { initialsOf } from '../../../src/format/format';
import { useRoleName } from '../../../src/state/role';
import { useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { CircleButton } from '../../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../../src/ui/grouped';
import { LargeTitle, Page } from '../../../src/ui/layout';
import { ActionSheet } from '../../../src/ui/sheet';
import { useTabBarInset } from '../../../src/ui/tab-bar';

/**
 * «Профайл» (the Profile board, ADR-0066; ADR-0062 #3): the bell with the unread count, who is
 * signed in, the user's details and the order settings, the server, «Гарах» with its question, and
 * the app's version.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const inset = useTabBarInset();
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
    <Page>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: inset + spacing.lg }]}>
        <View style={styles.bar}>
          <CircleButton
            icon={<Bell size={22} strokeWidth={1.9} color={colors.foreground} />}
            label={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            badge={unread}
            badgeRing={colors.canvas}
            onPress={() => router.push('/notifications')}
            style={styles.bell}
          />
        </View>
        <LargeTitle style={styles.title}>{t('mobile.tabs.profile')}</LargeTitle>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/profile-info')}
          style={({ pressed }) => [styles.user, pressed && styles.pressed]}
        >
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={styles.name} numberOfLines={1}>
              {me.fullName}
            </Text>
            <Text style={styles.role} numberOfLines={1}>
              {roleName ? `${me.username} · ${roleName}` : me.username}
            </Text>
          </View>
          <ChevronRight size={16} strokeWidth={2.6} color={colors.input} />
        </Pressable>

        <Group inset={ICON_INSET} style={styles.group}>
          <Row
            icon={
              <IconTile color={colors.tint.blue}>
                <User size={17} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.profileInfo.title')}
            onPress={() => router.push('/profile-info')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.orange}>
                <Send size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.settings.title')}
            value={stageName}
            onPress={() => router.push('/settings')}
          />
        </Group>

        <Group style={styles.group}>
          <Row
            icon={
              <IconTile color={colors.tint.gray}>
                <Server size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.profile.server')}
            value={server.replace(/^https?:\/\//, '')}
          />
        </Group>

        <Group style={styles.group}>
          <Row
            icon={
              <IconTile color={colors.tint.red}>
                <LogOut size={16} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.profile.logout')}
            destructive
            chevron={false}
            onPress={() => setLeaving(true)}
          />
        </Group>

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
  body: { paddingHorizontal: spacing.lg },
  bar: { height: 44, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  bell: { backgroundColor: colors.card },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  user: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
  },
  pressed: { backgroundColor: colors.accent },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: fonts.semibold,
    fontSize: 22,
    lineHeight: 28,
    color: colors.primaryForeground,
  },
  grow: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.semibold, fontSize: 19, lineHeight: 24, color: colors.foreground },
  role: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted },
  group: { marginTop: 22 },
  footer: { marginTop: 20, alignItems: 'center', gap: 3 },
});
