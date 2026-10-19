import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoreProduct } from '../api/customer';
import { formatMnt } from '../format/format';
import { KeypadSheet } from '../shop/keypad-sheet';
import { useUnitWords } from '../shop/unit-words';
import { baseQty, baseUnitOf } from '../shop/units';
import { useStoreLineQuote } from './shop-quote';

/**
 * The store's «Тоо оруулах» (the ProductKeypad board as «Bto300» uses it, ADR-0079 #4): the
 * product with its code and stock word, the unit switch, the number with what it comes to (pieces
 * and the server's total), «Зарим нь хойшилж магадгүй…» when the server says so, and the keypad.
 * «Болсон» hands the unit and the number back; «Цуцлах» and the back button drop them. Never a
 * stock number.
 */
export function StoreQtyKeypad({
  visible,
  product,
  server,
  unitId,
  qty,
  onDone,
  onCancel,
}: {
  visible: boolean;
  product: StoreProduct;
  server: string;
  unitId: number;
  qty: number;
  onDone: (unitId: number, qty: number) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const words = useUnitWords();
  const [unit, setUnit] = useState(unitId);
  const [digits, setDigits] = useState(String(qty));
  useEffect(() => {
    if (!visible) return;
    setUnit(unitId);
    setDigits(qty > 0 ? String(qty) : '');
  }, [visible, unitId, qty]);

  const value = digits === '' ? 0 : Number.parseInt(digits, 10);
  const chosen = product.units.find((entry) => entry.id === unit) ?? product.units[0];
  const base = baseUnitOf(product.units);
  const quote = useStoreLineQuote(visible ? (chosen?.id ?? null) : null, value);
  if (!chosen || !base) return null;
  const conversion = [
    chosen.isBase
      ? null
      : t('mobile.product.equals', {
          n: baseQty(value, chosen).toFixed(),
          unit: words(base).name,
        }),
    quote.total ? t('pricing.money', { amount: formatMnt(quote.total) }) : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  return (
    <KeypadSheet
      visible={visible}
      product={product}
      server={server}
      subtitle={[product.sku, t(`sales.stockWords.${product.stock}`)].join(' · ')}
      unit={chosen}
      digits={digits}
      onUnit={setUnit}
      onDigits={setDigits}
      conversion={conversion}
      note={quote.mayBackorder ? t('mobile.customer.stock.mayBackorder') : null}
      onDone={() => onDone(chosen.id, value)}
      onCancel={onCancel}
    />
  );
}
