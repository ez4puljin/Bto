import { Star } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StockWord, StoreProduct } from '../api/customer';
import type { CartLine } from '../cart/cart';
import { formatQty } from '../format/format';
import { useUnitWords } from '../shop/unit-words';
import { baseUnitOf, defaultUnitOf, packOf } from '../shop/units';
import { colors, fonts, spacing, TOUCH, type } from '../theme/tokens';
import { ProductCardFrame } from '../ui/product-card';
import { Text } from '../ui/text';
import { canOrder, STOCK_TONES } from './stock';

/**
 * «Байгаа», «Цөөхөн үлдсэн», «Дууссан» on the boards' coloured pill with its dot (ADR-0079 #4): a
 * store sees the word, never the number. `large` is the product page's.
 */
export function StockPill({ stock, large = false }: { stock: StockWord; large?: boolean }) {
  const { t } = useTranslation();
  const tone = STOCK_TONES[stock];
  return (
    <View style={[styles.pill, large && styles.pillLarge, { backgroundColor: tone.background }]}>
      <View style={[styles.dot, large && styles.dotLarge, { backgroundColor: tone.dot }]} />
      <Text
        style={[large ? styles.pillTextLarge : styles.pillText, { color: tone.text }]}
        numberOfLines={1}
      >
        {t(`sales.stockWords.${stock}`)}
      </Text>
    </View>
  );
}

/**
 * The pack a product is told by: «хайрцагт 6» on a card, «хайрцагт 24 ширхэг» on its page (with
 * the base unit), «1 уут = 10 ш» for a pack the app has no word forms for; null without a pack.
 */
export function usePackText() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (
    units: StoreProduct['units'],
    { withBase = false }: { withBase?: boolean } = {},
  ): string | null => {
    const pack = packOf(units);
    const base = baseUnitOf(units);
    if (!pack || !base) return null;
    const packWords = words(pack);
    const n = formatQty(pack.factorToBase);
    if (!packWords.dative) {
      return t('mobile.shop.packOf', { unit: packWords.name, n, base: words(base).short });
    }
    return withBase
      ? t('mobile.customer.product.packIn', { unit: packWords.dative, n, base: words(base).name })
      : t('mobile.shop.packIn', { unit: packWords.dative, n });
  };
}

/**
 * A product of the store's grid (the Shop board, ADR-0079 #13): the rep's card with ★ over the
 * picture's corner and the stock word with the pack under the price. «+» is offered while the
 * product can be ordered in its default unit; a «Дууссан» picture fades.
 */
export function CustomerProductCard({
  product,
  server,
  line,
  locked,
  onOpen,
  onAdd,
  onStar,
}: {
  product: StoreProduct;
  server: string;
  /** The product's line in the cart. */
  line: CartLine | undefined;
  /** A send is pending: the cart waits for its answer. */
  locked: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onStar: () => void;
}) {
  const { t } = useTranslation();
  const packText = usePackText();
  const pack = packText(product.units);
  return (
    <ProductCardFrame
      product={product}
      server={server}
      line={line}
      locked={locked}
      canAdd={canOrder(product, defaultUnitOf(product.units))}
      dim={product.stock === 'OUT'}
      onOpen={onOpen}
      onAdd={onAdd}
      corner={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            product.favourite
              ? t('mobile.customer.shop.starRemove', { name: product.name })
              : t('mobile.customer.shop.starAdd', { name: product.name })
          }
          accessibilityState={{ selected: product.favourite }}
          onPress={onStar}
          style={styles.star}
        >
          <View style={styles.starDisc}>
            <Star
              size={17}
              strokeWidth={2}
              color={product.favourite ? colors.tint.amber : colors.muted}
              fill={product.favourite ? colors.tint.amber : 'none'}
            />
          </View>
        </Pressable>
      }
      footer={
        <View style={styles.footer}>
          <StockPill stock={product.stock} />
          {pack ? (
            <Text style={type.caption} numberOfLines={1}>
              {pack}
            </Text>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    borderRadius: 11,
    flexShrink: 1,
  },
  pillLarge: { height: 26, gap: 6, paddingHorizontal: 10, borderRadius: 13 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotLarge: { width: 8, height: 8 },
  pillText: { ...type.caption, fontFamily: fonts.semibold },
  pillTextLarge: { ...type.chip, fontFamily: fonts.semibold },
  star: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  starDisc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.floatingFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: spacing.xs,
    marginTop: spacing.xs,
  },
});
