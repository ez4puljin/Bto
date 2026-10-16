import Constants from 'expo-constants';
import { Server } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isHealthAnswer, normalizeServerUrl } from '../src/server/server-url';
import { useSession } from '../src/state/session';
import { colors, spacing, type } from '../src/theme/tokens';
import { PillButton } from '../src/ui/controls';
import { Group, InputRow } from '../src/ui/grouped';
import { FootNote, LargeTitle, Page } from '../src/ui/layout';

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
    <Page edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View style={styles.icon}>
              <Server size={28} strokeWidth={2} color={colors.primaryForeground} />
            </View>
            <LargeTitle>{t('app.name')}</LargeTitle>
            <Text style={[type.body, styles.muted]}>{t('mobile.server.intro')}</Text>
          </View>
          <View>
            <Group>
              <InputRow
                label={t('mobile.server.label')}
                labelWidth={90}
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
            </Group>
            {check === 'failed' ? (
              <Text style={[type.secondary, styles.error]}>{t('mobile.server.failed')}</Text>
            ) : null}
            {check === 'invalid' ? (
              <Text style={[type.secondary, styles.error]}>{t('mobile.server.invalid')}</Text>
            ) : null}
            <FootNote>{t('mobile.server.example')}</FootNote>
          </View>
          <PillButton
            title={t('mobile.server.connect')}
            onPress={() => void connect()}
            loading={check === 'checking'}
          />
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
  error: { marginTop: spacing.sm, marginHorizontal: spacing.xs, color: colors.destructive },
});
