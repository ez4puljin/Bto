import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { useSignedIn } from '../../src/state/session';
import { colors, spacing, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { Group } from '../../src/ui/grouped';
import { ProblemText } from '../../src/ui/kit';
import { FootNote, NavBar, Page } from '../../src/ui/layout';
import { useToast } from '../../src/ui/toast';

/**
 * «Нууц үг солих» (ADR-0066): the current password and the new one twice. The server checks the
 * rules (the phone has no `normalize()` for the shared check); this session stays, the others end.
 */
export default function PasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { session } = useSignedIn();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const mismatch = again.length > 0 && next !== again;

  const save = async () => {
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

  const field = (label: string, value: string, onChange: (value: string) => void, last = false) => (
    <View style={styles.field}>
      <Text style={[type.row, styles.label]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        returnKeyType={last ? 'done' : 'next'}
        accessibilityLabel={label}
        style={[type.row, styles.input]}
      />
    </View>
  );

  return (
    <Page>
      <NavBar back={t('mobile.profileInfo.title')} onBack={() => router.back()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[type.title2, styles.title]}>
            {t('mobile.password.title')}
          </Text>
          <Group style={styles.group}>
            {field(t('mobile.password.current'), current, setCurrent)}
            {field(t('mobile.password.next'), next, setNext)}
            {field(t('mobile.password.again'), again, setAgain, true)}
          </Group>
          {mismatch ? (
            <Text style={[type.secondary, styles.error]}>{t('mobile.password.mismatch')}</Text>
          ) : null}
          <FootNote>{t('mobile.password.hint')}</FootNote>
          <ProblemText problem={problem} />
          <PillButton
            title={t('common.save')}
            loading={busy}
            disabled={current === '' || next === '' || next !== again}
            onPress={() => void save()}
            style={styles.save}
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
  group: { marginTop: 22 },
  field: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  label: { width: 120 },
  input: { flex: 1, height: 44, paddingVertical: 0 },
  error: { marginTop: spacing.sm, marginHorizontal: spacing.xs, color: colors.destructive },
  save: { marginTop: spacing.xl },
});
