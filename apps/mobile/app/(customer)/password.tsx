import { useRouter } from 'expo-router';
import { KeyRound, LockKeyhole } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { newPasswordIssue } from '../../src/customer/sign-in';
import { SignInProblem } from '../../src/customer/sign-in-rows';
import { useCustomer } from '../../src/state/session';
import { spacing } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { PasswordToggle, TextField } from '../../src/ui/field';
import { StoreHeader } from '../../src/customer/store-header';
import { FootNote, Page } from '../../src/ui/layout';
import type { TextInput } from '../../src/ui/text';
import { useToast } from '../../src/ui/toast';

type Which = 'current' | 'next' | 'again';

/**
 * «Нууц үг солих» of «Bto300» (ADR-0079 #3): the current password and the new one twice, each with
 * its eye. This phone stays signed in; the store's other phones are signed out.
 */
export default function CustomerPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { session } = useCustomer();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState<Record<Which, boolean>>({
    current: false,
    next: false,
    again: false,
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const nextRef = useRef<TextInput>(null);
  const againRef = useRef<TextInput>(null);
  const issue = newPasswordIssue(next, again);
  const ready = current !== '' && issue === null;
  // The length once a new password is typed; a mismatch once the second one is.
  const nextError =
    next === ''
      ? null
      : issue === 'short'
        ? t('mobile.customer.setPassword.issues.short')
        : issue === 'long'
          ? t('mobile.customer.setPassword.issues.long')
          : null;
  const againError = again !== '' && issue === 'mismatch' ? t('mobile.password.mismatch') : null;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await session.client.POST('/api/v1/auth/customer/password', {
        body: { currentPassword: current, newPassword: next },
      });
      if (result.response.status === 204) {
        toast.show({ message: t('mobile.password.changed') });
        router.back();
        return;
      }
      setProblem(problemOf(result.error, result.response.status));
    } catch {
      setProblem(NETWORK);
    } finally {
      setBusy(false);
    }
  };

  const typed = (set: (value: string) => void) => (value: string) => {
    set(value);
    setProblem(null);
  };

  const eye = (which: Which) => (
    <PasswordToggle
      shown={shown[which]}
      onToggle={() => setShown((value) => ({ ...value, [which]: !value[which] }))}
    />
  );

  return (
    <Page white edges={[]}>
      <StoreHeader title={t('mobile.password.title')} onBack={() => router.back()} right={null} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <TextField
            style={styles.first}
            label={t('mobile.password.current')}
            icon={LockKeyhole}
            value={current}
            onChangeText={typed(setCurrent)}
            secureTextEntry={!shown.current}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => nextRef.current?.focus()}
            readOnly={busy}
            trailing={eye('current')}
          />
          <TextField
            style={styles.field}
            inputRef={nextRef}
            label={t('mobile.password.next')}
            icon={KeyRound}
            placeholder={t('mobile.customer.setPassword.passwordPlaceholder')}
            value={next}
            onChangeText={typed(setNext)}
            secureTextEntry={!shown.next}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => againRef.current?.focus()}
            readOnly={busy}
            error={nextError}
            trailing={eye('next')}
          />
          <TextField
            style={styles.field}
            inputRef={againRef}
            label={t('mobile.password.again')}
            icon={KeyRound}
            value={again}
            onChangeText={typed(setAgain)}
            secureTextEntry={!shown.again}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            readOnly={busy}
            error={againError}
            trailing={eye('again')}
          />
          <FootNote>{t('mobile.customer.password.hint')}</FootNote>
          <SignInProblem problem={problem} style={styles.problem} />
          <PillButton
            style={styles.save}
            height={50}
            title={t('common.save')}
            loading={busy}
            disabled={!ready}
            onPress={() => void save()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingBottom: 40 },
  first: { marginTop: 22 },
  field: { marginTop: spacing.lg },
  problem: { marginTop: spacing.lg },
  save: { marginTop: spacing.xl },
});
