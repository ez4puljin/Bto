import { useRouter } from 'expo-router';
import { CalendarCheck, IdCard, KeyRound, LogOut, Server, UsersRound } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { feedCount, useFeed } from '../../src/api/community';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { MyPhoto } from '../../src/staff/my-photo';
import { useSignedIn } from '../../src/state/session';
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
 * «Профайл» of a store's seller (ADR-0116 #1) and of any staff member without the rep's context
 * (ADR-0131; the Me board of 2026-11-16): who is signed in and their role, «Ирц», «Хамт олон» and
 * «Миний мэдээлэл», then the password and the server, the app's version, and «Гарах» with its
 * question — none of the rep's stages or notices.
 */
export default function StoreProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, me, server } = useSignedIn();
  const community = feedCount(useFeed().data);
  const roleName = useRoleName();
  const [leaving, setLeaving] = useState(false);
  const phone = me.phone?.replace(/^\+976/, '');

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.tabs.profile')} onBack={() => router.back()} right={null} />
      <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.user}>
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
              <IconTile color={colors.tint.gray}>
                <IdCard size={18} strokeWidth={2.2} color={colors.primaryForeground} />
              </IconTile>
            }
            title={t('mobile.staffMenu.items.myDetails')}
            onPress={() => router.push('/community/profile')}
          />
        </Group>

        <View style={styles.block}>
          <SectionHeader style={styles.label}>{t('mobile.profile.settings')}</SectionHeader>
          <Group inset={ICON_INSET}>
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
