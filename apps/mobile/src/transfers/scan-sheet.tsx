import { CameraView, useCameraPermissions } from 'expo-camera';
import { StatusBar } from 'expo-status-bar';
import { Camera, X } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScanGate } from '../scan/scan-gate';
import { colors, radii, spacing, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { EmptyState } from '../ui/kit';
import { Page } from '../ui/layout';
import { StoreHeader } from '../ui/store-header';
import { Text } from '../ui/text';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] as const;

/**
 * The camera over the screen that asked for a barcode (ADR-0116 #4, #5), as `app/(staff)/scan.tsx`
 * reads one (the same barcode types, the ScanGate, the permission flow): a confirmed code goes to
 * `onCode` and the sheet closes; no route hop, so the request editor and the receiving screen
 * keep their place.
 */
export function ScanSheet({
  visible,
  hint,
  onCode,
  onClose,
}: {
  visible: boolean;
  /** Under the frame: what the scan does here («Бараа хүсэлтэд нэмнэ»). */
  hint: string;
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate());

  useEffect(() => {
    if (visible) gate.current.reset();
  }, [visible]);

  const onRead = (raw: string) => {
    const code = gate.current.accept(raw, Date.now());
    if (!code) return;
    onCode(code);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {!permission ? (
        <Page />
      ) : !permission.granted ? (
        <Page edges={['bottom']}>
          <StatusBar style="light" />
          <StoreHeader title={t('mobile.scan.title')} onBack={onClose} right={null} />
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
            <PillButton title={t('common.close')} variant="white" onPress={onClose} />
          </View>
        </Page>
      ) : (
        <View style={styles.root}>
          <StatusBar style="light" />
          {visible ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
              onBarcodeScanned={(result) => onRead(result.data)}
            />
          ) : null}
          <View style={styles.frame} pointerEvents="none" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            style={[styles.close, { top: insets.top + spacing.md }]}
          >
            <X size={20} strokeWidth={2.6} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { top: insets.top + spacing.lg }]}>
            {t('mobile.scan.title')}
          </Text>
          <View
            style={[styles.panel, { bottom: Math.max(insets.bottom, spacing.md) + spacing.xl }]}
          >
            <View style={styles.card}>
              <Text style={[type.body, styles.aim]}>{t('mobile.scan.aim')}</Text>
              <Text style={[type.secondary, styles.aim]}>{hint}</Text>
            </View>
          </View>
        </View>
      )}
    </Modal>
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
    gap: spacing.xs,
    borderRadius: radii.card,
    backgroundColor: colors.floatingFill,
  },
  aim: { textAlign: 'center' },
});
