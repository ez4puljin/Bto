import Constants from 'expo-constants';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isHealthAnswer, normalizeServerUrl } from '../src/server/server-url';
import { colors, radii, spacing, TOUCH, type } from '../src/theme/tokens';

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; version: string }
  | { state: 'failed' }
  | { state: 'invalid' };

/** The PC's address the build put in (`pnpm mobile:apk`), else empty. */
function builtInServer(): string {
  const extra = Constants.expoConfig?.extra as { defaultServer?: unknown } | undefined;
  return typeof extra?.defaultServer === 'string' ? extra.defaultServer : '';
}

/** Reaches the API's GET /health over the office Wi-Fi (the first build's check, ADR-0061). */
export default function ServerCheck() {
  const { t } = useTranslation();
  const [address, setAddress] = useState(builtInServer);
  const [check, setCheck] = useState<Check>({ state: 'idle' });

  const run = async () => {
    const server = normalizeServerUrl(address);
    if (!server) {
      setCheck({ state: 'invalid' });
      return;
    }
    setCheck({ state: 'checking' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${server}/health`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      setCheck(isHealthAnswer(body) ? { state: 'ok', version: body.version } : { state: 'failed' });
    } catch {
      setCheck({ state: 'failed' });
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={type.title}>{t('app.name')}</Text>
      <View style={styles.card}>
        <Text style={type.bodyStrong}>{t('mobile.server.label')}</Text>
        <TextInput
          style={styles.input}
          value={address}
          onChangeText={setAddress}
          placeholder={t('mobile.server.hint')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          onSubmitEditing={() => void run()}
        />
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void run()}
          disabled={check.state === 'checking'}
        >
          {check.state === 'checking' ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.buttonText}>{t('mobile.server.check')}</Text>
          )}
        </Pressable>
        {check.state === 'ok' ? (
          <Text style={[type.body, { color: colors.success }]}>
            {t('mobile.server.connected', { version: check.version })}
          </Text>
        ) : null}
        {check.state === 'failed' ? (
          <Text style={[type.body, { color: colors.destructive }]}>
            {t('mobile.server.failed')}
          </Text>
        ) : null}
        {check.state === 'invalid' ? (
          <Text style={[type.body, { color: colors.destructive }]}>
            {t('mobile.server.invalid')}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.canvas },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  input: {
    ...type.body,
    minHeight: TOUCH,
    borderWidth: 1,
    borderColor: colors.input,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
  },
  button: {
    minHeight: TOUCH,
    borderRadius: radii.control,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: colors.primaryPressed },
  buttonText: { ...type.bodyStrong, color: colors.primaryForeground },
});
