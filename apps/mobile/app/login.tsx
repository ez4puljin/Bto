import { Clock, LockKeyhole, LogOut, User } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { AppProblem } from '../src/api/problem';
import { useSession } from '../src/state/session';
import { colors, radii, spacing, type } from '../src/theme/tokens';
import { BrandLockup, ServerChip } from '../src/ui/brand';
import { PillButton } from '../src/ui/controls';
import { PasswordToggle, TextField } from '../src/ui/field';
import { ProblemText } from '../src/ui/kit';
import { Page } from '../src/ui/layout';
import { Text, type TextInput } from '../src/ui/text';

/**
 * Signs in with the staff account (ADR-0061 #4, ADR-0066); the session stays until its shift ends.
 * «Сервер солих» goes back to the server screen, which keeps this address on its recent list.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { session, state, server, setServer } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const reason = state.status === 'anonymous' ? state.reason : undefined;
  const ready = username.trim() !== '' && password !== '';

  const submit = async () => {
    if (!session || !ready || busy) return;
    setBusy(true);
    setProblem(await session.login(username.trim(), password));
    setBusy(false);
  };

  return (
    <Page white edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BrandLockup />
          <Text accessibilityRole="header" style={[type.title, styles.title]}>
            {t('auth.login.title')}
          </Text>
          <Text style={[type.body, styles.lead]}>{t('auth.login.welcome')}</Text>

          {reason === 'expired' ? (
            <View style={[styles.notice, styles.noticeExpired]}>
              <Clock size={18} strokeWidth={2} color={colors.warning} style={styles.noticeIcon} />
              <Text style={[type.body, styles.noticeText, styles.expiredText]}>
                {t('auth.login.expired')}
              </Text>
            </View>
          ) : reason === 'logout' ? (
            <View style={[styles.notice, styles.noticeLogout]}>
              <LogOut size={18} strokeWidth={2} color={colors.primary} style={styles.noticeIcon} />
              <Text style={[type.body, styles.noticeText, styles.logoutText]}>
                {t('auth.login.loggedOut')}
              </Text>
            </View>
          ) : null}

          <TextField
            style={styles.username}
            label={t('auth.login.username')}
            icon={User}
            value={username}
            onChangeText={(value) => {
              setUsername(value);
              setProblem(null);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            readOnly={busy}
          />
          <TextField
            style={styles.password}
            inputRef={passwordRef}
            label={t('auth.login.password')}
            icon={LockKeyhole}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setProblem(null);
            }}
            secureTextEntry={!shown}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            readOnly={busy}
            trailing={<PasswordToggle shown={shown} onToggle={() => setShown((value) => !value)} />}
          />

          <ProblemText problem={problem} style={styles.problem} />
          <PillButton
            style={styles.button}
            height={50}
            title={t('auth.login.submit')}
            loading={busy}
            loadingTitle={t('mobile.login.busy')}
            disabled={!ready}
            onPress={() => void submit()}
          />

          <View style={styles.spacer} />
          <ServerChip server={server} onPress={() => void setServer(null)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 },
  title: { marginTop: 40 },
  lead: { marginTop: 6, color: colors.muted },
  notice: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radii.field,
  },
  noticeExpired: { backgroundColor: colors.warningSoft },
  noticeLogout: { backgroundColor: colors.infoSoft },
  noticeIcon: { marginTop: 0.5 },
  noticeText: { flex: 1 },
  expiredText: { color: colors.warningText },
  logoutText: { color: colors.secondaryForeground },
  username: { marginTop: 24 },
  password: { marginTop: 16 },
  problem: { marginTop: 16 },
  button: { marginTop: 24 },
  spacer: { flex: 1, minHeight: 24 },
});
