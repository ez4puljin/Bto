import { useRouter } from 'expo-router';
import { Camera, KeyRound } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { useSetMyPhoto } from '../../src/api/community';
import { useRepContext } from '../../src/api/rep';
import { dayNameOf, monthDay } from '../../src/dates/calendar';
import { ubDate, ubTime } from '../../src/dates/dates';
import { initialsOf } from '../../src/format/format';
import { useRoleName } from '../../src/state/role';
import { MyPhoto } from '../../src/staff/my-photo';
import { type PhotoSource, pickSquarePhoto } from '../../src/staff/pick-photo';
import { useSignedIn } from '../../src/state/session';
import { colors, fonts, spacing, tabular, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { Group } from '../../src/ui/grouped';
import { Page, SectionHeader } from '../../src/ui/layout';
import { ActionSheet } from '../../src/ui/sheet';
import { PAGE } from '../../src/ui/staff-kit';
import { StoreHeader } from '../../src/ui/store-header';
import { useToast } from '../../src/ui/toast';

const HOUR_MS = 3_600_000;
/** The question sheet slides away before the camera or the pictures open over it. */
const SHEET_CLOSE_MS = 280;

/**
 * «Хэрэглэгчийн мэдээлэл» (the ProfileInfo board of 2026-11-16; ADR-0068): the person's photo (or
 * initials), name and role on the blue header; the name, the login, the role and the branches;
 * when the session signed in and when it ends; the server; «Зураг солих» (a tap on the photo too,
 * ADR-0209) and «Нууц үг солих».
 */
export default function ProfileInfoScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { me, server } = useSignedIn();
  const roleName = useRoleName();
  const context = useRepContext();
  const today = context.data?.today ?? null;
  const branches = context.data?.branchNames ?? [];
  const toast = useToast();
  const setPhoto = useSetMyPhoto();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const changePhoto = async (source: PhotoSource) => {
    setChoosing(false);
    setBusy(true);
    try {
      await new Promise((done) => setTimeout(done, SHEET_CLOSE_MS));
      const picked = await pickSquarePhoto(source);
      if (picked === 'denied') {
        toast.show({ message: t('mobile.profileInfo.photo.cameraDenied') });
      } else if (picked !== 'cancelled') {
        await setPhoto.mutateAsync(picked.uri);
        toast.show({ message: t('mobile.profileInfo.photo.saved') });
      }
    } catch {
      toast.show({ message: t('mobile.profileInfo.photo.failed') });
    } finally {
      setBusy(false);
    }
  };

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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.profileInfo.photo.change')}
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={() => setChoosing(true)}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View style={styles.avatar}>
              <Text style={styles.initials}>{initialsOf(me.fullName)}</Text>
              <MyPhoto size={72} />
              {busy ? (
                <View style={[StyleSheet.absoluteFill, styles.busy]}>
                  <ActivityIndicator color={colors.primaryForeground} />
                </View>
              ) : null}
            </View>
            <View style={styles.badge}>
              <Camera size={14} strokeWidth={2.4} color={colors.primary} />
            </View>
          </Pressable>
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
          icon={<Camera size={18} strokeWidth={2.2} color={colors.secondaryForeground} />}
          title={t('mobile.profileInfo.photo.change')}
          disabled={busy}
          onPress={() => setChoosing(true)}
        />
        <PillButton
          variant="soft"
          icon={<KeyRound size={18} strokeWidth={2.2} color={colors.secondaryForeground} />}
          title={t('mobile.password.title')}
          onPress={() => router.push('/password')}
        />
        <Text style={[type.secondary, styles.note]}>{t('mobile.profileInfo.adminEdits')}</Text>
      </ScrollView>
      <ActionSheet
        visible={choosing}
        title={t('mobile.profileInfo.photo.title')}
        message={t('mobile.profileInfo.photo.hint')}
        actions={[
          {
            label: t('mobile.profileInfo.photo.camera'),
            onPress: () => void changePhoto('camera'),
          },
          {
            label: t('mobile.profileInfo.photo.library'),
            onPress: () => void changePhoto('library'),
          },
        ]}
        cancelLabel={t('common.cancel')}
        onCancel={() => setChoosing(false)}
      />
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
    overflow: 'hidden',
  },
  initials: { ...type.title, fontFamily: fonts.semibold, color: colors.primaryForeground },
  pressed: { opacity: 0.7 },
  busy: { backgroundColor: colors.backdrop, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
