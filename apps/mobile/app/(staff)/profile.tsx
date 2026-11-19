import { useRouter } from 'expo-router';
import {
  Bell,
  CalendarCheck,
  CalendarClock,
  ChevronRight,
  KeyRound,
  LogOut,
  Send,
  Server,
  UsersRound,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { feedCount, useFeed } from '../../src/api/community';
import { useNotificationSummary } from '../../src/api/notifications';
import { useRepContext } from '../../src/api/rep';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { MyPhoto } from '../../src/staff/my-photo';
import { KeptRow } from '../../src/offline/kept-row';
import { useOutbox } from '../../src/state/outbox';
import { useSignedIn } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { colors, fonts, spacing, tabular, type } from '../../src/theme/tokens';
import { CountBadge, PillButton } from '../../src/ui/controls';
import { Group, ICON_INSET, IconTile, Row } from '../../src/ui/grouped';
import { Page, SectionHeader } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';
import { Card, PAGE, Pill } from '../../src/ui/staff-kit';
import { StoreHeader } from '../../src/ui/store-header';
import { Text } from '../../src/ui/text';
import { UpdateCheck } from '../../src/updates/update-check';

/**
 * «Профайл» (the Profile board of 2026-11-16; ADR-0068, ADR-0062 #3; a page opened from the home's
 * header since ADR-0100): who is signed in (a tap opens their details), «Ирц», «Хугацаа
 * илрүүлэлт», «Хамт олон» and the notifications with the unread count; under «Тохиргоо» the order
 * settings with the chosen place, the password and the server; the app's version, and «Гарах» with
 * its question.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me, server } = useSignedIn();
  const { cart, stageId } = useShop();
  // Unsent orders stay in the outbox on the phone and go after the next sign-in (owner 2026-11-19).
  const unsent = useOutbox().unsent.length;
  const leavingWords = [
    unsent > 0 ? t('mobile.outbox.logoutHint', { n: unsent }) : null,
    cart.lines.length > 0 ? t('mobile.profile.logoutKeepsCart') : null,
  ].filter((part) => part !== null);
  const context = useRepContext();
  const unread = useNotificationSummary().data?.unread ?? 0;
  const community = feedCount(useFeed().data);
  const roleName = useRoleName();
  const [leaving, setLeaving] = useState(false);
  // «Бөөний борлуулалт › Батлагдсан»: the pipeline and the stage the next order lands in.
  const pipeline = context.data?.boards
    .flatMap((board) => board.pipelines)
    .find((entry) => entry.stages.some((stage) => stage.id === stageId));
  const stage = pipeline?.stages.find((entry) => entry.id === stageId);
  const place =
    pipeline && stage ? `${pipeline.name} › ${stage.name}` : t('mobile.profile.noStage');
  const phone = me.phone?.replace(/^\+976/, '');

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.profile')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Card
          accessibilityLabel={`${me.fullName}, ${t('mobile.profileInfo.title')}`}
          onPress={() => router.push('/profile-info')}
          style={styles.user}
        >
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
            <MyPhoto size={60} />
          </View>
          <View style={styles.grow}>
            <Text style={type.title3} numberOfLines={2}>
              {me.fullName}
            </Text>
            {phone ? <Text style={[type.secondary, tabular]}>{phone}</Text> : null}
            {roleName ? <Pill tone="info" label={roleName} /> : null}
          </View>
          <ChevronRight size={18} strokeWidth={2.4} color={colors.input} />
        </Card>

        <Group inset={ICON_INSET}>
          <Row
            icon={
              <IconTile color={colors.tint.green}>
                <CalendarCheck size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.attendance.title')}
            onPress={() => router.push('/attendance')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.red}>
                <CalendarClock size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.expiry.title')}
            onPress={() => router.push('/expiry')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.indigo}>
                <UsersRound size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.community.title')}
            accessibilityLabel={
              community > 0
                ? t('mobile.community.unreadLabel', { n: community })
                : t('mobile.community.title')
            }
            right={<CountBadge count={community} ring={colors.card} />}
            onPress={() => router.push('/community')}
          />
          <Row
            icon={
              <IconTile color={colors.tint.red}>
                <Bell size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.staffMenu.items.repNotifications')}
            accessibilityLabel={
              unread > 0
                ? t('mobile.notifications.bellUnread', { n: unread })
                : t('mobile.notifications.title')
            }
            right={<CountBadge count={unread} ring={colors.card} />}
            onPress={() => router.push('/notifications')}
          />
        </Group>

        <View style={styles.block}>
          <SectionHeader style={styles.label}>{t('mobile.profile.settings')}</SectionHeader>
          <Group inset={ICON_INSET}>
            <Row
              icon={
                <IconTile color={colors.tint.orange}>
                  <Send size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.settings.title')}
              subtitle={place}
              onPress={() => router.push('/settings')}
            />
            <Row
              icon={
                <IconTile color={colors.tint.gray}>
                  <KeyRound size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.password.title')}
              onPress={() => router.push('/password')}
            />
            <Row
              icon={
                <IconTile color={colors.tint.gray}>
                  <Server size={18} strokeWidth={2.2} color={colors.primaryForeground} />
                </IconTile>
              }
              title={t('mobile.profile.server')}
              value={server.replace(/^https?:\/\//, '')}
            />
          </Group>
        </View>

        {/* What the rep's order needs without the server (ADR-0225 #2). */}
        <KeptRow />

        {/* The app's version and «Шалгах» (ADR-0174 #10). */}
        <UpdateCheck />

        <PillButton
          variant="destructive"
          icon={<LogOut size={18} strokeWidth={2.2} color={colors.destructive} />}
          title={t('mobile.profile.logout')}
          onPress={() => setLeaving(true)}
        />
        <Text style={[type.caption, styles.center]}>{t('mobile.profile.company')}</Text>
      </ScrollView>
      <ActionSheet
        visible={leaving}
        title={t('mobile.profile.logoutTitle')}
        {...(leavingWords.length > 0 ? { message: leavingWords.join(' ') } : {})}
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
  body: { ...PAGE, paddingBottom: 40 },
  grow: { flex: 1, minWidth: 0, gap: spacing.xs },
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  center: { textAlign: 'center' },
  user: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.tint.blue,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { ...type.title2, fontFamily: fonts.semibold, color: colors.primaryForeground },
});
