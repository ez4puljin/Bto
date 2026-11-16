import { StatusBar } from 'expo-status-bar';
import { Clock, FingerprintPattern, LockKeyhole, LogOut, Phone } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { AppProblem } from '../src/api/problem';
import {
  biometricsReady,
  confirmWithBiometrics,
  readSavedLogin,
  type SavedLogin,
  writeSavedLogin,
} from '../src/device/saved-login';
import { useSession } from '../src/state/session';
import { HERO_OVERLAP, StaffHero } from '../src/staff/brand';
import { colors, shadows, spacing, type } from '../src/theme/tokens';
import { ServerChip } from '../src/ui/brand';
import { PillButton, Toggle } from '../src/ui/controls';
import { PasswordToggle, TextField } from '../src/ui/field';
import { ProblemText } from '../src/ui/kit';
import { Page } from '../src/ui/layout';
import { Card, Notice, PAGE } from '../src/ui/staff-kit';
import { Text, type TextInput } from '../src/ui/text';

/**
 * Signs in with the staff account (ADR-0061 #4, ADR-0068); the session stays until its shift ends.
 * The company's logo, «Ажилтны апп» and the company on a blue band, then one card that climbs into
 * it (the Login board of 2026-11-16): why the last session ended, the login and the password, and
 * the buttons. «Нууц үг сануулах» keeps them on the phone for this server; with a fingerprint
 * enrolled the kept password is unlocked by it (asked at once, unless the person just signed out),
 * otherwise it is filled in. «Сервер солих» goes back to the server screen, which keeps this
 * address on its recent list.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { session, state, server, setServer } = useSession();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [remember, setRemember] = useState(true);
  const [saved, setSaved] = useState<SavedLogin | null>(null);
  const [fingerprint, setFingerprint] = useState(false);
  const asked = useRef(false);
  const passwordRef = useRef<TextInput>(null);
  const reason = state.status === 'anonymous' ? state.reason : undefined;
  const ready = login.trim() !== '' && password !== '';

  const signIn = async (name: string, secret: string, fromSaved: boolean) => {
    if (!session || busy) return;
    setBusy(true);
    const result = await session.login(name, secret);
    if (server) {
      if (result === null) {
        await writeSavedLogin(server, remember ? { login: name, password: secret } : null);
      } else if (fromSaved && result.code === 'INVALID_CREDENTIALS') {
        // The password changed since it was kept: forget it, the person types the new one.
        await writeSavedLogin(server, null);
        setSaved(null);
        setFingerprint(false);
      }
    }
    setProblem(result);
    setBusy(false);
  };

  const unlock = async (kept: SavedLogin) => {
    const ok = await confirmWithBiometrics(
      t('mobile.login.fingerprintPrompt'),
      t('mobile.login.fingerprintCancel'),
    );
    if (ok) await signIn(kept.login, kept.password, true);
  };
  // The first ask reads the latest `unlock` and why the screen opened, without re-running the read.
  const unlockRef = useRef(unlock);
  useEffect(() => {
    unlockRef.current = unlock;
  });
  const openedAfterLogout = useRef(reason === 'logout');

  useEffect(() => {
    if (!server) return;
    let live = true;
    void (async () => {
      const kept = await readSavedLogin(server);
      if (!live || kept === null) return;
      const bio = await biometricsReady();
      if (!live) return;
      setSaved(kept);
      setLogin(kept.login);
      setFingerprint(bio);
      if (!bio) setPassword(kept.password);
      if (bio && !openedAfterLogout.current && !asked.current) {
        asked.current = true;
        void unlockRef.current(kept);
      }
    })();
    return () => {
      live = false;
    };
  }, [server]);

  return (
    <Page edges={['bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <StaffHero />
          <View style={styles.body}>
            <Card style={styles.card}>
              {reason === 'expired' ? (
                <Notice icon={Clock} tone="warn">
                  {t('auth.login.expired')}
                </Notice>
              ) : reason === 'logout' ? (
                <Notice icon={LogOut} tone="info">
                  {t('auth.login.loggedOut')}
                </Notice>
              ) : null}
              <TextField
                label={t('auth.login.phone')}
                icon={Phone}
                value={login}
                onChangeText={(value) => {
                  setLogin(value);
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
                onSubmitEditing={() => void signIn(login.trim(), password, false)}
                readOnly={busy}
                trailing={<PasswordToggle shown={shown} onToggle={() => setShown((on) => !on)} />}
              />
              <View style={styles.remember}>
                <Text style={[type.row, styles.grow]}>{t('mobile.login.remember')}</Text>
                <Toggle
                  value={remember}
                  onChange={setRemember}
                  label={t('mobile.login.remember')}
                />
              </View>
              <ProblemText problem={problem} style={styles.problem} />
              <PillButton
                title={t('auth.login.submit')}
                loading={busy}
                loadingTitle={t('mobile.login.busy')}
                disabled={!ready}
                onPress={() => void signIn(login.trim(), password, false)}
              />
              {fingerprint && saved ? (
                <PillButton
                  variant="soft"
                  icon={
                    <FingerprintPattern
                      size={20}
                      strokeWidth={2}
                      color={colors.secondaryForeground}
                    />
                  }
                  title={t('mobile.login.fingerprint')}
                  disabled={busy}
                  onPress={() => void unlock(saved)}
                />
              ) : null}
            </Card>
            <View style={styles.spacer} />
            <ServerChip
              server={server}
              onPress={() => void setServer(null)}
              style={styles.server}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  scroll: { flexGrow: 1 },
  body: { flex: 1, ...PAGE, marginTop: -HERO_OVERLAP },
  card: { gap: spacing.lg, boxShadow: shadows.floating },
  remember: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  problem: { marginTop: 0 },
  spacer: { flex: 1, minHeight: spacing.sm },
  // The chip on the grey canvas: white with an edge, as the boards' chips.
  server: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
});
