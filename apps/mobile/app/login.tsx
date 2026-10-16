import { LogIn } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import type { AppProblem } from '../src/api/problem';
import { useSession } from '../src/state/session';
import { colors, spacing, type } from '../src/theme/tokens';
import { Button, Card, ProblemText, Screen, TextField, Title } from '../src/ui/kit';

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
    <Screen bottom>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <View style={styles.header}>
          <LogIn size={40} color={colors.primary} />
          <Title>{t('auth.login.title')}</Title>
          <Text style={type.secondary}>{t('auth.login.welcome')}</Text>
        </View>
        {reason === 'expired' ? (
          <Text style={[type.body, styles.notice]}>{t('auth.login.expired')}</Text>
        ) : null}
        <Card>
          <TextField
            label={t('auth.login.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            returnKeyType="next"
          />
          <TextField
            label={t('auth.login.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
          <ProblemText problem={problem} />
          <Button
            title={t('auth.login.submit')}
            onPress={() => void submit()}
            loading={busy}
            disabled={!username.trim() || !password}
          />
        </Card>
        <View style={styles.footer}>
          <Text style={type.caption}>{server ?? ''}</Text>
          <Button
            variant="ghost"
            title={t('mobile.server.change')}
            onPress={() => void setServer(null)}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.lg, gap: spacing.xl, justifyContent: 'center' },
  header: { alignItems: 'center', gap: spacing.sm },
  notice: { color: colors.warning, textAlign: 'center' },
  footer: { alignItems: 'center', gap: spacing.xs },
});
