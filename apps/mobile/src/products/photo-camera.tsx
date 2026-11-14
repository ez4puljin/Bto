import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { Camera, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, type } from '../theme/tokens';
import { PillButton } from '../ui/controls';
import { EmptyState } from '../ui/kit';
import { Page } from '../ui/layout';
import { StoreHeader } from '../ui/store-header';
import { Text } from '../ui/text';
import { pictureSizeFor } from './camera';

/**
 * The camera of «Бараа нэмэх» (ADR-0199): one press, one photo of the product (its front, back,
 * label, barcode), as many as the reading takes; the last one shows in the corner and «Болсон»
 * goes back to the form with them. The photos stay files of the camera's cache until they are
 * uploaded. The permission flow is the scanner's (`transfers/scan-sheet.tsx`).
 */
export function PhotoCamera({
  visible,
  taken,
  room,
  onPhoto,
  onClose,
}: {
  visible: boolean;
  /** Photos taken so far, the newest last: its picture is the corner's. */
  taken: readonly string[];
  /** How many more the form takes; at 0 the shutter is off. */
  room: number;
  onPhoto: (uri: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [size, setSize] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const last = taken[taken.length - 1];

  const onReady = async () => {
    try {
      setSize(pictureSizeFor((await camera.current?.getAvailablePictureSizesAsync()) ?? []));
    } catch {
      // The camera's own size is kept: the server scales the photo anyway.
    }
  };

  const shoot = async () => {
    if (busy || room <= 0) return;
    setBusy(true);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.7 });
      if (photo?.uri) onPhoto(photo.uri);
    } catch {
      // A photo that failed is simply not there; the person presses again.
    } finally {
      setBusy(false);
    }
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
          <StoreHeader title={t('mobile.productNew.camera.title')} onBack={onClose} right={null} />
          <View style={styles.ask}>
            <EmptyState
              icon={<Camera size={48} strokeWidth={1.5} color={colors.input} />}
              title={t('mobile.scan.permission')}
              hint={t('mobile.productNew.camera.permissionHint')}
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
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing="back"
              pictureSize={size}
              onCameraReady={() => void onReady()}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
            onPress={onClose}
            hitSlop={spacing.xs}
            style={[styles.close, { top: insets.top + spacing.md }]}
          >
            <X size={20} strokeWidth={2.6} color={colors.foreground} />
          </Pressable>
          <View style={[styles.hint, { top: insets.top + spacing.md }]}>
            <Text style={[type.secondary, styles.hintText]}>
              {t('mobile.productNew.camera.hint')}
            </Text>
          </View>
          <View
            style={[
              styles.bar,
              { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
            ]}
          >
            <View style={styles.side}>
              {last ? (
                <View>
                  <Image source={{ uri: last }} style={styles.last} contentFit="cover" />
                  <View style={styles.count}>
                    <Text style={styles.countText}>{taken.length}</Text>
                  </View>
                </View>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.productNew.camera.shoot')}
              accessibilityState={{ disabled: busy || room <= 0, busy }}
              disabled={busy || room <= 0}
              onPress={() => void shoot()}
              style={({ pressed }) => [
                styles.shutter,
                (pressed || busy || room <= 0) && styles.shutterDown,
              ]}
            >
              <View style={styles.shutterCore} />
            </Pressable>
            <View style={styles.side}>
              {taken.length > 0 ? (
                <PillButton
                  title={t('mobile.productNew.camera.done')}
                  variant="white"
                  height={44}
                  onPress={onClose}
                />
              ) : null}
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const SHUTTER = 72;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.foreground },
  ask: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
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
  hint: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg + 36 + spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.field,
    backgroundColor: colors.floatingFill,
  },
  hintText: { color: colors.foreground },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  side: { flex: 1, alignItems: 'center' },
  last: { width: 56, height: 56, borderRadius: radii.control, backgroundColor: colors.fill },
  count: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { ...type.chip, color: colors.primaryForeground },
  shutter: {
    width: SHUTTER,
    height: SHUTTER,
    borderRadius: SHUTTER / 2,
    borderWidth: 4,
    borderColor: colors.primaryForeground,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDown: { opacity: 0.5 },
  shutterCore: {
    width: SHUTTER - 16,
    height: SHUTTER - 16,
    borderRadius: (SHUTTER - 16) / 2,
    backgroundColor: colors.primaryForeground,
  },
});
