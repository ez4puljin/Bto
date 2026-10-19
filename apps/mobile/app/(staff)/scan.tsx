import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Camera, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { ScanGate } from '../../src/scan/scan-gate';
import { useSignedIn } from '../../src/state/session';
import { colors, radii, spacing, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] as const;

/**
 * The camera finds a product by its barcode (ADR-0006 #4) and opens its page in the scanned unit
 * (ADR-0068); «Сагсанд нэмэх» there comes back here for the next code.
 */
export default function ScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useSignedIn();
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate());
  const [looking, setLooking] = useState(false);
  const [problem, setProblem] = useState<AppProblem | null>(null);

  const onRead = async (raw: string) => {
    if (looking || problem) return;
    const code = gate.current.accept(raw, Date.now());
    if (!code) return;
    setLooking(true);
    try {
      const result = await session.client.GET('/api/v1/barcodes/{code}', {
        params: { path: { code } },
      });
      if (result.data) {
        router.replace(`/product/${result.data.product.id}?unit=${result.data.unit.id}&from=scan`);
        return;
      }
      setProblem(problemOf(result.error, result.response.status));
    } catch {
      setProblem(NETWORK);
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
      <Page edges={['top', 'bottom']}>
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
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={problem || looking ? undefined : (result) => void onRead(result.data)}
      />
      <View style={styles.frame} pointerEvents="none" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={() => router.back()}
        style={[styles.close, { top: insets.top + spacing.md }]}
      >
        <X size={20} strokeWidth={2.6} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.title, { top: insets.top + spacing.lg }]}>{t('mobile.scan.title')}</Text>
      <View style={[styles.panel, { bottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}>
        {problem ? (
          <View style={styles.card}>
            <ProblemText problem={problem} />
            <PillButton title={t('mobile.scan.again')} height={48} onPress={again} />
          </View>
        ) : (
          <View style={[styles.card, styles.row]}>
            {looking ? <ActivityIndicator color={colors.primary} /> : null}
            <Text style={[type.body, styles.aim]}>
              {looking ? t('common.loading') : t('mobile.scan.aim')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.foreground },
  ask: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  frame: {
    position: 'absolute',
    top: '30%',
    left: '12%',
    right: '12%',
    height: 160,
    borderRadius: radii.tile,
    borderWidth: 3,
    borderColor: colors.primaryForeground,
  },
  close: {
    position: 'absolute',
    right: spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.floatingFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    position: 'absolute',
    left: 0,
    right: 0,
    ...type.heading,
    textAlign: 'center',
    color: colors.primaryForeground,
  },
  panel: { position: 'absolute', left: spacing.lg, right: spacing.lg },
  card: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radii.card,
    backgroundColor: colors.floatingFill,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  aim: { textAlign: 'center' },
});
