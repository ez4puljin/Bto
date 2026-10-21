import { Heart, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import type { StockWord, StoreDeal, StoreProduct } from '../api/customer';
import type { CartLine } from '../cart/cart';
import { formatMnt, formatQty } from '../format/format';
import { cardPictures } from '../images/pictures';
import { useUnitWords } from '../shop/unit-words';
import { baseUnitOf, defaultUnitOf, packOf } from '../shop/units';
import { colors, fonts, radii, spacing, tabular, TOUCH, type } from '../theme/tokens';
import { CardPictures } from '../ui/card-pictures';
import { Text } from '../ui/text';
import { cardPriceOf, dealToneOf } from './deals';
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

/** A discount program's badge (ADR-0092 #7): a promotion orange, a discount red. */
export function DealBadge({ deal }: { deal: Pick<StoreDeal, 'kind' | 'label'> }) {
  const promotion = dealToneOf(deal.kind) === 'promotion';
  return (
    <View style={[styles.badge, promotion ? styles.promotion : styles.discount]}>
      <Text
        style={[styles.badgeText, promotion ? styles.promotionText : styles.discountText]}
        numberOfLines={1}
      >
        {deal.label}
      </Text>
    </View>
  );
}

/** «Шинэ» in blue. */
export function NewBadge() {
  const { t } = useTranslation();
  return (
    <View style={[styles.badge, styles.newBadge]}>
      <Text style={[styles.badgeText, styles.discountText]}>{t('mobile.shop.new')}</Text>
    </View>
  );
}

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
      style={styles.heart}
    >
      <Heart
        size={size}
        strokeWidth={1.9}
        color={on ? colors.heart : colors.muted}
        fill={on ? colors.heart : 'none'}
      />
    </Pressable>
  );
}

/**
 * A product card of «Bto300» everywhere (the Main, SectionList, Category and Shop boards, ADR-0092
 * #7): the picture with ♡ and the badges, the name in two lines, the pack, the price per base unit
 * (the old one struck through under a deal price), the stock word with its dot, and «+» or the
 * cart's quantity. «+» adds one of the default unit; the card opens the product. `width` sets a
 * row's card (152 on the home's rows); a grid's card fills its column.
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
  pictureHeight = 140,
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
  const pack = packText(product.units);
  const base = baseUnitOf(product.units);
  const price = cardPriceOf(product);
  const tone = STOCK_TONES[product.stock];
  const out = product.stock === 'OUT';
  const canAdd = canOrder(product, defaultUnitOf(product.units));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.shop.openProduct', { name: product.name })}
      onPress={onOpen}
      style={[styles.card, width !== undefined ? { width } : styles.fill]}
    >
      <View style={[styles.picture, { height: pictureHeight }]}>
        <CardPictures
          urls={cardPictures(product)}
          server={server}
          dim={out}
          onPress={onOpen}
          fit="contain"
          dots="left"
        />
        <View style={styles.corner}>
          <FavouriteButton
            on={product.favourite}
            label={
              product.favourite
                ? t('mobile.customer.shop.favouriteRemove', { name: product.name })
                : t('mobile.customer.shop.favouriteAdd', { name: product.name })
            }
            onPress={onFavourite}
          />
        </View>
        {product.deal || product.isNew ? (
          <View style={styles.badges} pointerEvents="none">
            {product.deal ? <DealBadge deal={product.deal} /> : null}
            {product.isNew ? <NewBadge /> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={type.secondary} numberOfLines={1}>
          {pack ?? ' '}
        </Text>
        <View style={styles.bottom}>
          <View style={styles.grow}>
            {price?.old ? (
              <Text
                style={styles.old}
                numberOfLines={1}
                accessibilityLabel={t('mobile.customer.card.oldPrice', {
                  price: t('pricing.money', { amount: formatMnt(price.old) }),
                })}
              >
                {t('pricing.money', { amount: formatMnt(price.old) })}
              </Text>
            ) : null}
            {price ? (
              <Text style={styles.price} numberOfLines={1}>
                {t('pricing.money', { amount: formatMnt(price.price) })}
                {base ? (
                  <Text style={styles.per}>
                    {` ${t('mobile.shop.per', { unit: words(base).short })}`}
                  </Text>
                ) : null}
              </Text>
            ) : (
              <Text style={type.secondary} numberOfLines={1}>
                {t('mobile.shop.noPrice')}
              </Text>
            )}
            <View style={styles.stock}>
              <View style={[styles.stockDot, { backgroundColor: tone.dot }]} />
              <Text style={[styles.stockText, { color: tone.text }]} numberOfLines={1}>
                {t(`sales.stockWords.${product.stock}`)}
              </Text>
            </View>
          </View>
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
              <Text style={styles.qtyText} numberOfLines={1}>
                {`${line.qty} ${words(line).short}`}
              </Text>
            </Pressable>
          ) : canAdd ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('mobile.shop.add', { name: product.name })}
              onPress={onAdd}
              hitSlop={6}
              style={styles.add}
            >
              <Plus size={18} strokeWidth={2.6} color={colors.primaryForeground} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
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
  badge: {
    height: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: 11,
    justifyContent: 'center',
    flexShrink: 1,
  },
  badgeText: { ...type.secondary, fontFamily: fonts.bold },
  promotion: { backgroundColor: colors.dealPromotion },
  promotionText: { color: colors.foreground },
  discount: { backgroundColor: colors.dealDiscount },
  discountText: { color: colors.primaryForeground },
  newBadge: { backgroundColor: colors.newBadge },
  heart: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  picture: {
    backgroundColor: colors.imageFill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  corner: { position: 'absolute', top: 0, right: 0 },
  badges: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  body: { paddingTop: spacing.sm, paddingHorizontal: 10, paddingBottom: 10, gap: 2 },
  name: { ...type.bodyStrong, minHeight: 38 },
  bottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
    marginTop: 6,
  },
  grow: { flex: 1, minWidth: 0 },
  old: { ...type.secondary, textDecorationLine: 'line-through' },
  price: { ...type.heading, fontFamily: fonts.bold, ...tabular },
  per: { ...type.secondary, fontFamily: fonts.medium },
  stock: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 1 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  stockText: { ...type.caption, fontFamily: fonts.semibold },
  add: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: {
    height: 32,
    maxWidth: 76,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  qtyText: { ...type.chip, fontFamily: fonts.semibold, color: colors.primaryForeground },
});
