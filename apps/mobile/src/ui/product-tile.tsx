import { Decimal } from '@tugeel/shared/money';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Package, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { MAX_FONT_SCALE, Text } from './text';
import type { RepProduct } from '../api/rep';
import { lineOf } from '../cart/cart';
import { useAddOne } from '../shop/use-add';
import { useUnitWords } from '../shop/unit-words';
import { useSignedIn } from '../state/session';
import { useShop } from '../state/shop';
import { colors, radii, shadows, spacing, tabular, type } from '../theme/tokens';
import { usePriceParts } from './product-card';

/** A tile's width; a strip of tiles snaps every TILE_WIDTH + its gap. */
export const TILE_WIDTH = 132;

/**
 * A product in a horizontal strip (the home's «Шинэ бараа»): the picture with «+» or the cart's
 * quantity, the name and the base price. The tile opens the product; «+» adds one of its default
 * unit, the quantity opens the product to change it. Nothing is added while a send is pending.
 */
export function ProductTile({ product }: { product: RepProduct }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { server } = useSignedIn();
  const { cart, pending } = useShop();
  const add = useAddOne();
  const words = useUnitWords();
  const priceParts = usePriceParts();
  const { fontScale } = useWindowDimensions();
  // Two lines of the name at the phone's font size, so every tile's price sits on one line.
  const nameHeight = type.bodyStrong.lineHeight * 2 * Math.min(fontScale, MAX_FONT_SCALE);
  const price = priceParts(product);
  const line = lineOf(cart, product.id);
  const dim = new Decimal(product.available).lte(0);
  const open = () => router.push(`/product/${product.id}`);
  const uri = product.thumbUrl ? `${server}${product.thumbUrl}` : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.shop.openProduct', { name: product.name })}
      onPress={open}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={styles.picture}>
        {uri ? (
          <Image
            source={{ uri }}
            style={[styles.image, dim && styles.dim]}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={uri}
            transition={150}
          />
        ) : (
          <Package
            size={32}
            strokeWidth={1.4}
            color={colors.input}
            style={dim ? styles.dim : null}
          />
        )}
        {pending !== null ? null : line ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.shop.inCart', {
              name: product.name,
              qty: line.qty,
              unit: words(line).name,
            })}
            onPress={open}
            style={styles.qty}
          >
            <Text style={styles.qtyText} numberOfLines={1}>
              {`${line.qty} ${words(line).short}`}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.shop.add', { name: product.name })}
            onPress={() => add(product)}
            hitSlop={6}
            style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
          >
            <Plus size={16} strokeWidth={2.6} color={colors.primary} />
          </Pressable>
        )}
      </View>
      <Text style={[styles.name, { height: nameHeight }]} numberOfLines={2}>
        {product.name}
      </Text>
      {price ? (
        <View style={styles.priceRow}>
          <Text style={styles.price} numberOfLines={1}>
            {price.price}
          </Text>
          <Text style={type.caption}>{price.per}</Text>
        </View>
      ) : (
        <Text style={[type.secondary, styles.priceRow]} numberOfLines={1}>
          {t('mobile.shop.noPrice')}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { width: TILE_WIDTH },
  pressed: { opacity: 0.8 },
  picture: {
    width: TILE_WIDTH,
    height: TILE_WIDTH,
    borderRadius: 18,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  dim: { opacity: 0.55 },
  add: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.card,
    boxShadow: shadows.addButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPressed: { backgroundColor: colors.accent },
  qty: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    maxWidth: TILE_WIDTH - spacing.lg,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  qtyText: {
    ...type.chip,
    fontFamily: type.bodyStrong.fontFamily,
    color: colors.primaryForeground,
  },
  name: { ...type.bodyStrong, marginTop: spacing.sm },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: spacing.xs },
  price: { ...type.rowStrong, ...tabular },
});
