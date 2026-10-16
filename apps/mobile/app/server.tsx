import Constants from 'expo-constants';
import { Server } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { isHealthAnswer, normalizeServerUrl } from '../src/server/server-url';
import { useSession } from '../src/state/session';
import { colors, spacing, type } from '../src/theme/tokens';
import { Button, Card, Screen, TextField, Title } from '../src/ui/kit';

/** The PC's address the build put in (`pnpm mobile:apk`), else empty. */
function builtInServer(): string {
  const extra = Constants.expoConfig?.extra as { defaultServer?: unknown } | undefined;
  return typeof extra?.defaultServer === 'string' ? extra.defaultServer : '';
}

type Check = 'idle' | 'checking' | 'failed' | 'invalid';

/**
 * The API server the app talks to (ADR-0061 #2): on the office Wi-Fi the PC's address, later the
 * production address. It is saved only after GET /health answers.
 */
export default function ServerScreen() {
  const { t } = useTranslation();
  const { setServer } = useSession();
  const [address, setAddress] = useState(builtInServer);
  const [check, setCheck] = useState<Check>('idle');

  const connect = async () => {
    const server = normalizeServerUrl(address);
    if (!server) {
      setCheck('invalid');
      return;
    }
    setCheck('checking');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`${server}/health`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      if (!isHealthAnswer(body)) {
        setCheck('failed');
        return;
      }
      await setServer(server);
    } catch {
      setCheck('failed');
    } finally {
      clearTimeout(timer);
    }
  };

  return (
    <Screen bottom>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <View style={styles.header}>
          <Server size={40} color={colors.primary} />
          <Title>{t('app.name')}</Title>
          <Text style={type.secondary}>{t('mobile.server.intro')}</Text>
        </View>
        <Card>
          <TextField
            label={t('mobile.server.label')}
            value={address}
            onChangeText={(value) => {
              setAddress(value);
              setCheck('idle');
            }}
            placeholder={t('mobile.server.hint')}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={() => void connect()}
          />
          <Button
            title={t('mobile.server.connect')}
            onPress={() => void connect()}
            loading={check === 'checking'}
          />
          {check === 'failed' ? (
            <Text style={[type.body, styles.error]}>{t('mobile.server.failed')}</Text>
          ) : null}
          {check === 'invalid' ? (
            <Text style={[type.body, styles.error]}>{t('mobile.server.invalid')}</Text>
          ) : null}
        </Card>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, padding: spacing.lg, gap: spacing.xl, justifyContent: 'center' },
  header: { alignItems: 'center', gap: spacing.sm },
  error: { color: colors.destructive },
});
