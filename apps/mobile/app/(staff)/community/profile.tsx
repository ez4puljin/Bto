import {
  EDUCATION_LEVELS,
  EMPLOYEE_GENDERS,
  ENGAGEMENT_LIMITS,
  MARITAL_STATUSES,
} from '@tugeel/shared/hr';
import { isIsoDate } from '@tugeel/shared/time';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Profile, useMyProfile, useSaveProfile, useToday } from '../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { FirstLoad } from '../../../src/community/parts';
import { colors, fonts, radii, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, Segmented } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { ProblemText } from '../../../src/ui/kit';
import { Page } from '../../../src/ui/layout';
import { StoreHeader } from '../../../src/ui/store-header';
import { Text } from '../../../src/ui/text';
import { useToast } from '../../../src/ui/toast';

type Gender = NonNullable<Profile['gender']>;

interface ChildDraft {
  uid: number;
  name: string;
  gender: Gender | null;
  birthDate: string;
}

/** `19900521` as `1990-05-21` while typing: a phone's number pad has no dash. */
function maskDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)].filter(Boolean).join('-');
}

/**
 * «Миний мэдээлэл» (ADR-0146): the person's own birth date, gender, education, marital status,
 * district and children, saved whole. HR sees them; the calendar shows only the birthday's day.
 */
export default function MyProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useMyProfile();
  return (
    <Page edges={[]}>
      <StoreHeader
        title={t('mobile.community.profile.title')}
        onBack={() => router.back()}
        right={null}
      />
      {profile.data ? (
        <ProfileForm initial={profile.data} />
      ) : (
        <FirstLoad query={profile}>{null}</FirstLoad>
      )}
    </Page>
  );
}

function ProfileForm({ initial }: { initial: Profile }) {
  const { t } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const save = useSaveProfile();
  const nextUid = useRef(initial.children.length);
  const [birthDate, setBirthDate] = useState(initial.birthDate ?? '');
  const [gender, setGender] = useState(initial.gender);
  const [education, setEducation] = useState(initial.education);
  const [marital, setMarital] = useState(initial.maritalStatus);
  const [district, setDistrict] = useState(initial.district ?? '');
  const [children, setChildren] = useState<ChildDraft[]>(() =>
    initial.children.map((child, uid) => ({
      uid,
      name: child.name ?? '',
      gender: child.gender ?? null,
      birthDate: child.birthDate,
    })),
  );
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const genders = EMPLOYEE_GENDERS.map((value) => ({
    value,
    label: t(`mobile.community.profile.genders.${value}`),
  }));
  const dateOk = (value: string) => isIsoDate(value) && value <= today;
  const birthBad = birthDate !== '' && !dateOk(birthDate);
  const childBad = (child: ChildDraft) => !dateOk(child.birthDate);
  const change = (uid: number, patch: Partial<ChildDraft>) =>
    setChildren((current) =>
      current.map((child) => (child.uid === uid ? { ...child, ...patch } : child)),
    );

  const submit = () => {
    setChecked(true);
    setProblem(null);
    if (birthBad || children.some(childBad)) return;
    save.mutate(
      {
        birthDate: birthDate === '' ? null : birthDate,
        gender,
        education,
        maritalStatus: marital,
        district: district.trim() || null,
        children: children.map((child) => ({
          name: child.name.trim() || null,
          gender: child.gender,
          birthDate: child.birthDate,
        })),
      },
      {
        onSuccess: () => toast.show({ message: t('mobile.community.profile.saved') }),
        onError: (failure) => setProblem(problemFrom(failure)),
      },
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.flex}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={type.secondary}>{t('mobile.community.profile.lead')}</Text>
        <View style={styles.card}>
          <TextField
            label={t('mobile.community.profile.birthDate')}
            placeholder={t('mobile.community.profile.datePlaceholder')}
            value={birthDate}
            onChangeText={(text) => setBirthDate(maskDate(text))}
            keyboardType="number-pad"
            maxLength={10}
            error={checked && birthBad ? t('mobile.community.profile.badDate') : null}
          />
          <Text style={type.label}>{t('mobile.community.profile.gender')}</Text>
          <Segmented
            label={t('mobile.community.profile.gender')}
            options={genders}
            value={gender}
            onChange={(value) => setGender(value === gender ? null : value)}
          />
          <Text style={type.label}>{t('mobile.community.profile.education')}</Text>
          <View style={styles.chips}>
            {EDUCATION_LEVELS.map((value) => (
              <ChoiceChip
                key={value}
                label={t(`mobile.community.profile.educations.${value}`)}
                selected={education === value}
                onWhite
                onPress={() => setEducation(value === education ? null : value)}
              />
            ))}
          </View>
          <Text style={type.label}>{t('mobile.community.profile.marital')}</Text>
          <View style={styles.chips}>
            {MARITAL_STATUSES.map((value) => (
              <ChoiceChip
                key={value}
                label={t(`mobile.community.profile.maritals.${value}`)}
                selected={marital === value}
                onWhite
                onPress={() => setMarital(value === marital ? null : value)}
              />
            ))}
          </View>
          <TextField
            label={t('mobile.community.profile.district')}
            value={district}
            onChangeText={setDistrict}
            maxLength={ENGAGEMENT_LIMITS.maxDistrict}
          />
        </View>

        <Text style={[type.sectionHeader, styles.head]}>
          {t('mobile.community.profile.children')}
        </Text>
        {children.map((child) => (
          <View key={child.uid} style={styles.card}>
            <TextField
              label={t('mobile.community.profile.childName')}
              value={child.name}
              onChangeText={(name) => change(child.uid, { name })}
              maxLength={ENGAGEMENT_LIMITS.maxCategory}
            />
            <Segmented
              label={t('mobile.community.profile.gender')}
              options={genders}
              value={child.gender}
              onChange={(value) =>
                change(child.uid, { gender: value === child.gender ? null : value })
              }
            />
            <TextField
              label={t('mobile.community.profile.childBirthDate')}
              placeholder={t('mobile.community.profile.datePlaceholder')}
              value={child.birthDate}
              onChangeText={(text) => change(child.uid, { birthDate: maskDate(text) })}
              keyboardType="number-pad"
              maxLength={10}
              error={checked && childBad(child) ? t('mobile.community.profile.badDate') : null}
            />
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() =>
                setChildren((current) => current.filter((entry) => entry.uid !== child.uid))
              }
              style={styles.remove}
            >
              <Text style={styles.removeText}>{t('mobile.community.profile.removeChild')}</Text>
            </Pressable>
          </View>
        ))}
        {children.length < ENGAGEMENT_LIMITS.maxChildren ? (
          <PillButton
            variant="white"
            title={t('mobile.community.profile.addChild')}
            icon={<Plus size={18} strokeWidth={2.4} color={colors.primary} />}
            onPress={() => {
              nextUid.current += 1;
              setChildren((current) => [
                ...current,
                { uid: nextUid.current, name: '', gender: null, birthDate: '' },
              ]);
            }}
          />
        ) : null}
        <ProblemText problem={problem} style={styles.problem} />
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <PillButton
          title={t('mobile.community.profile.save')}
          loading={save.isPending}
          onPress={submit}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 14, paddingBottom: 24, gap: spacing.md },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  head: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  remove: { alignSelf: 'flex-end', minHeight: 28, justifyContent: 'center' },
  removeText: { ...type.body, color: colors.destructiveText, fontFamily: fonts.semibold },
  problem: { marginTop: 0 },
  bar: { paddingHorizontal: 14, paddingTop: spacing.sm, backgroundColor: colors.canvas },
});
