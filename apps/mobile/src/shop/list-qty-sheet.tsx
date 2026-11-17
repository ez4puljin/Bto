import { useFocusEffect, useRouter } from 'expo-router';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RepProduct } from '../api/rep';
import { lineOf } from '../cart/cart';
import { readJson, writeJson } from '../device/storage';
import { useShop } from '../state/shop';
import { useToast } from '../ui/toast';
import { CART_MODE_KEY, type CartMode, cartModeFrom, DEFAULT_CART_MODE } from './mode';
import { QtyKeypad } from './qty-keypad';
import { defaultUnitOf } from './units';

/** The list's cart mode, read from the phone once and written on each change. */
export function useCartMode(): [CartMode, (mode: CartMode) => void] {
  const [mode, setMode] = useState<CartMode>(DEFAULT_CART_MODE);
  // Read again whenever the screen comes into focus: tabs stay mounted, so a switch made on the
  // shop tab reaches the other tabs' lists.
  useFocusEffect(
    useCallback(() => {
      let live = true;
      void readJson(CART_MODE_KEY).then((stored) => {
        if (live) setMode(cartModeFrom(stored));
      });
      return () => {
        live = false;
      };
    }, []),
  );
  const change = useCallback((next: CartMode) => {
    setMode(next);
    void writeJson(CART_MODE_KEY, next);
  }, []);
  return [mode, change];
}

/**
 * «Хялбар горим»: the quantity sheet of the product page, hosted once by a list. It starts from
 * the product's line in the cart and saves with `setLine` as the page does; 0 takes the line out.
 */
export function ListQtySheet({
  product,
  server,
  onClose,
}: {
  product: RepProduct | null;
  server: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { cart, dispatch } = useShop();
  // The last product stays while the sheet closes, so it does not collapse empty.
  const [shown, setShown] = useState<RepProduct | null>(null);
  useEffect(() => {
    if (product) setShown(product);
  }, [product]);
  if (!shown) return null;

  const line = lineOf(cart, shown.id);
  const own = line ? shown.units.find((unit) => unit.id === line.productUnitId) : undefined;
  const start = own ?? defaultUnitOf(shown.units);
  if (!start) return null;

  const done = (unitId: number, qty: number) => {
    const unit = shown.units.find((entry) => entry.id === unitId);
    if (!unit) return onClose();
    if (qty === 0) {
      if (line) dispatch({ type: 'setLine', qty: 0, line: { ...line } });
      return onClose();
    }
    if (shown.stockBlocked) {
      toast.show({ message: t('errors.PRODUCT_OUT_OF_APP_STOCK') });
      return;
    }
    if (!shown.sellable || unit.wholesale === null) {
      toast.show({ message: t('mobile.product.noPrice') });
      return;
    }
    dispatch({
      type: 'setLine',
      qty,
      line: {
        productId: shown.id,
        productUnitId: unit.id,
        sku: shown.sku,
        name: shown.name,
        uomName: unit.uomName,
        uomCode: unit.uomCode,
        factorToBase: unit.factorToBase,
        isBase: unit.isBase,
        wholesale: unit.wholesale,
        thumbUrl: shown.thumbUrl,
      },
    });
    onClose();
  };

  return (
    <QtyKeypad
      visible={product !== null}
      product={shown}
      server={server}
      unitId={start.id}
      qty={line && own ? Number.parseInt(line.qty, 10) : 0}
      onCancel={onClose}
      onDone={done}
    />
  );
}

/**
 * What a list that draws product cards needs for the card's cart: the saved mode, the props of a
 * card (`onAdd`, and `onEdit` in «Хялбар горим») and the one quantity sheet to render in the page.
 * «Энгийн горим»: the cart opens the product. «Хялбар горим»: it opens the sheet here, unless the
 * product cannot be ordered, which is told as before (the toast, or its page; ADR-0173 #1).
 */
export function useCartHost(server: string): {
  mode: CartMode;
  setMode: (mode: CartMode) => void;
  cardProps: (product: RepProduct) => { onAdd: () => void; onEdit?: () => void };
  sheet: ReactNode;
} {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useCartMode();
  const [editing, setEditing] = useState<RepProduct | null>(null);
  const easy = mode === 'easy';
  const add = (product: RepProduct) => {
    if (!easy) {
      router.push(`/product/${product.id}`);
      return;
    }
    if (product.stockBlocked) {
      toast.show({ message: t('errors.PRODUCT_OUT_OF_APP_STOCK') });
      return;
    }
    const unit = defaultUnitOf(product.units);
    if (!unit || !product.sellable || unit.wholesale === null) {
      router.push(`/product/${product.id}`);
      return;
    }
    setEditing(product);
  };
  return {
    mode,
    setMode,
    cardProps: (product) => ({
      onAdd: () => add(product),
      ...(easy ? { onEdit: () => setEditing(product) } : {}),
    }),
    sheet: <ListQtySheet product={editing} server={server} onClose={() => setEditing(null)} />,
  };
}
