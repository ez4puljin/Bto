import { useRouter } from 'expo-router';
import type { StoreProduct } from '../api/customer';
import { defaultUnitOf } from '../shop/units';
import { useShop } from '../state/shop';
import { storeLineOf } from './shop';
import { canOrder } from './stock';

/**
 * A store card's «+» (ADR-0079 #4): one of the product's default unit into the cart; a product
 * that cannot be ordered so («Дууссан», no price in that unit) opens its page, which says why.
 */
export function useAddOneStore(): (product: StoreProduct) => void {
  const router = useRouter();
  const { dispatch } = useShop();
  return (product) => {
    const unit = defaultUnitOf(product.units);
    if (!unit || !canOrder(product, unit)) {
      router.push(`/product/${product.id}`);
      return;
    }
    dispatch({ type: 'add', qty: 1, line: storeLineOf(product, unit) });
  };
}
