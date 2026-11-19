import { useTranslation } from 'react-i18next';
import { type RepUnit, useQuote } from '../api/rep';
import { formatMnt, formatQty } from '../format/format';
import { useDebounced } from '../state/use-debounced';
import { useUnitWords } from './unit-words';

/**
 * One product line priced by the server (the app never computes a price, ADR-0061 #5): the total
 * of `qty` of a unit and its parts as «2 хайрцаг × 174,600₮», asked again once typing pauses.
 * Without the server an estimate from the kept prices stands in (`estimated`, ADR-0225 #4).
 */
export function useLineQuote(units: readonly RepUnit[], unitId: number | null, qty: number) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const settled = useDebounced(qty, 300);
  const quote = useQuote(
    unitId !== null && settled > 0 ? [{ productUnitId: unitId, qty: String(settled) }] : [],
  );
  const line = quote.data?.lines[0];
  // The answer for this unit and this quantity (a previous answer stays while the next loads).
  const fresh =
    line !== undefined && line.productUnitId === unitId && formatQty(line.qty) === String(qty);
  const priced = fresh && line?.priced === true ? line : null;
  const breakdown = priced
    ? priced.parts
        .map((part) => {
          const unit = units.find((entry) => entry.id === part.productUnitId);
          return t('mobile.product.part', {
            qty: formatQty(part.qty),
            unit: unit ? words(unit).name : part.uomName,
            price: formatMnt(part.unitPrice),
          });
        })
        .join(' + ')
    : null;
  return {
    total: priced ? priced.total : null,
    breakdown,
    /** The server answered for this quantity and has no price for it. */
    unpriced: fresh && line?.priced === false,
    /**
     * Without the server: the phone's estimate from the kept prices (ADR-0225 #4), shown with «≈»;
     * a line it cannot price never blocks adding it.
     */
    estimated: quote.data?.estimated === true,
    loading: qty > 0 && !fresh,
  };
}
