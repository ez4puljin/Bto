import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { useRepContext } from '../../src/api/rep';
import { dayNameOf, monthDay } from '../../src/dates/calendar';
import { ubDate, ubTime } from '../../src/dates/dates';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { useSignedIn } from '../../src/state/session';
import { colors, fonts, spacing, tabular, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { Group } from '../../src/ui/grouped';
import { Page, SectionHeader } from '../../src/ui/layout';
import { PAGE } from '../../src/ui/staff-kit';
import { StoreHeader } from '../../src/ui/store-header';

const HOUR_MS = 3_600_000;

/**
 * «Хэрэглэгчийн мэдээлэл» (the ProfileInfo board of 2026-11-16; ADR-0068): the person's initials,
 * name and role on the blue header; the name, the login, the role and the branches; when the
 * session signed in and when it ends; the server; «Нууц үг солих».
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
      <StoreHeader title={t('mobile.profileInfo.title')} onBack={() => router.back()}>
        <View style={styles.head}>
          <View style={styles.avatar}>
            <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
          </View>
          <Text style={[type.title3, styles.name]} numberOfLines={2}>
            {me.fullName}
          </Text>
          {roleName ? (
            <View style={styles.rolePill}>
              <Text style={styles.roleText} numberOfLines={1}>
                {roleName}
              </Text>
            </View>
          ) : null}
        </View>
      </StoreHeader>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.block}>
          <SectionHeader style={styles.label}>{t('mobile.profileInfo.account')}</SectionHeader>
          <Group>
            <InfoRow label={t('mobile.profileInfo.name')} value={me.fullName} />
            <InfoRow
              label={t('mobile.profileInfo.phone')}
              value={me.phone?.replace(/^\+976/, '') || t('common.none')}
            />
            <InfoRow label={t('mobile.profileInfo.role')} value={roleName || t('common.none')} />
            <InfoRow
              label={t('mobile.profileInfo.branch')}
              value={
                branches.length > 0 ? branches.join(', ') : t('mobile.profileInfo.allBranches')
              }
            />
          </Group>
        </View>

        <View style={styles.block}>
          <SectionHeader style={styles.label}>{t('mobile.profileInfo.session')}</SectionHeader>
          <Group>
            <InfoRow label={t('mobile.profileInfo.signedIn')} value={when(me.sessionStartedAt)} />
            <InfoRow
              label={t('mobile.profileInfo.ends')}
              value={t('mobile.profileInfo.endsAt', { at: when(me.sessionExpiresAt), hours })}
            />
            <InfoRow
              label={t('mobile.profile.server')}
              value={server.replace(/^https?:\/\//, '')}
            />
          </Group>
        </View>

        <PillButton
          variant="soft"
          icon={<KeyRound size={18} strokeWidth={2.2} color={colors.secondaryForeground} />}
          title={t('mobile.password.title')}
          onPress={() => router.push('/password')}
        />
        <Text style={[type.secondary, styles.note]}>{t('mobile.profileInfo.adminEdits')}</Text>
      </ScrollView>
    </Page>
  );
}

/** A row of the details: the grey label, then its value at the right. */
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.row}>
      <Text style={[type.row, styles.rowLabel]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.row, tabular, styles.rowValue]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { ...PAGE, paddingBottom: 40 },
  block: { gap: spacing.sm },
  label: { marginTop: 0, marginBottom: 0 },
  head: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: 6,
    paddingBottom: 20,
    paddingHorizontal: spacing.lg,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: colors.dotOnImageIdle,
    backgroundColor: colors.onPrimaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { ...type.title, fontFamily: fonts.semibold, color: colors.primaryForeground },
  name: { color: colors.primaryForeground, textAlign: 'center' },
  rolePill: {
    height: 24,
    maxWidth: '100%',
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.onPrimaryHairline,
    justifyContent: 'center',
  },
  roleText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.primaryForeground },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  rowLabel: { width: 96, color: colors.muted },
  rowValue: { flex: 1, textAlign: 'right' },
  note: { marginHorizontal: spacing.xs },
});
