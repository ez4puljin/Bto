import Constants from 'expo-constants';
import { CircleX, History, Server, X } from 'lucide-react-native';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { readRecentServers, writeRecentServers } from '../src/device/storage';
import {
  forgetServer,
  isHealthAnswer,
  normalizeServerUrl,
  type RecentServer,
  recentServerWhen,
  rememberServer,
  fieldAddress,
  serverHost,
} from '../src/server/server-url';
import { useSession } from '../src/state/session';
import { colors, radii, tabular, TOUCH, type } from '../src/theme/tokens';
import { BrandLockup } from '../src/ui/brand';
import { PillButton } from '../src/ui/controls';
import { TextField } from '../src/ui/field';
import { Page, SectionHeader } from '../src/ui/layout';
import { Text, type TextInput } from '../src/ui/text';

/** The PC's address the build put in (`pnpm mobile:apk`), else empty. */
function builtInServer(): string {
  const extra = Constants.expoConfig?.extra as { defaultServer?: unknown } | undefined;
  return typeof extra?.defaultServer === 'string' ? extra.defaultServer : '';
}

type Check = 'idle' | 'checking' | 'invalid' | 'noAnswer' | 'notBto';

const ERRORS = {
  invalid: 'mobile.server.invalid',
  noAnswer: 'mobile.server.noAnswer',
  notBto: 'mobile.server.notBto',
} as const;

/**
 * The API server the app talks to (ADR-0061 #2, ADR-0068): on the office Wi-Fi the PC's address,
 * later the production address. It is saved, and put on top of «Сүүлд ашигласан», only after
 * GET /health answers as Bto's API.
 */
export default function ServerScreen() {
  const { t } = useTranslation();
  const { setServer } = useSession();
  const [address, setAddress] = useState('');
  const [recent, setRecent] = useState<RecentServer[]>([]);
  const [check, setCheck] = useState<Check>('idle');
  const [focused, setFocused] = useState(false);
  const typed = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const checking = check === 'checking';
  const now = Date.now();

  useEffect(() => {
    let live = true;
    void readRecentServers().then((list) => {
      if (!live) return;
      setRecent(list);
      // The field starts with the last server that answered, else the build's address.
      if (!typed.current) setAddress(fieldAddress(list[0]?.url ?? builtInServer()));
    });
    return () => {
      live = false;
    };
  }, []);

  const edit = (value: string) => {
    typed.current = true;
    setAddress(value);
    setCheck('idle');
  };

  const connect = async (input: string) => {
    if (checking) return;
    const server = normalizeServerUrl(input);
    if (!server) {
      setCheck('invalid');
      return;
    }
    setCheck('checking');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let outcome: Check | 'ok';
    try {
      const response = await fetch(`${server}/health`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      try {
        outcome = isHealthAnswer(await response.json()) ? 'ok' : 'notBto';
      } catch {
        // A body cut off by the time limit is no answer; one that is not JSON is another site.
        outcome = controller.signal.aborted ? 'noAnswer' : 'notBto';
      }
    } catch {
      outcome = 'noAnswer';
    } finally {
      clearTimeout(timer);
    }
    if (outcome !== 'ok') {
      setCheck(outcome);
      return;
    }
    await writeRecentServers(rememberServer(recent, server, Date.now()));
    await setServer(server);
  };

  const pick = (item: RecentServer) => {
    if (checking) return;
    typed.current = true;
    setAddress(fieldAddress(item.url));
    void connect(item.url);
  };

  const forget = (item: RecentServer) => {
    const next = forgetServer(recent, item.url);
    setRecent(next);
    void writeRecentServers(next);
  };

  const askToForget = (item: RecentServer) => {
    Alert.alert(t('mobile.server.forgetTitle', { host: serverHost(item.url) }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('mobile.server.forget'), style: 'destructive', onPress: () => forget(item) },
    ]);
  };

  const usedLabel = (usedAt: number) => {
    const when = recentServerWhen(usedAt, now);
    return when.today ? t('mobile.server.usedToday', { time: when.time }) : when.date;
  };

  const trailing = checking ? (
    <ActivityIndicator size="small" color={colors.muted} />
  ) : focused && address !== '' ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.server.clear')}
      onPress={() => {
        edit('');
        inputRef.current?.focus();
      }}
      style={styles.trailingButton}
    >
      <CircleX size={18} strokeWidth={2} color={colors.placeholder} />
    </Pressable>
  ) : null;

  return (
    <Page white edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.grow}
      >
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <BrandLockup />
          <Text accessibilityRole="header" style={[type.title, styles.title]}>
            {t('mobile.server.title')}
          </Text>
          <Text style={[type.body, styles.lead]}>{t('mobile.server.lead')}</Text>

          <TextField
            style={styles.field}
            inputRef={inputRef}
            label={t('mobile.server.label')}
            icon={Server}
            value={address}
            onChangeText={edit}
            placeholder={t('mobile.server.placeholder')}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
            returnKeyType="go"
            onSubmitEditing={() => void connect(address)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            readOnly={checking}
            error={
              check === 'invalid' || check === 'noAnswer' || check === 'notBto'
                ? t(ERRORS[check])
                : null
            }
            hint={checking ? t('mobile.server.checking') : null}
            trailing={trailing}
          />

          <PillButton
            style={styles.button}
            height={50}
            title={t('mobile.server.connect')}
            loading={checking}
            loadingTitle={t('mobile.server.checking')}
            disabled={address.trim() === ''}
            onPress={() => void connect(address)}
          />

          {recent.length > 0 ? (
            <View>
              <SectionHeader style={styles.recentHeader}>{t('mobile.server.recent')}</SectionHeader>
              <View style={styles.list}>
                {recent.map((item, index) => (
                  <Fragment key={item.url}>
                    {index > 0 ? <View style={styles.separator} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={serverHost(item.url)}
                      accessibilityHint={usedLabel(item.usedAt)}
                      accessibilityState={{ disabled: checking }}
                      disabled={checking}
                      onPress={() => pick(item)}
                      onLongPress={() => askToForget(item)}
                      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    >
                      <View style={styles.rowIcon}>
                        <History size={16} strokeWidth={2} color={colors.muted} />
                      </View>
                      <View style={styles.rowText}>
                        <Text numberOfLines={1} style={[type.row, tabular]}>
                          {serverHost(item.url)}
                        </Text>
                        <Text numberOfLines={1} style={type.caption}>
                          {usedLabel(item.usedAt)}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('mobile.server.forgetLabel')}
                        disabled={checking}
                        onPress={() => forget(item)}
                        style={styles.trailingButton}
                      >
                        <X size={16} strokeWidth={2.2} color={colors.muted} />
                      </Pressable>
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.spacer} />
          <Text style={[type.caption, styles.version]}>
            {t('mobile.profile.versionLine', {
              version: Constants.expoConfig?.version ?? '',
              build: Constants.expoConfig?.android?.versionCode ?? '',
            })}
          </Text>
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
  field: { marginTop: 28 },
  button: { marginTop: 20 },
  recentHeader: { marginTop: 32 },
  list: { backgroundColor: colors.imageFill, borderRadius: radii.card, overflow: 'hidden' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 56, backgroundColor: colors.hairline },
  row: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 12,
    paddingRight: 6,
  },
  rowPressed: { backgroundColor: colors.fill },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: 1 },
  trailingButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1, minHeight: 24 },
  version: { textAlign: 'center' },
});
