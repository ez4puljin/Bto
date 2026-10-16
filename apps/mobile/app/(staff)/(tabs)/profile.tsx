import { isSystemRole } from '@tugeel/shared/auth';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { Bell, ChevronRight, LogOut } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNotificationSummary } from '../../../src/api/notifications';
import { useRepContext } from '../../../src/api/rep';
import { initialsOf } from '../../../src/format/format';
import { useSession, useSignedIn } from '../../../src/state/session';
import { useShop } from '../../../src/state/shop';
import { colors, radii, spacing, type } from '../../../src/theme/tokens';
import { Button, Card, Screen, Title } from '../../../src/ui/kit';

/**
 * «Профайл» (ADR-0061, ADR-0062 #3): the bell with the unread count in the top right corner, who
 * is signed in, the order settings, the server, logging out and the app's version.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me, server } = useSignedIn();
  const { setServer } = useSession();
  const { cart, pending, stageId } = useShop();
  const context = useRepContext();
  const unread = useNotificationSummary().data?.unread ?? 0;
  const role = me.roles[0];
  const roleName = role
    ? isSystemRole(role.code)
      ? t(`roles.system.${role.code}`)
      : (role.name ?? '')
    : '';
  const stageName =
    context.data?.boards
      .flatMap((board) => board.pipelines)
      .flatMap((pipeline) => pipeline.stages)
      .find((stage) => stage.id === stageId)?.name ?? t('mobile.profile.noStage');

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
        <View style={styles.header}>
          <Title>{t('mobile.tabs.profile')}</Title>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            onPress={() => router.push('/notifications')}
            style={styles.bell}
          >
            <Bell size={24} color={colors.primary} />
            {unread > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
        <Card style={styles.user}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <View style={styles.grow}>
            <Text style={type.heading}>{me.fullName}</Text>
            <Text style={type.secondary}>
              {roleName ? `${me.username} · ${roleName}` : me.username}
            </Text>
          </View>
        </Card>
        <Card style={styles.rows}>
          <Row
            label={t('mobile.settings.title')}
            value={stageName}
            onPress={() => router.push('/settings')}
          />
          <View style={styles.separator} />
          <Row label={t('mobile.profile.server')} value={server} />
        </Card>
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
        <View style={styles.footer}>
          <Text style={type.caption}>
            {t('mobile.profile.versionLine', { version: Constants.expoConfig?.version ?? '' })}
          </Text>
          <Text style={type.caption}>{t('mobile.profile.company')}</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

function Row(props: { label: string; value: string; onPress?: () => void }): ReactNode {
  const content = (
    <>
      <Text style={[type.body, styles.grow]}>{props.label}</Text>
      <Text style={[type.secondary, styles.value]} numberOfLines={1}>
        {props.value}
      </Text>
      {props.onPress ? <ChevronRight size={18} color={colors.muted} /> : null}
    </>
  );
  return props.onPress ? (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={styles.row}>
      {content}
    </Pressable>
  ) : (
    <View style={styles.row}>{content}</View>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.destructive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...type.caption, fontSize: 11, lineHeight: 14, color: colors.primaryForeground },
  user: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.heading, color: colors.secondaryForeground },
  grow: { flex: 1, gap: 2 },
  rows: { paddingVertical: spacing.xs, gap: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  value: { maxWidth: '50%' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  footer: { alignItems: 'center', gap: 2, marginTop: spacing.md },
});
