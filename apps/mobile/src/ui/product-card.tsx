import { Decimal } from '@tugeel/shared/money';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { CardAdd, CardQty, NewBadge, StoreCardFrame } from './store-card-frame';
import type { RepProduct } from '../api/rep';
import type { CartLine } from '../cart/cart';
import { formatMnt, formatQty } from '../format/format';
import { cardPictures } from '../images/pictures';
import { type UnitWords, useUnitWords } from '../shop/unit-words';
import { baseUnitOf, packOf, type UnitLike } from '../shop/units';
import { colors } from '../theme/tokens';

/** «хайрцагт 6» (or «1 уут = 10 ш» without word forms); null without a pack. */
function packTextOf(
  units: readonly UnitLike[],
  words: (unit: UnitLike) => UnitWords,
  t: TFunction,
): string | null {
  const pack = packOf(units);
  const base = baseUnitOf(units);
  if (!pack || !base) return null;
  const packWords = words(pack);
  const n = formatQty(pack.factorToBase);
  return packWords.dative
    ? t('mobile.shop.packIn', { unit: packWords.dative, n })
    : t('mobile.shop.packOf', { unit: packWords.name, n, base: words(base).short });
}

/**
 * «Үлдэгдэл 73 · хайрцагт 6», «Үлдэгдэл дууссан», «Захиалах боломжгүй» (`text`); `count` is the
 * card's short form beside its cart («73 ш», «Дууссан», «Боломжгүй»): a card is narrow on a 360 dp
 * phone, and the pack has its own line there.
 */
export function useStockLine() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (product: RepProduct): { text: string; count: string; out: boolean } => {
    if (!product.sellable) {
      return { text: t('mobile.shop.notSellable'), count: t('mobile.shop.cardBlocked'), out: true };
    }
    if (new Decimal(product.available).lte(0)) {
      return { text: t('mobile.shop.outOfStock'), count: t('mobile.shop.cardOut'), out: true };
    }
    const n = formatQty(product.available);
    const stock = t('mobile.shop.stock', { n });
    const base = baseUnitOf(product.units);
    const count = base ? t('mobile.shop.cardStock', { n, unit: words(base).short }) : stock;
    const pack = packTextOf(product.units, words, t);
    return { text: pack ? `${stock} · ${pack}` : stock, count, out: false };
  };
}

/** «29,100₮ / ш»: one base unit in whole packs, as the server prices it (either app's product). */
export function usePriceParts() {
  const { t } = useTranslation();
  const words = useUnitWords();
  return (product: {
    basePrice: string | null;
    units: readonly UnitLike[];
  }): { price: string; per: string } | null => {
    const base = baseUnitOf(product.units);
    if (product.basePrice === null || !base) return null;
    return {
      price: t('pricing.money', { amount: formatMnt(product.basePrice) }),
      per: t('mobile.shop.per', { unit: words(base).short }),
    };
  };
}

/**
 * A product of the rep's grid and rows, drawn as «Bto300»'s card (ADR-0100 on ADR-0068 #3): the
 * pictures, «ШИНЭ», the name, the code with the pack, the base price, the stock count (red when
 * nothing is left or it cannot be ordered) and the cart's quantity or the cart. The card opens the
 * product; the cart adds one of its default unit, the quantity opens the product to change it.
 */
export function ProductCard({
  product,
  server,
  line,
  locked,
  onOpen,
  onAdd,
  width,
  pictureHeight,
}: {
  product: RepProduct;
  server: string;
  /** The product's line in the cart. */
  line: CartLine | undefined;
  /** A send is pending: the cart waits for its answer. */
  locked: boolean;
  onOpen: () => void;
  onAdd: () => void;
  /** A row's card (164 on the home); a grid's fills its column. */
  width?: number;
  pictureHeight?: number;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const priceParts = usePriceParts();
  const price = priceParts(product);
  const stock = useStockLine()(product);
  const pack = packTextOf(product.units, words, t);
  return (
    <StoreCardFrame
      name={product.name}
      openLabel={t('mobile.shop.openProduct', { name: product.name })}
      pictures={cardPictures(product)}
      server={server}
      dim={stock.out}
      onOpen={onOpen}
      {...(width !== undefined ? { width } : {})}
      {...(pictureHeight !== undefined ? { pictureHeight } : {})}
      badges={product.isNew ? <NewBadge /> : null}
      line={pack ? `${product.sku} · ${pack}` : product.sku}
      price={price ? { price: price.price, per: price.per } : null}
      noPrice={t('mobile.shop.noPrice')}
      stock={{
        text: stock.count,
        dot: stock.out ? colors.destructive : colors.success,
        color: stock.out ? colors.destructive : colors.success,
      }}
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
        ) : (
          <CardAdd name={product.name} onPress={onAdd} />
        )
      }
    />
  );
}
