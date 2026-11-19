import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Camera, Flashlight, FlashlightOff, Keyboard, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { keptBarcode } from '../../src/offline/query';
import { ScanGate } from '../../src/scan/scan-gate';
import { useKept } from '../../src/state/kept';
import { useSignedIn } from '../../src/state/session';
import { colors, radii, spacing, storeType, TOUCH, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';
import { StoreHeader } from '../../src/ui/store-header';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] as const;

/**
 * The camera finds a product by its barcode (ADR-0006 #4) and opens its page in the scanned unit
 * (ADR-0068); «Сагсанд нэмэх» there comes back here for the next code. The bar over the camera has
 * the close button, the title and the torch; «Кодоор хайх» closes the camera and opens «Бараа»
 * with its search focused (the Scan board of 2026-11-16).
 */
export default function ScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, offline } = useSignedIn();
  const { store } = useKept();
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate());
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);
  const [torch, setTorch] = useState(false);

  const onRead = async (raw: string) => {
    if (looking || problem) return;
    const code = gate.current.accept(raw, Date.now());
    if (!code) return;
    setLooking(true);
    const open = (productId: number, unitId: number) =>
      router.replace(`/product/${productId}?unit=${unitId}&from=scan`);
    // Without the server: the kept products' barcodes (ADR-0225 #2), by the same lookup keys.
    const fromKept = async (): Promise<boolean> => {
      const data = store ? await store.data() : null;
      if (!data) return false;
      const hit = keptBarcode(data, code);
      if (hit) open(hit.productId, hit.unitId);
      else setProblem({ code: 'NOT_FOUND', status: 404 });
      return true;
    };
    try {
      if (offline && store) {
        if (!(await fromKept())) setProblem(NETWORK);
        return;
      }
      const result = await session.client.GET('/api/v1/barcodes/{code}', {
        params: { path: { code } },
      });
      if (result.data) {
        open(result.data.product.id, result.data.unit.id);
        return;
      }
      setProblem(problemOf(result.error, result.response.status));
    } catch {
      if (!(await fromKept().catch(() => false))) setProblem(NETWORK);
    } finally {
      setLooking(false);
    }
  };

  const again = () => {
    gate.current.reset();
    setProblem(null);
  };

  if (!permission) return <Page />;
  if (!permission.granted) {
    return (
      // Under the blue header like every page (ADR-0100): the status bar is white on it.
      <Page edges={['bottom']}>
        <StoreHeader title={t('mobile.scan.title')} onBack={() => router.back()} right={null} />
        <View style={styles.ask}>
          <EmptyState
            icon={<Camera size={48} strokeWidth={1.5} color={colors.input} />}
            title={t('mobile.scan.permission')}
            hint={t('mobile.scan.permissionHint')}
          />
          {permission.canAskAgain ? (
            <PillButton title={t('mobile.scan.allow')} onPress={() => void requestPermission()} />
          ) : (
            <PillButton
              title={t('mobile.scan.openSettings')}
              onPress={() => void Linking.openSettings()}
            />
          )}
          <PillButton title={t('common.close')} variant="white" onPress={() => router.back()} />
        </View>
      </Page>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={problem || looking ? undefined : (result) => void onRead(result.data)}
      />
      <View style={styles.frame} pointerEvents="none" />
      <View style={[styles.bar, { top: insets.top + spacing.xs }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.round, pressed && styles.pressed]}
        >
          <X size={22} strokeWidth={2.2} color={colors.primaryForeground} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {t('mobile.scan.title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            torch ? 'mobile.customer.scan.torchOff' : 'mobile.customer.scan.torchOn',
          )}
          accessibilityState={{ selected: torch }}
          onPress={() => setTorch(!torch)}
          style={({ pressed }) => [
            styles.round,
            torch && styles.roundOn,
            pressed && styles.pressed,
          ]}
        >
          {torch ? (
            <Flashlight size={22} strokeWidth={2} color={colors.foreground} />
          ) : (
            <FlashlightOff size={22} strokeWidth={2} color={colors.primaryForeground} />
          )}
        </Pressable>
      </View>
      <View style={[styles.panel, { bottom: Math.max(insets.bottom, spacing.md) + spacing.md }]}>
        {problem ? (
          <View style={styles.card}>
            <ProblemText problem={problem} style={styles.problem} />
            <PillButton title={t('mobile.scan.again')} onPress={again} />
          </View>
        ) : (
          <View style={styles.row}>
            {looking ? <ActivityIndicator color={colors.primaryForeground} /> : null}
            <Text style={[type.body, styles.aim]}>
              {looking ? t('common.loading') : t('mobile.scan.aim')}
            </Text>
          </View>
        )}
        <PillButton
          title={t('mobile.scan.byCode')}
          variant="white"
          icon={<Keyboard size={20} strokeWidth={2} color={colors.primary} />}
          onPress={() => router.dismissTo({ pathname: '/shop', params: { search: '1' } })}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.blocked },
  ask: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  frame: {
    position: 'absolute',
    top: '30%',
    left: '12%',
    right: '12%',
    height: 170,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.primaryForeground,
  },
  bar: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  round: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: TOUCH / 2,
    backgroundColor: colors.onPrimaryHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundOn: { backgroundColor: colors.card },
  pressed: { opacity: 0.6 },
  title: { ...storeType.headerTitleStrong, flex: 1, textAlign: 'center' },
  panel: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.md },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.card,
  },
  problem: { marginTop: 0 },
  // The hint on a dark capsule, so it reads over whatever the camera shows.
  row: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: colors.popupBackdrop,
  },
  aim: { textAlign: 'center', color: colors.primaryForeground },
});
