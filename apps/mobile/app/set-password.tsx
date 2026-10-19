import { useRouter } from 'expo-router';
import { Info } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { AppProblem } from '../src/api/problem';
import {
  codeComplete,
  codeInput,
  newPasswordIssue,
  phoneInput,
  phoneOf,
} from '../src/customer/sign-in';
import { FieldRow, SignInProblem } from '../src/customer/sign-in-rows';
import { useSession } from '../src/state/session';
import { colors, radii, spacing, type } from '../src/theme/tokens';
import { PillButton } from '../src/ui/controls';
import { PasswordToggle } from '../src/ui/field';
import { Group } from '../src/ui/grouped';
import { FootNote, LargeTitle, NavBar, Page, SectionHeader } from '../src/ui/layout';
import { Text, type TextInput } from '../src/ui/text';

/** The rows' label column: «Давтах», «Нууц үг» and «Утас» line up. */
const LABEL_WIDTH = 92;

/**
 * «Нууц үг тавих» (the SetPassword board, ADR-0079 #3): the store calls the office and says «Аппын
 * код»; with its phone, that one-time code and a new password typed twice it signs in. Other phones
 * signed in to the store are signed out; the root layout opens the app by itself.
 */
export default function SetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useSession();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const codeRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const againRef = useRef<TextInput>(null);
  const signInPhone = phoneOf(phone);
  const issue = newPasswordIssue(password, again);
  const ready = signInPhone !== null && codeComplete(code) && issue === null;
  // A reason once there is something to judge: the length as soon as a password is typed, a
  // mismatch only once the second one is.
  const shownIssue =
    password === ''
      ? null
      : issue === 'mismatch'
        ? again === ''
          ? null
          : t('mobile.password.mismatch')
        : issue === 'short'
          ? t('mobile.customer.setPassword.issues.short')
          : issue === 'long'
            ? t('mobile.customer.setPassword.issues.long')
            : null;

  const submit = async () => {
    if (session?.kind !== 'customer' || signInPhone === null || !ready || busy) return;
    setBusy(true);
    setProblem(await session.setupPassword(signInPhone, code, password));
    setBusy(false);
  };

  const typed = (set: (value: string) => void) => (value: string) => {
    set(value);
    setProblem(null);
  };

  return (
    <Page edges={['top', 'bottom']}>
      <NavBar back={t('auth.login.title')} onBack={() => router.back()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <LargeTitle style={styles.title}>{t('mobile.customer.setPassword.title')}</LargeTitle>
          <Text style={[type.row, styles.lead]}>{t('mobile.customer.setPassword.lead')}</Text>
          <View style={styles.info}>
            <Info size={18} strokeWidth={2} color={colors.link} />
            <Text style={[type.body, styles.infoText]}>
              {t('mobile.customer.setPassword.info')}
            </Text>
          </View>

          <SectionHeader>{t('mobile.customer.setPassword.phoneAndCode')}</SectionHeader>
          <Group>
            <FieldRow
              labelWidth={LABEL_WIDTH}
              label={t('mobile.customer.signIn.phone')}
              prefix={t('mobile.customer.signIn.phonePrefix')}
              placeholder={t('mobile.customer.signIn.phonePlaceholder')}
              value={phone}
              onChangeText={(value) => typed(setPhone)(phoneInput(value))}
              keyboardType="number-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoCorrect={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => codeRef.current?.focus()}
              readOnly={busy}
            />
            <FieldRow
              inputRef={codeRef}
              labelWidth={LABEL_WIDTH}
              label={t('mobile.customer.setPassword.code')}
              placeholder={t('mobile.customer.setPassword.codePlaceholder')}
              value={code}
              onChangeText={(value) => typed(setCode)(codeInput(value))}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              readOnly={busy}
            />
          </Group>

          <SectionHeader>{t('mobile.customer.setPassword.newPassword')}</SectionHeader>
          <Group>
            <FieldRow
              inputRef={passwordRef}
              labelWidth={LABEL_WIDTH}
              label={t('mobile.customer.signIn.password')}
              placeholder={t('mobile.customer.setPassword.passwordPlaceholder')}
              value={password}
              onChangeText={typed(setPassword)}
              secureTextEntry={!shown}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => againRef.current?.focus()}
              readOnly={busy}
              trailing={<PasswordToggle shown={shown} onToggle={() => setShown((on) => !on)} />}
            />
            <FieldRow
              inputRef={againRef}
              labelWidth={LABEL_WIDTH}
              label={t('mobile.customer.setPassword.again')}
              placeholder={t('mobile.customer.setPassword.againPlaceholder')}
              value={again}
              onChangeText={typed(setAgain)}
              secureTextEntry={!shown}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              readOnly={busy}
            />
          </Group>
          {shownIssue ? (
            <Text accessibilityRole="alert" style={[type.secondary, styles.issue]}>
              {shownIssue}
            </Text>
          ) : null}
          <FootNote>{t('mobile.customer.setPassword.othersSignOut')}</FootNote>

          <SignInProblem problem={problem} style={styles.problem} />
          <PillButton
            style={styles.button}
            height={52}
            title={t('mobile.customer.setPassword.submit')}
            loading={busy}
            loadingTitle={t('mobile.customer.setPassword.busy')}
            disabled={!ready}
            onPress={() => void submit()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  lead: { marginTop: 6, marginHorizontal: spacing.xs, color: colors.label2 },
  info: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radii.field,
    backgroundColor: colors.infoSoft,
  },
  infoText: { flex: 1, color: colors.secondaryForeground },
  issue: { marginTop: spacing.sm, marginHorizontal: spacing.xs, color: colors.destructive },
  problem: { marginTop: spacing.lg },
  button: { marginTop: spacing.xl },
});
