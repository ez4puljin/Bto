import { Clock, FingerprintPattern, LogOut } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { AppProblem } from '../src/api/problem';
import { FieldRow } from '../src/customer/sign-in-rows';
import {
  biometricsReady,
  confirmWithBiometrics,
  readSavedLogin,
  type SavedLogin,
  writeSavedLogin,
} from '../src/device/saved-login';
import { useSession } from '../src/state/session';
import { colors, radii, spacing, type } from '../src/theme/tokens';
import { CompanyLogo, ServerChip, useAppName } from '../src/ui/brand';
import { PillButton, Toggle } from '../src/ui/controls';
import { PasswordToggle } from '../src/ui/field';
import { Group } from '../src/ui/grouped';
import { ProblemText } from '../src/ui/kit';
import { Page, SectionHeader } from '../src/ui/layout';
import { Text, type TextInput } from '../src/ui/text';

/** The label column of the two rows: «Утасны дугаар» fits on one line. */
const LABEL_WIDTH = 120;

/**
 * Signs in with the staff account (ADR-0061 #4, ADR-0068); the session stays until its shift ends.
 * The company's logo, «Ажилтны апп» and the company, then the login and password in one grouped
 * card (ADR-0174). «Нууц үг сануулах» keeps them on the phone for this server; with a fingerprint
 * enrolled the kept password is unlocked by it (asked at once, unless the person just signed out),
 * otherwise it is filled in. Why the last session ended shows under the button. «Сервер солих» goes
 * back to the server screen, which keeps this address on its recent list.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const appName = useAppName();
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
    <Page edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.mark}>
            <CompanyLogo height={72} />
            <Text accessibilityRole="header" style={[type.largeTitle, styles.name]}>
              {appName}
            </Text>
            <Text style={[type.body, styles.company]}>{t('brand.company')}</Text>
          </View>

          <SectionHeader style={styles.heading}>{t('auth.login.welcome')}</SectionHeader>
          <Group>
            <FieldRow
              label={t('auth.login.phone')}
              labelWidth={LABEL_WIDTH}
              placeholder={t('auth.login.phone')}
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
            <FieldRow
              inputRef={passwordRef}
              label={t('auth.login.password')}
              labelWidth={LABEL_WIDTH}
              placeholder={t('auth.login.password')}
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
          </Group>

          <View style={styles.remember}>
            <Text style={[type.body, styles.rememberText]}>{t('mobile.login.remember')}</Text>
            <Toggle value={remember} onChange={setRemember} label={t('mobile.login.remember')} />
          </View>

          <ProblemText problem={problem} style={styles.problem} />
          <PillButton
            style={styles.button}
            height={52}
            title={t('auth.login.submit')}
            loading={busy}
            loadingTitle={t('mobile.login.busy')}
            disabled={!ready}
            onPress={() => void signIn(login.trim(), password, false)}
          />
          {fingerprint && saved ? (
            <PillButton
              style={styles.fingerprint}
              height={52}
              variant="soft"
              icon={<FingerprintPattern size={22} strokeWidth={2} color={colors.primary} />}
              title={t('mobile.login.fingerprint')}
              disabled={busy}
              onPress={() => void unlock(saved)}
            />
          ) : null}

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

          <View style={styles.spacer} />
          <ServerChip server={server} onPress={() => void setServer(null)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 56, paddingBottom: spacing.lg },
  mark: { alignItems: 'center', gap: 10 },
  name: { textAlign: 'center' },
  company: { color: colors.muted, textAlign: 'center' },
  heading: { marginTop: 36 },
  remember: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rememberText: { flex: 1 },
  problem: { marginTop: spacing.lg },
  button: { marginTop: 20 },
  fingerprint: { marginTop: spacing.md },
  notice: {
    marginTop: spacing.lg,
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
  spacer: { flex: 1, minHeight: spacing.xl },
});
