import { Image } from 'expo-image';
import { Clock, LogOut } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import splashIcon from '../assets/splash-icon.png';
import type { AppProblem } from '../src/api/problem';
import { FieldRow } from '../src/customer/sign-in-rows';
import { useSession } from '../src/state/session';
import { colors, radii, shadows, spacing, type } from '../src/theme/tokens';
import { ServerChip, useAppName } from '../src/ui/brand';
import { PillButton } from '../src/ui/controls';
import { PasswordToggle } from '../src/ui/field';
import { Group } from '../src/ui/grouped';
import { ProblemText } from '../src/ui/kit';
import { Page, SectionHeader } from '../src/ui/layout';
import { Text, type TextInput } from '../src/ui/text';

/** The label column of the two rows: «Нэвтрэх нэр» fits on one line. */
const LABEL_WIDTH = 104;

/**
 * Signs in with the staff account (ADR-0061 #4, ADR-0068); the session stays until its shift ends.
 * Drawn as «Bto300»'s sign-in since ADR-0100: the logo, the app's name and the company, then the
 * login and password in one grouped card. «Сервер солих» goes back to the server screen, which
 * keeps this address on its recent list.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const appName = useAppName();
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
    <Page edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.mark}>
            <View
              style={styles.logo}
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            >
              <Image
                source={splashIcon}
                contentFit="contain"
                accessible={false}
                style={styles.logoImage}
              />
            </View>
            <Text accessibilityRole="header" style={type.largeTitle}>
              {appName}
            </Text>
            <Text style={[type.body, styles.company]}>{t('brand.company')}</Text>
          </View>

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

          <SectionHeader style={styles.heading}>{t('auth.login.welcome')}</SectionHeader>
          <Group>
            <FieldRow
              label={t('auth.login.username')}
              labelWidth={LABEL_WIDTH}
              placeholder={t('auth.login.username')}
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
              onSubmitEditing={() => void submit()}
              readOnly={busy}
              trailing={<PasswordToggle shown={shown} onToggle={() => setShown((on) => !on)} />}
            />
          </Group>

          <ProblemText problem={problem} style={styles.problem} />
          <PillButton
            style={styles.button}
            height={52}
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
  body: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 56, paddingBottom: spacing.lg },
  mark: { alignItems: 'center', gap: 10 },
  logo: { width: 84, height: 84, borderRadius: 24, boxShadow: shadows.brand },
  logoImage: { width: 84, height: 84, borderRadius: 24 },
  company: { color: colors.muted, textAlign: 'center' },
  notice: {
    marginTop: spacing.xl,
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
  heading: { marginTop: 36 },
  problem: { marginTop: spacing.lg },
  button: { marginTop: 20 },
  spacer: { flex: 1, minHeight: spacing.xl },
});
