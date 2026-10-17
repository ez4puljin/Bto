import { useRouter } from 'expo-router';
import { KeyRound, LockKeyhole } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { Text, type TextInput } from '../../src/ui/text';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { useSignedIn } from '../../src/state/session';
import { spacing, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { PasswordToggle, TextField } from '../../src/ui/field';
import { ProblemText } from '../../src/ui/kit';
import { FootNote, NavBar, Page } from '../../src/ui/layout';
import { useToast } from '../../src/ui/toast';

type Which = 'current' | 'next' | 'again';

/**
 * «Нууц үг солих» (ADR-0068): the current password and the new one twice, each with its eye. The
 * server checks the rules (the phone has no `normalize()` for the shared check); this session
 * stays, the others end.
 */
export default function PasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { session } = useSignedIn();
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
  const mismatch = again.length > 0 && next !== again;
  const ready = current !== '' && next !== '' && next === again;

  const save = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await session.client.POST('/api/v1/auth/password', {
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
    <Page white>
      <NavBar back={t('mobile.profileInfo.title')} onBack={() => router.back()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[type.title2, styles.title]}>
            {t('mobile.password.title')}
          </Text>
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
            error={mismatch ? t('mobile.password.mismatch') : null}
            trailing={eye('again')}
          />
          <FootNote>{t('mobile.password.hint')}</FootNote>
          <ProblemText problem={problem} style={styles.problem} />
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
  title: { marginTop: 2, marginHorizontal: spacing.xs },
  first: { marginTop: 22 },
  field: { marginTop: spacing.lg },
  problem: { marginTop: spacing.lg },
  save: { marginTop: spacing.xl },
});
