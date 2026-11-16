import {
  EDUCATION_LEVELS,
  EMPLOYEE_GENDERS,
  ENGAGEMENT_LIMITS,
  MARITAL_STATUSES,
} from '@tugeel/shared/hr';
import { isIsoDate } from '@tugeel/shared/time';
import { useRouter } from 'expo-router';
import { CalendarDays, Info, Plus, Trash2 } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { type Profile, useMyProfile, useSaveProfile, useToday } from '../../../src/api/community';
import { type AppProblem, problemFrom } from '../../../src/api/problem';
import { FirstLoad } from '../../../src/community/parts';
import { maskDate } from '../../../src/dates/mask';
import { colors, spacing, type } from '../../../src/theme/tokens';
import { ChoiceChip, PillButton, Segmented } from '../../../src/ui/controls';
import { TextField } from '../../../src/ui/field';
import { ProblemText } from '../../../src/ui/kit';
import { Page, SectionHeader } from '../../../src/ui/layout';
import { Card, FooterBar, Notice, PAGE } from '../../../src/ui/staff-kit';
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
      <StoreHeader title={t('mobile.community.profile.title')} onBack={() => router.back()} />
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
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <Notice icon={Info} tone="info">
          {t('mobile.community.profile.lead')}
        </Notice>
        <Card style={styles.card}>
          <TextField
            label={t('mobile.community.profile.birthDate')}
            icon={CalendarDays}
            placeholder={t('mobile.community.profile.datePlaceholder')}
            value={birthDate}
            onChangeText={(text) => setBirthDate(maskDate(text))}
            keyboardType="number-pad"
            maxLength={10}
            error={checked && birthBad ? t('mobile.community.profile.badDate') : null}
          />
          <View style={styles.field}>
            <Text style={type.label}>{t('mobile.community.profile.gender')}</Text>
            <Segmented
              label={t('mobile.community.profile.gender')}
              options={genders}
              value={gender}
              onChange={(value) => setGender(value === gender ? null : value)}
            />
          </View>
          <View style={styles.field}>
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
          </View>
          <View style={styles.field}>
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
          </View>
          <TextField
            label={t('mobile.community.profile.district')}
            value={district}
            onChangeText={setDistrict}
            maxLength={ENGAGEMENT_LIMITS.maxDistrict}
          />
        </Card>

        <SectionHeader style={styles.section}>
          {t('mobile.community.profile.children')}
        </SectionHeader>
        {children.map((child, index) => (
          <Card key={child.uid} style={styles.child}>
            <View style={styles.childHead}>
              <Text style={[type.rowStrong, styles.grow]} numberOfLines={1}>
                {t('mobile.community.profile.childN', { n: index + 1 })}
              </Text>
              <PillButton
                variant="destructive"
                height={36}
                style={styles.remove}
                title={t('mobile.community.profile.removeChild')}
                icon={<Trash2 size={16} strokeWidth={2.2} color={colors.destructive} />}
                onPress={() =>
                  setChildren((current) => current.filter((entry) => entry.uid !== child.uid))
                }
              />
            </View>
            <TextField
              label={t('mobile.community.profile.childName')}
              value={child.name}
              onChangeText={(name) => change(child.uid, { name })}
              maxLength={ENGAGEMENT_LIMITS.maxCategory}
            />
            <View style={styles.field}>
              <Text style={type.label}>{t('mobile.community.profile.gender')}</Text>
              <Segmented
                label={t('mobile.community.profile.gender')}
                options={genders}
                value={child.gender}
                onChange={(value) =>
                  change(child.uid, { gender: value === child.gender ? null : value })
                }
              />
            </View>
            <TextField
              label={t('mobile.community.profile.childBirthDate')}
              icon={CalendarDays}
              placeholder={t('mobile.community.profile.datePlaceholder')}
              value={child.birthDate}
              onChangeText={(text) => change(child.uid, { birthDate: maskDate(text) })}
              keyboardType="number-pad"
              maxLength={10}
              error={checked && childBad(child) ? t('mobile.community.profile.badDate') : null}
            />
          </Card>
        ))}
        {children.length < ENGAGEMENT_LIMITS.maxChildren ? (
          <PillButton
            variant="soft"
            title={t('mobile.community.profile.addChild')}
            icon={<Plus size={18} strokeWidth={2.4} color={colors.link} />}
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
      <FooterBar>
        <PillButton
          style={styles.flex}
          title={t('mobile.community.profile.save')}
          loading={save.isPending}
          onPress={submit}
        />
      </FooterBar>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flex: 1, minWidth: 0 },
  body: { padding: PAGE.padding, gap: PAGE.gap },
  card: { gap: spacing.lg },
  field: { gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  /** A label sits 16 px under the block above it and 8 px over its own card. */
  section: { marginTop: 0, marginBottom: -spacing.sm },
  child: { gap: spacing.md },
  childHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  remove: { paddingHorizontal: spacing.lg },
  problem: { marginTop: 0 },
});
