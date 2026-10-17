import { Decimal } from '@tugeel/shared/money';
import { Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { CardPictures } from './card-pictures';
import { Text } from './text';
import type { RepProduct } from '../api/rep';
import type { CartLine } from '../cart/cart';
import { formatMnt, formatQty } from '../format/format';
import { cardPictures } from '../images/pictures';
import { useUnitWords } from '../shop/unit-words';
import { baseUnitOf, packOf } from '../shop/units';
import { colors, fonts, radii, shadows, spacing, tabular, type } from '../theme/tokens';

/** «Үлдэгдэл 73 · хайрцагт 6», «Үлдэгдэл дууссан», «Захиалах боломжгүй». */
export function useStockLine() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (product: RepProduct): { text: string; out: boolean } => {
    if (!product.sellable) return { text: t('mobile.shop.notSellable'), out: true };
    if (new Decimal(product.available).lte(0))
      return { text: t('mobile.shop.outOfStock'), out: true };
    const stock = t('mobile.shop.stock', { n: formatQty(product.available) });
    const pack = packOf(product.units);
    const base = baseUnitOf(product.units);
    if (!pack || !base) return { text: stock, out: false };
    const packWords = words(pack);
    const n = formatQty(pack.factorToBase);
    const packText = packWords.dative
      ? t('mobile.shop.packIn', { unit: packWords.dative, n })
      : t('mobile.shop.packOf', { unit: packWords.name, n, base: words(base).short });
    return { text: `${stock} · ${packText}`, out: false };
  };
}

/** «29,100₮ / ш»: one base unit in whole packs, as the server prices it. */
export function usePriceParts() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (product: RepProduct): { price: string; per: string } | null => {
    const base = baseUnitOf(product.units);
    if (product.basePrice === null || !base) return null;
    return {
      price: t('pricing.money', { amount: formatMnt(product.basePrice) }),
      per: t('mobile.shop.per', { unit: words(base).short }),
    };
  };
}

/**
 * A product of the shop's grid (ADR-0068 #3): its pictures (swiped when it has several) with «Шинэ»
 * and the cart's quantity or «+», the name, the code, the base price and the stock. The card opens
 * the product; «+» adds one of its default unit, the quantity opens the product to change it.
 */
export function ProductCard({
  product,
  server,
  line,
  locked,
  onOpen,
  onAdd,
}: {
  product: RepProduct;
  server: string;
  /** The product's line in the cart. */
  line: CartLine | undefined;
  /** A send is pending: the cart waits for its answer. */
  locked: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const stockLine = useStockLine();
  const priceParts = usePriceParts();
  const stock = stockLine(product);
  const price = priceParts(product);
  const dim = new Decimal(product.available).lte(0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.shop.openProduct', { name: product.name })}
      onPress={onOpen}
      style={styles.card}
    >
      <View style={styles.picture}>
        <CardPictures urls={cardPictures(product)} server={server} dim={dim} onPress={onOpen} />
        {product.isNew ? (
          <View style={styles.newBadge}>
            <Text style={styles.newText}>{t('mobile.shop.new')}</Text>
          </View>
        ) : null}
        {locked ? null : line ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.shop.inCart', {
              name: product.name,
              qty: line.qty,
              unit: words(line).name,
            })}
            onPress={onOpen}
            style={styles.qty}
          >
            <Text style={styles.qtyText}>{`${line.qty} ${words(line).name}`}</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('mobile.shop.add', { name: product.name })}
            onPress={onAdd}
            hitSlop={6}
            style={styles.add}
          >
            <Plus size={18} strokeWidth={2.6} color={colors.primary} />
          </Pressable>
        )}
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={type.caption}>{product.sku}</Text>
        {price ? (
          <View style={styles.priceRow}>
            <Text style={styles.price}>{price.price}</Text>
            <Text style={type.secondary}>{price.per}</Text>
          </View>
        ) : (
          <Text style={[type.secondary, styles.priceRow]}>{t('mobile.shop.noPrice')}</Text>
        )}
        <Text style={[type.caption, stock.out && styles.out]} numberOfLines={1}>
          {stock.text}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, gap: spacing.sm },
  picture: {
    aspectRatio: 1,
    borderRadius: radii.tile,
    backgroundColor: colors.imageFill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    height: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: 11,
    backgroundColor: colors.floatingFill,
    justifyContent: 'center',
  },
  newText: { ...type.secondary, fontFamily: fonts.semibold, color: colors.link },
  add: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.card,
    boxShadow: shadows.addButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  qtyText: { ...type.chip, fontFamily: fonts.semibold, color: colors.primaryForeground },
  text: { gap: 1, paddingHorizontal: 2 },
  name: type.bodyStrong,
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3, marginTop: 5 },
  price: { ...type.heading, fontFamily: fonts.bold, ...tabular },
  out: { color: colors.destructive, fontFamily: fonts.medium },
});
