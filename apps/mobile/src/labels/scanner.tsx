import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScanGate } from '../scan/scan-gate';
import { colors, radii, spacing, storeType, TOUCH, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { EmptyState } from '../ui/kit';
import { Text } from '../ui/text';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] as const;

/** What a read did: the product's name and price, or nothing found for the code. */
export type ScanOutcome =
  { found: true; name: string; price: string } | { found: false; code: string } | null;

/**
 * The camera over the page, kept open read after read (the shop's scan closes after one): each
 * confirmed code (`ScanGate`, as everywhere) goes to `onCode`, which adds the product; a short
 * vibration and a line with the name and price (or «Бараа олдсонгүй») answer it. «Дуусгах» closes.
 */
export function LabelScanner({
  visible,
  onClose,
  onCode,
  total,
}: {
  visible: boolean;
  onClose: () => void;
  onCode: (code: string) => Promise<ScanOutcome>;
  /** The labels in the list now. */
  total: number;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate());
  const busy = useRef(false);
  const [looking, setLooking] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome>(null);

  const onRead = async (raw: string) => {
    if (busy.current) return;
    const code = gate.current.accept(raw, Date.now());
    if (!code) return;
    busy.current = true;
    setLooking(true);
    try {
      const result = await onCode(code);
      setOutcome(result);
      Vibration.vibrate(result?.found ? 70 : [0, 80, 60, 80]);
    } finally {
      busy.current = false;
      setLooking(false);
    }
  };

  const close = () => {
    gate.current.reset();
    setOutcome(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      {!permission ? (
        <View style={styles.root} />
      ) : !permission.granted ? (
        <View style={[styles.ask, { paddingTop: insets.top + spacing.lg }]}>
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
          <PillButton title={t('mobile.labels.close')} variant="white" onPress={close} />
        </View>
      ) : (
        <View style={styles.root}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
            onBarcodeScanned={(result) => void onRead(result.data)}
          />
          <View style={styles.frame} pointerEvents="none" />
          <View style={[styles.bar, { top: insets.top + spacing.xs }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.labels.close')}
              onPress={close}
              style={({ pressed }) => [styles.round, pressed && styles.pressed]}
            >
              <X size={22} strokeWidth={2.2} color={colors.primaryForeground} />
            </Pressable>
            <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
              {t('mobile.labels.scanTitle')}
            </Text>
            <View style={styles.round} />
          </View>
          <View
            style={[styles.panel, { bottom: Math.max(insets.bottom, spacing.md) + spacing.md }]}
          >
            <View style={[styles.capsule, outcome && !outcome.found && styles.capsuleBad]}>
              {looking ? <ActivityIndicator color={colors.primaryForeground} /> : null}
              <Text style={[type.body, styles.message]}>
                {outcome === null
                  ? t('mobile.labels.scanAim')
                  : outcome.found
                    ? t('mobile.labels.scanAdded', { name: outcome.name, price: outcome.price })
                    : t('mobile.labels.scanNotFound', { code: outcome.code })}
              </Text>
            </View>
            <Text style={[type.bodyStrong, styles.total]}>
              {t('mobile.labels.scanTotal', { labels: total })}
            </Text>
            <PillButton title={t('mobile.labels.scanDone')} variant="white" onPress={close} />
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.blocked },
  ask: { flex: 1, backgroundColor: colors.canvas, padding: spacing.lg, gap: spacing.md },
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.onPrimaryHairline,
  },
  pressed: { opacity: 0.6 },
  title: { ...storeType.headerTitleStrong, flex: 1, textAlign: 'center' },
  panel: { position: 'absolute', left: spacing.lg, right: spacing.lg, gap: spacing.md },
  capsule: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: radii.card,
    backgroundColor: colors.popupBackdrop,
  },
  capsuleBad: { backgroundColor: colors.destructive },
  message: { textAlign: 'center', color: colors.primaryForeground },
  total: { textAlign: 'center', color: colors.primaryForeground },
});
