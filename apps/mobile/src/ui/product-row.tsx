import { Decimal } from '@tugeel/shared/money';
import { Image } from 'expo-image';
import { Package } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { RepProduct } from '../api/rep';
import { type Cart, type CartAction, qtyOf } from '../cart/cart';
import { formatMnt, packsOf } from '../format/format';
import { colors, radii, spacing, type } from '../theme/tokens';
import { Stepper } from './kit';

/** «2 хайрцаг 6 ш» from the base units free in the home warehouse. */
export function useStockText() {
  const { t } = useTranslation();
  return (product: RepProduct): string => {
    const parts = packsOf(
      product.available,
      product.units.map((unit) => ({ factor: unit.factorToBase, name: unit.uomName })),
    );
    return parts.length === 0
      ? t('mobile.shop.outOfStock')
      : t('mobile.shop.inStock', {
          stock: parts.map((part) => `${part.qty} ${part.name}`).join(' '),
        });
  };
}

export function addLine(product: RepProduct, unit: RepProduct['units'][number]) {
  return {
    productId: product.id,
    productUnitId: unit.id,
    sku: product.sku,
    name: product.name,
    uomName: unit.uomName,
    factorToBase: unit.factorToBase,
    isBase: unit.isBase,
    wholesale: unit.wholesale,
    thumbUrl: product.thumbUrl,
  };
}

/** A product of the shop: picture, name, code, each unit's price, the stock and − n + per unit. */
export function ProductRow({
  product,
  server,
  cart,
  dispatch,
  locked,
  onOpen,
}: {
  product: RepProduct;
  server: string;
  cart: Cart;
  dispatch: (action: CartAction) => void;
  /** A send is pending: the cart waits for its answer. */
  locked: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const stockText = useStockText();
  const out = new Decimal(product.available).lte(0);
  return (
    <View style={styles.row}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.top}>
        {product.thumbUrl ? (
          <Image source={{ uri: `${server}${product.thumbUrl}` }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.placeholder]}>
            <Package size={24} color={colors.muted} />
          </View>
        )}
        <View style={styles.text}>
          <Text style={type.bodyStrong} numberOfLines={2}>
            {product.name}
          </Text>
          <Text style={type.caption}>{product.sku}</Text>
          <Text style={[type.secondary, { color: out ? colors.destructive : colors.success }]}>
            {product.sellable ? stockText(product) : t('mobile.shop.notSellable')}
          </Text>
        </View>
      </Pressable>
      {product.units.map((unit) => (
        <View key={unit.id} style={styles.unit}>
          <Text style={[type.body, styles.price]}>
            {unit.wholesale
              ? t('mobile.shop.unitPrice', {
                  unit: unit.uomName,
                  price: t('pricing.money', { amount: formatMnt(unit.wholesale) }),
                })
              : t('mobile.shop.noPrice', { unit: unit.uomName })}
          </Text>
          {product.sellable && unit.wholesale && !locked ? (
            <Stepper
              label={unit.uomName}
              value={qtyOf(cart, unit.id)}
              onChange={(qty) =>
                qtyOf(cart, unit.id) === 0
                  ? dispatch({ type: 'add', line: addLine(product, unit), qty })
                  : dispatch({ type: 'setQty', productUnitId: unit.id, qty })
              }
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  top: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: radii.control, backgroundColor: colors.fill },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2 },
  unit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 40,
  },
  price: { flex: 1, fontVariant: ['tabular-nums'] },
});
