import { useRouter } from 'expo-router';
import type { RepProduct } from '../api/rep';
import { useShop } from '../state/shop';
import { defaultUnitOf } from './units';

/**
 * A card's «+» (ADR-0068 #3): one of the product's default unit into the cart; a product that
 * cannot be ordered so (no price for that unit, not sellable) opens its page instead, which says why.
 */
export function useAddOne(): (product: RepProduct) => void {
  const router = useRouter();
  const { dispatch } = useShop();
  return (product) => {
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
