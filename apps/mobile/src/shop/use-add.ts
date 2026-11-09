import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { RepProduct } from '../api/rep';
import { useShop } from '../state/shop';
import { useToast } from '../ui/toast';
import { defaultUnitOf } from './units';

/**
 * A card's «+» (ADR-0068 #3): one of the product's default unit into the cart; a product that
 * cannot be ordered so (no price for that unit, not sellable) opens its page instead, which says
 * why. A product whose home warehouse the staff app does not count (ADR-0173 #1) is refused with
 * the server's own words: an app order would be answered PRODUCT_OUT_OF_APP_STOCK.
 */
export function useAddOne(): (product: RepProduct) => void {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { dispatch } = useShop();
  return (product) => {
    if (product.stockBlocked) {
      toast.show({ message: t('errors.PRODUCT_OUT_OF_APP_STOCK') });
      return;
    }
    const unit = defaultUnitOf(product.units);
    if (!unit || !product.sellable || unit.wholesale === null) {
      router.push(`/product/${product.id}`);
      return;
    }
    dispatch({
      type: 'add',
      qty: 1,
      line: {
        productId: product.id,
        productUnitId: unit.id,
        sku: product.sku,
        name: product.name,
        uomName: unit.uomName,
        uomCode: unit.uomCode,
        factorToBase: unit.factorToBase,
        isBase: unit.isBase,
        wholesale: unit.wholesale,
        thumbUrl: product.thumbUrl,
      },
    });
  };
}
