import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoreProduct } from '../api/customer';
import { lineOf } from '../cart/cart';
import type { CartMode } from '../shop/mode';
import { useCartMode } from '../shop/list-qty-sheet';
import { defaultUnitOf } from '../shop/units';
import { useShop } from '../state/shop';
import { useToast } from '../ui/toast';
import { StoreQtyKeypad } from './qty-keypad';
import { storeLineOf } from './shop';
import { canOrder } from './stock';

const MAX_QTY = 9999;

/**
 * «Хялбар горим» of «Bto300»: the quantity sheet of the product page, hosted once by a list. It
 * starts from the product's line in the cart and saves with `setLine` under the page's rules
 * (`canOrder`, the same limit); 0 takes the line out.
 */
export function StoreListQtySheet({
  product,
  server,
  onClose,
}: {
  product: StoreProduct | null;
  server: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { cart, dispatch } = useShop();
  // The last product stays while the sheet closes, so it does not collapse empty.
  const [shown, setShown] = useState<StoreProduct | null>(null);
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
      if (line) dispatch({ type: 'remove', productUnitId: line.productUnitId });
      return onClose();
    }
    if (shown.stock === 'OUT') {
      toast.show({ message: t('errors.PRODUCT_OUT_OF_APP_STOCK') });
      return;
    }
    if (!canOrder(shown, unit)) {
      toast.show({ message: t('mobile.product.noPrice') });
      return;
    }
    dispatch({
      type: 'setLine',
      qty: Math.min(MAX_QTY, qty),
      line: storeLineOf(shown, unit),
    });
    onClose();
  };

  return (
    <StoreQtyKeypad
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
 * What a customer list needs for the card's cart: the saved mode, the card's `onAdd` (and `onEdit`
 * in «Хялбар горим») and the one quantity sheet to render in the page. «Энгийн горим»: the cart
 * opens the product and adds nothing. «Хялбар горим»: it opens the sheet.
 */
export function useStoreCartHost(server: string): {
  mode: CartMode;
  setMode: (mode: CartMode) => void;
  add: (product: StoreProduct) => void;
  edit: ((product: StoreProduct) => void) | undefined;
  sheet: ReactNode;
} {
  const router = useRouter();
  const [mode, setMode] = useCartMode();
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const easy = mode === 'easy';
  return {
    mode,
    setMode,
    add: (product) => {
      if (easy) setEditing(product);
      else router.push(`/product/${product.id}`);
    },
    edit: easy ? (product) => setEditing(product) : undefined,
    sheet: <StoreListQtySheet product={editing} server={server} onClose={() => setEditing(null)} />,
  };
}
