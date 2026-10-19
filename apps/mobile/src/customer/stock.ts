import type { StockWord } from '@tugeel/shared/sales';
import { colors } from '../theme/tokens';

// «Байгаа», «Цөөхөн үлдсэн», «Дууссан» (ADR-0079 #4): the store sees a word, never the number. The
// words are mn.json's `sales.stockWords.*`; the pill's colours are the boards' green, orange, red.

export interface StockTone {
  background: string;
  text: string;
  dot: string;
}

export const STOCK_TONES: Record<StockWord, StockTone> = {
  IN: { background: colors.successSoft, text: colors.success, dot: colors.tint.green },
  LOW: { background: colors.warningSoft, text: colors.warningText, dot: colors.tint.orange },
  OUT: { background: colors.destructiveSoft, text: colors.cancelled, dot: colors.destructive },
};

/** A product the store can put in the cart: not «Дууссан», and priced in the unit asked for. */
export function canOrder(
  product: { stock: StockWord },
  unit: { wholesale: string | null } | undefined,
): boolean {
  return product.stock !== 'OUT' && unit !== undefined && unit.wholesale !== null;
}

/** A cart line's warning from the quote: «Цөөхөн үлдсэн», «Зарим нь хойшилж магадгүй», or none. */
export type LineStockNote = 'low' | 'mayBackorder' | 'lowMayBackorder' | null;

export function lineStockNote(
  stock: { stock: StockWord; mayBackorder: boolean } | undefined,
): LineStockNote {
  if (!stock) return null;
  const low = stock.stock !== 'IN';
  if (low && stock.mayBackorder) return 'lowMayBackorder';
  if (stock.mayBackorder) return 'mayBackorder';
  return low ? 'low' : null;
}
