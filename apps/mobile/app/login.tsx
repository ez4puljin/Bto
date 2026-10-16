import { LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppProblem } from '../src/api/problem';
import { useSession } from '../src/state/session';
import { colors, spacing, type } from '../src/theme/tokens';
import { PillButton } from '../src/ui/controls';
import { Group, InputRow } from '../src/ui/grouped';
import { ProblemText } from '../src/ui/kit';
import { BarButton, LargeTitle, Page } from '../src/ui/layout';

/** Signs in with the staff account (ADR-0061 #4); the session stays until its shift ends. */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { session, state, server, setServer } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const reason = state.status === 'anonymous' ? state.reason : undefined;

  const submit = async () => {
    if (!session || !username.trim() || !password) return;
    setBusy(true);
    setProblem(await session.login(username.trim(), password));
    setBusy(false);
  };

  return (
    <Page edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.icon}>
              <LogIn size={30} strokeWidth={2} color={colors.primaryForeground} />
            </View>
            <LargeTitle>{t('auth.login.title')}</LargeTitle>
            <Text style={[type.body, styles.muted]}>{t('auth.login.welcome')}</Text>
          </View>
          {reason === 'expired' ? (
            <Text style={[type.body, styles.notice]}>{t('auth.login.expired')}</Text>
          ) : null}
          <Group>
            <InputRow
              label={t('auth.login.username')}
              labelWidth={120}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
            />
            <InputRow
              label={t('auth.login.password')}
              labelWidth={120}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          </Group>
          <ProblemText problem={problem} />
          <PillButton
            title={t('auth.login.submit')}
            onPress={() => void submit()}
            loading={busy}
            disabled={!username.trim() || !password}
          />
          <View style={styles.footer}>
            <Text style={type.secondary}>{server?.replace(/^https?:\/\//, '') ?? ''}</Text>
            <BarButton title={t('mobile.server.change')} onPress={() => void setServer(null)} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { flexGrow: 1, padding: spacing.lg, gap: 20, justifyContent: 'center' },
  header: { alignItems: 'center', gap: spacing.sm },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  muted: { color: colors.muted, textAlign: 'center' },
  notice: { color: colors.warning, textAlign: 'center' },
  footer: { alignItems: 'center' },
});
