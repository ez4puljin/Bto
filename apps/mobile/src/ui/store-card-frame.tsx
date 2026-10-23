import { ShoppingCart } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { dealToneOf } from '../customer/deals';
import { colors, spacing, storeType, tabular } from '../theme/tokens';
import { CardPictures } from './card-pictures';
import { Text } from './text';

// The product card of both apps in the E-mart structure (ADR-0095 #4; the rep app since ADR-0100):
// a white card with a hairline, the whole picture, the badges, the name on one line, a grey line
// (the pack), the price per base unit, the stock with its dot and the cart or the cart's quantity.
// Each app fills it from its own product (src/customer/product-card.tsx, src/ui/product-card.tsx).

export interface CardPrice {
  /** «29,100₮». */
  price: string;
  /** « / ш», after the price in grey. */
  per: string | null;
  /** The price before a deal, struck through beside it, with its spoken label. */
  old?: { text: string; label: string } | null;
}

export interface CardStock {
  text: string;
  dot: string;
  color: string;
}

export function StoreCardFrame({
  name,
  openLabel,
  pictures,
  server,
  dim,
  corner,
  badges,
  line,
  price,
  noPrice,
  stock,
  action,
  onOpen,
  width,
  pictureHeight = 164,
}: {
  name: string;
  openLabel: string;
  pictures: string[];
  server: string;
  /** The picture dimmed: nothing left to order. */
  dim: boolean;
  /** Over the picture's top right corner (♡). */
  corner?: ReactNode;
  badges: ReactNode;
  /** The grey line under the name; a blank keeps the cards level. */
  line: string | null;
  price: CardPrice | null;
  noPrice: string;
  stock: CardStock;
  /** The bottom right: the cart's quantity or the cart button. */
  action: ReactNode;
  onOpen: () => void;
  width?: number;
  pictureHeight?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={openLabel}
      onPress={onOpen}
      style={[styles.card, width !== undefined ? { width } : styles.fill]}
    >
      <View style={[styles.picture, { height: pictureHeight }]}>
        <CardPictures
          urls={pictures}
          server={server}
          dim={dim}
          onPress={onOpen}
          fit="contain"
          dots="left"
        />
        {corner ? <View style={styles.corner}>{corner}</View> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.badges}>{badges}</View>
        <Text style={storeType.cardName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={storeType.cardPack} numberOfLines={1}>
          {line ?? ' '}
        </Text>
        {price ? (
          <View style={styles.priceRow}>
            <Text style={[storeType.cardPrice, tabular]} numberOfLines={1}>
              {price.price}
              {price.per ? <Text style={storeType.cardOld}>{` ${price.per}`}</Text> : null}
            </Text>
            {price.old ? (
              <Text
                style={[storeType.cardOld, styles.struck]}
                numberOfLines={1}
                accessibilityLabel={price.old.label}
              >
                {price.old.text}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={storeType.cardPack} numberOfLines={1}>
            {noPrice}
          </Text>
        )}
        <View style={styles.bottom}>
          <View style={styles.stock}>
            <View style={[styles.stockDot, { backgroundColor: stock.dot }]} />
            <Text style={[storeType.cardStock, { color: stock.color }]} numberOfLines={1}>
              {stock.text}
            </Text>
          </View>
          {action}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * A discount program's badge under a card's picture (ADR-0092 #7; the rep's cards since ADR-0100):
 * a promotion orange, a discount red; the server writes the label.
 */
export function DealBadge({ deal }: { deal: { kind: 'PROMOTION' | 'DISCOUNT'; label: string } }) {
  const promotion = dealToneOf(deal.kind) === 'promotion';
  return (
    <View style={[styles.dealBadge, promotion ? styles.promotion : styles.discount]}>
      <Text
        style={[storeType.badge, promotion ? styles.promotionText : styles.discountText]}
        numberOfLines={1}
      >
        {deal.label}
      </Text>
    </View>
  );
}

/** «ШИНЭ» in blue under a card's picture. */
export function NewBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.newBadge}>
      <Text style={[storeType.badge, styles.newText]}>{t('mobile.shop.new')}</Text>
    </View>
  );
}

/** The cart's quantity on a card («2 хайрц»): it opens the product to change it. */
export function CardQty({
  text,
  label,
  onPress,
}: {
  text: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.qty}
    >
      <Text style={storeType.badge} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

/** The cart button on a card: adds one of the default unit. */
export function CardAdd({ name, onPress }: { name: string; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('mobile.shop.add', { name })}
      onPress={onPress}
      hitSlop={6}
      style={styles.add}
    >
      <ShoppingCart size={22} strokeWidth={1.6} color={colors.foreground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.card,
    overflow: 'hidden',
  },
  fill: { flex: 1 },
  picture: {
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  corner: { position: 'absolute', top: 2, right: 2 },
  body: { paddingTop: 6, paddingHorizontal: 10, paddingBottom: 6, gap: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, minHeight: 20 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  struck: { textDecorationLine: 'line-through', flexShrink: 1 },
  bottom: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  stock: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexShrink: 1 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  newBadge: {
    height: 20,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    justifyContent: 'center',
    flexShrink: 1,
    backgroundColor: colors.newBadge,
  },
  newText: { textTransform: 'uppercase' },
  dealBadge: {
    height: 20,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
    justifyContent: 'center',
    flexShrink: 1,
  },
  promotion: { backgroundColor: colors.dealPromotion },
  promotionText: { color: colors.foreground },
  discount: { backgroundColor: colors.dealDiscount },
  discountText: { color: colors.primaryForeground },
  add: { width: 36, height: 36, marginRight: -7, alignItems: 'center', justifyContent: 'center' },
  qty: {
    height: 24,
    maxWidth: 76,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
});
