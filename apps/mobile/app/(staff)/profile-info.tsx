import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { useRepContext } from '../../src/api/rep';
import { dayNameOf, monthDay } from '../../src/dates/calendar';
import { ubDate, ubTime } from '../../src/dates/dates';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { useSignedIn } from '../../src/state/session';
import { colors, fonts, spacing, type } from '../../src/theme/tokens';
import { Group, Row } from '../../src/ui/grouped';
import { FootNote, Page, SectionHeader } from '../../src/ui/layout';
import { StoreHeader } from '../../src/ui/store-header';

const HOUR_MS = 3_600_000;

/**
 * «Хэрэглэгчийн мэдээлэл» (the ProfileInfo board, ADR-0068): the name, the login, the role and the
 * branches; when the session signed in and when it ends; the server; «Нууц үг солих». Under the
 * blue header with ← since ADR-0100.
 */
export default function ProfileInfoScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me, server } = useSignedIn();
  const roleName = useRoleName();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const branches = context.data?.branchNames ?? [];

  const when = (iso: string) => {
    const date = ubDate(iso);
    const name = today ? dayNameOf(date, today) : 'date';
    const day = name === 'date' ? monthDay(date) : t(`mobile.days.${name}`);
    return t('mobile.profileInfo.at', { day, time: ubTime(iso) });
  };
  const hours = Math.round(
    (Date.parse(me.sessionExpiresAt) - Date.parse(me.sessionStartedAt)) / HOUR_MS,
  );

  return (
    <Page edges={[]}>
      <StoreHeader title={t('mobile.profileInfo.title')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.head}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <Text style={[type.title3, styles.center]}>{me.fullName}</Text>
          {roleName ? (
            <View style={styles.rolePill}>
              <Text style={styles.roleText}>{roleName}</Text>
            </View>
          ) : null}
        </View>

        <SectionHeader>{t('mobile.profileInfo.account')}</SectionHeader>
        <Group>
          <Row title={t('mobile.profileInfo.name')} value={me.fullName} minHeight={50} />
          <Row
            title={t('mobile.profileInfo.phone')}
            value={me.phone?.replace(/^\+976/, '') || t('common.none')}
            minHeight={50}
          />
          <Row
            title={t('mobile.profileInfo.role')}
            value={roleName || t('common.none')}
            minHeight={50}
          />
          <Row
            title={t('mobile.profileInfo.branch')}
            value={branches.length > 0 ? branches.join(', ') : t('mobile.profileInfo.allBranches')}
            minHeight={50}
          />
        </Group>

        <SectionHeader>{t('mobile.profileInfo.session')}</SectionHeader>
        <Group>
          <Row
            title={t('mobile.profileInfo.signedIn')}
            value={when(me.sessionStartedAt)}
            minHeight={50}
          />
          <Row
            title={t('mobile.profileInfo.ends')}
            value={t('mobile.profileInfo.endsAt', { at: when(me.sessionExpiresAt), hours })}
            minHeight={50}
          />
          <Row
            title={t('mobile.profile.server')}
            value={server.replace(/^https?:\/\//, '')}
            minHeight={50}
          />
        </Group>

        <Group style={styles.password}>
          <Row
            title={t('mobile.password.title')}
            accent
            minHeight={50}
            onPress={() => router.push('/password')}
          />
        </Group>
        <FootNote>{t('mobile.profileInfo.adminEdits')}</FootNote>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  head: { alignItems: 'center', gap: spacing.sm, paddingTop: 20 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.title, fontFamily: fonts.bold, color: colors.primaryForeground },
  center: { textAlign: 'center', marginTop: spacing.xs },
  rolePill: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    backgroundColor: colors.secondary,
    justifyContent: 'center',
  },
  roleText: { ...type.chip, fontFamily: fonts.semibold, color: colors.link },
  password: { marginTop: spacing.xl },
});
