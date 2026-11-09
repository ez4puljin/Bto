import { Heart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StockWord, StoreProduct } from '../api/customer';
import type { CartLine } from '../cart/cart';
import { formatMnt, formatQty } from '../format/format';
import { cardPictures } from '../images/pictures';
import { useUnitWords } from '../shop/unit-words';
import { baseUnitOf, defaultUnitOf, packOf } from '../shop/units';
import { colors, fonts, spacing, type } from '../theme/tokens';
import { CardAdd, CardQty, DealBadge, NewBadge, StoreCardFrame } from '../ui/store-card-frame';
import { Text } from '../ui/text';
import { cardPriceOf } from './deals';
import { canOrder, STOCK_TONES } from './stock';

/**
 * What a product's stock says to the store: the word «Байгаа», «Цөөхөн үлдсэн», «Дууссан»
 * (ADR-0079 #4), or — when the office shows numbers and the server sent one (ADR-0173 #2) — the
 * number in the base unit: «73 ш» on a card, «Үлдэгдэл 73 ширхэг» on the product's page
 * (`page`). «Дууссан» stays a word either way.
 */
export function useStockText() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (
    product: Pick<StoreProduct, 'stock' | 'available' | 'units'>,
    { page = false }: { page?: boolean } = {},
  ): string => {
    const base = baseUnitOf(product.units);
    if (product.available === undefined || product.stock === 'OUT' || !base) {
      return t(`sales.stockWords.${product.stock}`);
    }
    const n = formatQty(product.available);
    return page
      ? t('mobile.product.stock', { n, unit: words(base).name })
      : t('mobile.shop.cardStock', { n, unit: words(base).short });
  };
}

/**
 * The stock on the boards' coloured pill with its dot, green, orange or red by the word
 * (ADR-0079 #4); `text` is the number when the office shows numbers (ADR-0173 #2). `large` is the
 * product page's.
 */
export function StockPill({
  stock,
  text,
  large = false,
}: {
  stock: StockWord;
  text?: string;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const tone = STOCK_TONES[stock];
  return (
    <View style={[styles.pill, large && styles.pillLarge, { backgroundColor: tone.background }]}>
      <View style={[styles.dot, large && styles.dotLarge, { backgroundColor: tone.dot }]} />
      <Text
        style={[large ? styles.pillTextLarge : styles.pillText, { color: tone.text }]}
        numberOfLines={1}
      >
        {text ?? t(`sales.stockWords.${stock}`)}
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

/** A discount program's badge (ADR-0092 #7), drawn by the card frame both apps share. */
export { DealBadge };

/** ♡ over a picture's top right corner: red and filled when the product is a favourite. */
export function FavouriteButton({
  on,
  label,
  onPress,
  size = 22,
}: {
  on: boolean;
  label: string;
  onPress: () => void;
  size?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={4}
      style={styles.heart}
    >
      <Heart
        size={size}
        strokeWidth={1.6}
        color={on ? colors.heart : colors.foreground}
        fill={on ? colors.heart : 'none'}
      />
    </Pressable>
  );
}

/**
 * A product card of «Bto300» everywhere (ADR-0092 #7 in the E-mart structure of ADR-0095): a white
 * card with a hairline, the whole picture with ♡ in its corner, then the badges (a program's
 * label, «ШИНЭ»), the name on one line, the pack, the price per base unit (the old one struck
 * through beside a deal price), the stock word (or number, ADR-0173 #2) with its dot and the cart
 * or the cart's quantity.
 * The cart adds one of the default unit; the card opens the product. `width` sets a row's card
 * (164 on the home's rows); a grid's card fills its column.
 */
export function CustomerProductCard({
  product,
  server,
  line,
  locked,
  onOpen,
  onAdd,
  onFavourite,
  width,
  pictureHeight = 164,
}: {
  product: StoreProduct;
  server: string;
  /** The product's line in the cart. */
  line: CartLine | undefined;
  /** A send is pending: the cart waits for its answer. */
  locked: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onFavourite: () => void;
  width?: number;
  pictureHeight?: number;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const packText = usePackText();
  const stockText = useStockText();
  const base = baseUnitOf(product.units);
  const price = cardPriceOf(product);
  const tone = STOCK_TONES[product.stock];
  const canAdd = canOrder(product, defaultUnitOf(product.units));
  const money = (amount: string) => t('pricing.money', { amount: formatMnt(amount) });
  return (
    <StoreCardFrame
      name={product.name}
      openLabel={t('mobile.shop.openProduct', { name: product.name })}
      pictures={cardPictures(product)}
      server={server}
      dim={product.stock === 'OUT'}
      onOpen={onOpen}
      {...(width !== undefined ? { width } : {})}
      pictureHeight={pictureHeight}
      corner={
        <FavouriteButton
          on={product.favourite}
          label={
            product.favourite
              ? t('mobile.customer.shop.favouriteRemove', { name: product.name })
              : t('mobile.customer.shop.favouriteAdd', { name: product.name })
          }
          onPress={onFavourite}
        />
      }
      badges={
        <>
          {product.deal ? <DealBadge deal={product.deal} /> : null}
          {product.isNew ? <NewBadge /> : null}
        </>
      }
      line={packText(product.units)}
      price={
        price
          ? {
              price: money(price.price),
              per: base ? t('mobile.shop.per', { unit: words(base).short }) : null,
              old: price.old
                ? {
                    text: money(price.old),
                    label: t('mobile.customer.card.oldPrice', { price: money(price.old) }),
                  }
                : null,
            }
          : null
      }
      noPrice={t('mobile.shop.noPrice')}
      stock={{ text: stockText(product), dot: tone.dot, color: tone.text }}
      action={
        locked ? null : line ? (
          <CardQty
            text={`${line.qty} ${words(line).short}`}
            label={t('mobile.shop.inCart', {
              name: product.name,
              qty: line.qty,
              unit: words(line).name,
            })}
            onPress={onOpen}
          />
        ) : canAdd ? (
          <CardAdd name={product.name} onPress={onAdd} />
        ) : null
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
  heart: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
