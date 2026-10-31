import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Clock, LogOut } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import customerIcon from '../assets/customer/splash-icon.png';
import type { AppProblem } from '../src/api/problem';
import { phoneInput, phoneOf } from '../src/customer/sign-in';
import { FieldRow, SignInProblem } from '../src/customer/sign-in-rows';
import { useSession } from '../src/state/session';
import { brandSheet } from '../src/theme/brand';
import { colors, radii, shadows, spacing, TOUCH, type } from '../src/theme/tokens';
import { ServerChip, useAppName } from '../src/ui/brand';
import { PillButton } from '../src/ui/controls';
import { PasswordToggle } from '../src/ui/field';
import { Group } from '../src/ui/grouped';
import { Page, SectionHeader } from '../src/ui/layout';
import { Text, type TextInput } from '../src/ui/text';

/**
 * «Bto300»'s sign-in (the Login board, ADR-0079 #3, #13): the store's phone after «+976» and its
 * password. A first password, or a forgotten one, starts from the office's one-time code on
 * «Нууц үг тавих»; no SMS. A development build shows its server under the form.
 */
export default function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const appName = useAppName();
  const { session, state, server, setServer, serverFixed } = useSession();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const reason = state.status === 'anonymous' ? state.reason : undefined;
  const signInPhone = phoneOf(phone);
  const ready = signInPhone !== null && password !== '';

  const submit = async () => {
    if (session?.kind !== 'customer' || signInPhone === null || password === '' || busy) return;
    setBusy(true);
    setProblem(await session.login(signInPhone, password));
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
                source={customerIcon}
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

          <SectionHeader style={styles.heading}>
            {t('mobile.customer.signIn.heading')}
          </SectionHeader>
          <Group>
            <FieldRow
              label={t('mobile.customer.signIn.phone')}
              prefix={t('mobile.customer.signIn.phonePrefix')}
              placeholder={t('mobile.customer.signIn.phonePlaceholder')}
              value={phone}
              onChangeText={(value) => {
                setPhone(phoneInput(value));
                setProblem(null);
              }}
              keyboardType="number-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              autoCorrect={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              readOnly={busy}
            />
            <FieldRow
              inputRef={passwordRef}
              label={t('mobile.customer.signIn.password')}
              placeholder={t('mobile.customer.signIn.password')}
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

          <SignInProblem problem={problem} style={styles.problem} />
          <PillButton
            style={styles.button}
            height={52}
            title={t('mobile.customer.signIn.submit')}
            loading={busy}
            loadingTitle={t('mobile.login.busy')}
            disabled={!ready}
            onPress={() => void submit()}
          />
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push('/set-password')}
            hitSlop={4}
            style={styles.link}
          >
            <Text style={[type.row, styles.linkText]}>
              {t('mobile.customer.signIn.setPasswordLink')}
            </Text>
          </Pressable>
          <Text style={[type.secondary, styles.note]}>{t('mobile.customer.signIn.note')}</Text>

          <View style={styles.spacer} />
          {serverFixed ? null : <ServerChip server={server} onPress={() => void setServer(null)} />}
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = brandSheet(() =>
  StyleSheet.create({
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
    link: { marginTop: 10, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center' },
    linkText: { color: colors.primary, textAlign: 'center' },
    note: { marginHorizontal: spacing.sm, textAlign: 'center' },
    spacer: { flex: 1, minHeight: spacing.xl },
  }),
);
