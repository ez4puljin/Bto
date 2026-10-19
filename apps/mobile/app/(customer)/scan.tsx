import { useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router';
import { Camera, Flashlight, FlashlightOff, Package, X } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { STORE_KEY } from '../../src/api/customer';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { capitalised } from '../../src/customer/shop';
import { formatMnt } from '../../src/format/format';
import { ScanGate } from '../../src/scan/scan-gate';
import { useUnitWords } from '../../src/shop/unit-words';
import { knownUnit } from '../../src/shop/units';
import { useCustomer } from '../../src/state/session';
import { colors, fonts, spacing, TOUCH, type } from '../../src/theme/tokens';
import { PillButton } from '../../src/ui/controls';
import { EmptyState, ProblemText } from '../../src/ui/kit';
import { Page } from '../../src/ui/layout';
import { Text } from '../../src/ui/text';

type StoreBarcode = components['schemas']['CustomerAppBarcode'];

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] as const;
const FRAME_HEIGHT = 220;
const FRAME_RADIUS = 28;
/** The dimmed page around the frame: a border wide enough to cover any phone. */
const DIM = 1600;

/**
 * «Баркод уншуулах» of «Bto300» (the Scan board, ADR-0079 #4): the camera dimmed around its frame
 * with the green line, close, the torch, and the hint; a read code shows the product on a card
 * («Уншлаа · хайрцгийн баркод», the name, the unit's price and the stock word) with «Хайрцгаар
 * нээх», which opens the product in the scanned unit over the camera (`?unit=&from=scan`). A code
 * the shop does not list says so.
 */
export default function StoreScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { session, server } = useCustomer();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const words = useUnitWords();
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate());
  const [torch, setTorch] = useState(false);
  const [looking, setLooking] = useState(false);
  const [found, setFound] = useState<{ code: string; scan: StoreBarcode } | null>(null);
  const [problem, setProblem] = useState<{ code: string; problem: AppProblem } | null>(null);

  // Back from the product: the card goes and the camera reads the next code.
  useFocusEffect(
    useCallback(() => {
      gate.current.reset();
      setFound(null);
      setProblem(null);
    }, []),
  );

  const onRead = async (raw: string) => {
    if (looking) return;
    const code = gate.current.accept(raw, Date.now());
    // The card already shows this code: the camera still sees it.
    if (!code || code === found?.code || code === problem?.code) return;
    setLooking(true);
    try {
      const result = await session.client.GET('/api/v1/customer-app/barcodes/{code}', {
        params: { path: { code } },
      });
      if (result.data) {
        // The product's page opens at once with what the scan brought.
        queryClient.setQueryData(
          [...STORE_KEY, 'products', 'of', String(result.data.product.id)],
          [result.data.product],
        );
        setProblem(null);
        setFound({ code, scan: result.data });
      } else {
        setFound(null);
        setProblem({ code, problem: problemOf(result.error, result.response.status) });
      }
    } catch {
      setFound(null);
      setProblem({ code, problem: NETWORK });
    } finally {
      setLooking(false);
    }
  };

  const again = () => {
    gate.current.reset();
    setProblem(null);
    setFound(null);
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

  const frameWidth = Math.min(290, width - spacing.xxl * 2);
  const frameLeft = (width - frameWidth) / 2;
  const frameTop = insets.top + Math.max(130, Math.round((height - insets.top) * 0.3));

  const scanned = found?.scan;
  const unit = scanned?.product.units.find((entry) => entry.id === scanned.productUnitId);
  const known = unit ? knownUnit(unit.uomCode) : null;
  const readLine = !unit
    ? ''
    : unit.isBase
      ? t('mobile.customer.scan.read')
      : known
        ? t(`mobile.customer.scan.readPack.${known}`)
        : t('mobile.customer.scan.readPackOther', { unit: unit.uomName });
  const instrumental = unit && !unit.isBase ? words(unit).instrumental : null;
  const notFound = problem?.problem.status === 404;

  return (
    <View style={styles.root}>
      {focused ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
          onBarcodeScanned={looking ? undefined : (result) => void onRead(result.data)}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          styles.dim,
          {
            left: frameLeft - DIM,
            top: frameTop - DIM,
            width: frameWidth + DIM * 2,
            height: FRAME_HEIGHT + DIM * 2,
          },
        ]}
      />
      <View
        pointerEvents="none"
        style={[styles.frame, { left: frameLeft, top: frameTop, width: frameWidth }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.line,
          {
            left: frameLeft + spacing.lg,
            width: frameWidth - spacing.lg * 2,
            top: frameTop + FRAME_HEIGHT / 2 - 1,
          },
        ]}
      />

      <View style={[styles.bar, { top: insets.top + spacing.md }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={() => router.back()}
          style={styles.round}
        >
          <X size={22} strokeWidth={2.4} color={colors.primaryForeground} />
        </Pressable>
        <Text accessibilityRole="header" style={styles.title} numberOfLines={1}>
          {t('mobile.scan.title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            torch ? t('mobile.customer.scan.torchOff') : t('mobile.customer.scan.torchOn')
          }
          accessibilityState={{ selected: torch }}
          onPress={() => setTorch(!torch)}
          style={[styles.round, torch && styles.roundOn]}
        >
          {torch ? (
            <FlashlightOff size={21} strokeWidth={2} color={colors.foreground} />
          ) : (
            <Flashlight size={21} strokeWidth={2} color={colors.primaryForeground} />
          )}
        </Pressable>
      </View>
      <Text style={[styles.hint, { top: frameTop - 44 }]}>{t('mobile.customer.scan.hint')}</Text>

      {looking || found || problem ? (
        <View style={[styles.card, { bottom: Math.max(insets.bottom, spacing.md) + 28 }]}>
          {looking ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.primary} />
              <Text style={type.body}>{t('common.loading')}</Text>
            </View>
          ) : scanned && unit ? (
            <>
              <View style={styles.row}>
                <View style={styles.thumb}>
                  {scanned.product.thumbUrl ? (
                    <Image
                      source={{ uri: `${server}${scanned.product.thumbUrl}` }}
                      style={styles.image}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                      recyclingKey={scanned.product.thumbUrl}
                    />
                  ) : (
                    <Package size={26} strokeWidth={1.5} color={colors.input} />
                  )}
                </View>
                <View style={styles.grow}>
                  <Text style={styles.read}>{readLine}</Text>
                  <Text style={type.heading} numberOfLines={2}>
                    {scanned.product.name}
                  </Text>
                  <Text style={type.secondary} numberOfLines={1}>
                    {[
                      unit.wholesale
                        ? t('mobile.product.pricePer', {
                            amount: formatMnt(unit.wholesale),
                            unit: words(unit).name,
                          })
                        : t('mobile.product.noPrice'),
                      t(`sales.stockWords.${scanned.product.stock}`),
                    ].join(' · ')}
                  </Text>
                </View>
              </View>
              <PillButton
                title={
                  instrumental
                    ? t('mobile.customer.scan.openIn', { unit: capitalised(instrumental) })
                    : t('mobile.customer.scan.open')
                }
                onPress={() =>
                  router.push(
                    `/product/${scanned.product.id}?unit=${scanned.productUnitId}&from=scan`,
                  )
                }
              />
            </>
          ) : problem ? (
            <>
              {notFound ? (
                <Text style={[type.heading, styles.center]}>
                  {t('mobile.customer.scan.notFound')}
                </Text>
              ) : (
                <ProblemText problem={problem.problem} style={styles.flush} />
              )}
              <PillButton
                title={t('mobile.scan.again')}
                variant="soft"
                height={48}
                onPress={again}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.foreground },
  ask: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  dim: {
    position: 'absolute',
    borderWidth: DIM,
    borderRadius: FRAME_RADIUS + DIM,
    borderColor: colors.popupBackdrop,
  },
  frame: {
    position: 'absolute',
    height: FRAME_HEIGHT,
    borderRadius: FRAME_RADIUS,
    borderWidth: 3,
    borderColor: colors.primaryForeground,
  },
  line: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: colors.tint.green },
  bar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
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
  title: {
    flex: 1,
    ...type.heading,
    textAlign: 'center',
    color: colors.primaryForeground,
  },
  hint: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    ...type.row,
    textAlign: 'center',
    color: colors.primaryForeground,
  },
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: 24,
    backgroundColor: colors.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  grow: { flex: 1 },
  read: { ...type.chip, fontFamily: fonts.semibold, color: colors.success },
  center: { textAlign: 'center' },
  flush: { marginTop: 0 },
});
