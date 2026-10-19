import { useStoreQuote } from '../api/customer';
import { useDebounced } from '../state/use-debounced';
import { quotedLine } from './shop';

/**
 * One product line priced by the server for the store (the app never prices, ADR-0006 #6): the
 * total of `qty` of a unit and whether some of it may wait for stock («Зарим нь хойшилж
 * магадгүй»), asked again once typing pauses. Never a stock number.
 */
export function useStoreLineQuote(unitId: number | null, qty: number) {
  const settled = useDebounced(qty, 300);
  const quote = useStoreQuote(
    unitId !== null && settled > 0 ? [{ productUnitId: unitId, qty: String(settled) }] : [],
  );
  // The answer for this unit and this quantity (a previous answer stays while the next loads).
  const answer = unitId !== null && qty > 0 ? quotedLine(quote.data, unitId, String(qty)) : null;
  const priced = answer?.line.priced === true ? answer.line : null;
  return {
    total: priced?.total ?? null,
    /** The server answered for this quantity and has no price for it. */
    unpriced: answer?.line.priced === false,
    mayBackorder: answer?.stock?.mayBackorder === true,
    loading: qty > 0 && answer === null && !quote.isError,
    error: quote.error,
  };
}
