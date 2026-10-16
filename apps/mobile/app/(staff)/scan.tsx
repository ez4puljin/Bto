import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Camera, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { type AppProblem, NETWORK, problemOf } from '../../src/api/problem';
import { useProductsOf } from '../../src/api/rep';
import { qtyOf } from '../../src/cart/cart';
import { formatMnt } from '../../src/format/format';
import { ScanGate } from '../../src/scan/scan-gate';
import { useSignedIn } from '../../src/state/session';
import { useShop } from '../../src/state/shop';
import { colors, radii, spacing, type } from '../../src/theme/tokens';
import { Button, Card, EmptyState, ProblemText, Screen } from '../../src/ui/kit';
import { addLine, useStockText } from '../../src/ui/product-row';

const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'itf14', 'code128'] as const;

type Hit = { productId: number; productUnitId: number } | { problem: AppProblem };

/** The camera finds a product by its barcode; the scanned unit goes into the cart (ADR-0006 #4). */
export default function ScanScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session } = useSignedIn();
  const { cart, dispatch, pending } = useShop();
  const stockText = useStockText();
  const [permission, requestPermission] = useCameraPermissions();
  const gate = useRef(new ScanGate());
  const [looking, setLooking] = useState(false);
  const [hit, setHit] = useState<Hit | null>(null);
  const found = useProductsOf(hit && 'productId' in hit ? [hit.productId] : []);
  const product = found.data?.[0];
  const unit =
    product && hit && 'productUnitId' in hit
      ? product.units.find((entry) => entry.id === hit.productUnitId)
      : undefined;

  const onRead = async (raw: string) => {
    if (looking || hit) return;
    const code = gate.current.accept(raw, Date.now());
    if (!code) return;
    setLooking(true);
    try {
      const result = await session.client.GET('/api/v1/barcodes/{code}', {
        params: { path: { code } },
      });
      setHit(
        result.data
          ? { productId: result.data.product.id, productUnitId: result.data.unit.id }
          : { problem: problemOf(result.error, result.response.status) },
      );
    } catch {
      setHit({ problem: NETWORK });
    } finally {
      setLooking(false);
    }
  };

  const again = () => {
    gate.current.reset();
    setHit(null);
  };

  if (!permission) return <Screen />;
  if (!permission.granted) {
    return (
      <Screen bottom style={styles.center}>
        <EmptyState
          icon={<Camera size={48} color={colors.muted} />}
          title={t('mobile.scan.permission')}
          hint={t('mobile.scan.permissionHint')}
        />
        {permission.canAskAgain ? (
          <Button title={t('mobile.scan.allow')} onPress={() => void requestPermission()} />
        ) : (
          <Button
            title={t('mobile.scan.openSettings')}
            onPress={() => void Linking.openSettings()}
          />
        )}
        <Button variant="ghost" title={t('common.close')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={hit ? undefined : (result) => void onRead(result.data)}
      />
      <View style={styles.frame} pointerEvents="none" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={() => router.back()}
        style={styles.close}
      >
        <X size={26} color={colors.primaryForeground} />
      </Pressable>
      <View style={styles.panel}>
        {!hit ? (
          <Card>
            <Text style={[type.body, styles.centerText]}>{t('mobile.scan.aim')}</Text>
          </Card>
        ) : 'problem' in hit ? (
          <Card>
            <ProblemText problem={hit.problem} />
            <Button title={t('mobile.scan.again')} onPress={again} />
          </Card>
        ) : product && unit ? (
          <Card>
            <Text style={type.heading}>{product.name}</Text>
            <Text style={type.secondary}>
              {`${product.sku} · ${unit.uomName} · ${
                unit.wholesale
                  ? t('pricing.money', { amount: formatMnt(unit.wholesale) })
                  : t('mobile.shop.noPrice', { unit: unit.uomName })
              }`}
            </Text>
            <Text style={type.secondary}>
              {product.sellable ? stockText(product) : t('mobile.shop.notSellable')}
            </Text>
            {product.sellable && unit.wholesale && pending === null ? (
              <Button
                title={t('mobile.scan.add', { unit: unit.uomName, n: qtyOf(cart, unit.id) + 1 })}
                onPress={() => {
                  dispatch({ type: 'add', line: addLine(product, unit), qty: 1 });
                  again();
                }}
              />
            ) : null}
            <Button variant="secondary" title={t('mobile.scan.again')} onPress={again} />
          </Card>
        ) : (
          <Card>
            <Text style={type.body}>
              {found.isLoading ? t('common.loading') : t('mobile.shop.gone')}
            </Text>
            <Button variant="secondary" title={t('mobile.scan.again')} onPress={again} />
          </Card>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  center: { justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  centerText: { textAlign: 'center' },
  frame: {
    position: 'absolute',
    top: '28%',
    left: '12%',
    right: '12%',
    height: 160,
    borderRadius: radii.card,
    borderWidth: 3,
    borderColor: colors.primaryForeground,
  },
  close: {
    position: 'absolute',
    top: 48,
    right: spacing.lg,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxl },
});
